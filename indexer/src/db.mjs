import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDb(dataDir, file = 'indexer.sqlite') {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(file === ':memory:' ? ':memory:' : join(dataDir, file));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS voices (
      chain_id INTEGER NOT NULL,
      contract TEXT NOT NULL,
      id INTEGER NOT NULL,
      author TEXT NOT NULL,
      parent_id INTEGER NOT NULL,
      fid INTEGER NOT NULL,
      text TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      retracted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (chain_id, contract, id)
    );
    CREATE INDEX IF NOT EXISTS voices_time ON voices (chain_id, contract, timestamp DESC);
    CREATE INDEX IF NOT EXISTS voices_parent ON voices (chain_id, contract, parent_id);
    CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

export function getState(db, key) {
  return db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key)?.value ?? null;
}

export function setState(db, key, value) {
  db.prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}
