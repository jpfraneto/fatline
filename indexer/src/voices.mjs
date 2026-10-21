// Rebuilds the Voices feed from contract logs into SQLite. The chain is the source of truth;
// deleting the database and restarting rebuilds the same feed.
import { createPublicClient, getAddress, http } from 'viem';
import { voicesAbi } from './abi.mjs';
import { getState, setState } from './db.mjs';

const CHUNK = 2_000n;

export class VoicesIndex {
  constructor(db, { chainId, rpc, address, fromBlock = 0 }, { client } = {}) {
    this.db = db;
    this.chainId = Number(chainId);
    this.address = address ? getAddress(address) : null;
    this.fromBlock = BigInt(fromBlock ?? 0);
    this.client = client ?? (rpc ? createPublicClient({ transport: http(rpc) }) : null);
    this.lastError = null;
    this.syncedBlock = null;
    this.headBlock = null;
    this.stateKey = `voices:${this.chainId}:${this.address}`;
    this.blockTimes = new Map();
  }

  get enabled() {
    return Boolean(this.address && this.client);
  }

  async #timestamp(blockNumber) {
    const key = blockNumber.toString();
    if (!this.blockTimes.has(key)) {
      const block = await this.client.getBlock({ blockNumber });
      this.blockTimes.set(key, Number(block.timestamp) * 1000);
      if (this.blockTimes.size > 5_000) this.blockTimes.delete(this.blockTimes.keys().next().value);
    }
    return this.blockTimes.get(key);
  }

  /** Indexes every new block up to the current head. Returns the number of logs applied. */
  async syncOnce() {
    if (!this.enabled) return 0;
    const head = await this.client.getBlockNumber();
    this.headBlock = head;
    const saved = getState(this.db, this.stateKey);
    let from = saved === null ? this.fromBlock : BigInt(saved) + 1n;
    let applied = 0;

    const insert = this.db.prepare(`INSERT OR IGNORE INTO voices
      (chain_id, contract, id, author, parent_id, fid, text, block_number, tx_hash, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const retract = this.db.prepare('UPDATE voices SET retracted = 1 WHERE chain_id = ? AND contract = ? AND id = ?');

    while (from <= head) {
      const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head;
      const logs = await this.client.getLogs({ address: this.address, events: voicesAbi.filter((x) => x.type === 'event'), fromBlock: from, toBlock: to });
      const rows = [];
      for (const log of logs) {
        rows.push({ log, time: log.eventName === 'Voice' ? await this.#timestamp(log.blockNumber) : 0 });
      }
      this.db.exec('BEGIN');
      try {
        for (const { log, time } of rows) {
          const a = log.args;
          if (log.eventName === 'Voice') {
            insert.run(this.chainId, this.address, Number(a.id), a.author.toLowerCase(), Number(a.parentId),
              Number(a.fid), a.text, Number(log.blockNumber), log.transactionHash, time);
          } else {
            retract.run(this.chainId, this.address, Number(a.id));
          }
          applied++;
        }
        setState(this.db, this.stateKey, to);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
      this.syncedBlock = to;
      from = to + 1n;
    }
    this.lastError = null;
    return applied;
  }

  start(intervalMs = 5_000) {
    if (!this.enabled) return;
    const tick = async () => {
      try {
        await this.syncOnce();
      } catch (err) {
        this.lastError = err.shortMessage ?? err.message;
      }
      this.timer = setTimeout(tick, intervalMs);
    };
    tick();
  }

  stop() {
    clearTimeout(this.timer);
  }

  list({ before = Number.MAX_SAFE_INTEGER, limit = 30, fids = null, parentId = 0, includeRetracted = false } = {}) {
    const where = ['chain_id = ?', 'contract = ?', 'timestamp < ?', 'parent_id = ?'];
    const args = [this.chainId, this.address, before, parentId];
    if (!includeRetracted) where.push('retracted = 0');
    if (fids?.length) {
      where.push(`fid IN (${fids.map(() => '?').join(',')})`);
      args.push(...fids);
    }
    return this.db
      .prepare(`SELECT * FROM voices WHERE ${where.join(' AND ')} ORDER BY timestamp DESC, id DESC LIMIT ?`)
      .all(...args, limit)
      .map(rowToVoice);
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM voices WHERE chain_id = ? AND contract = ? AND id = ?')
      .get(this.chainId, this.address, Number(id));
    return row ? rowToVoice(row) : null;
  }

  replies(id) {
    return this.db
      .prepare('SELECT * FROM voices WHERE chain_id = ? AND contract = ? AND parent_id = ? AND retracted = 0 ORDER BY timestamp ASC')
      .all(this.chainId, this.address, Number(id))
      .map(rowToVoice);
  }

  status() {
    return {
      enabled: this.enabled,
      chainId: this.chainId,
      address: this.address,
      syncedBlock: this.syncedBlock?.toString() ?? getState(this.db, this.stateKey),
      headBlock: this.headBlock?.toString() ?? null,
      error: this.lastError,
    };
  }
}

function rowToVoice(r) {
  return {
    kind: 'voice',
    id: r.id,
    author: r.author,
    parentId: r.parent_id,
    claimedFid: r.fid || null,
    text: r.text,
    timestamp: r.timestamp,
    blockNumber: r.block_number,
    txHash: r.tx_hash,
    retracted: Boolean(r.retracted),
  };
}
