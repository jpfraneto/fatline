-- Fatline ranking, step 2: score one network's extract. Run by ranking/run.sh, once per network.
-- Variables (set by run.sh): getvariable('dir') = extract folder, getvariable('snap') = snapshot time
-- in Farcaster seconds. Rules: FIP "Proof of Work Tokenization" §2, §6, §8, §10 (farcasterorg discussion
-- #19), kept simple:
--   score       = credibility × growth, for eligible accounts only
--   growth(f)   = Σ over u with two-way interactions and trust(u) ≥ floor: ln(1 + f→u + u→f) · credibility(u)
--   credibility = 0.25 age + 0.35 trust + 0.20 contact variety + 0.10 app variety (+ 0.10 stake, 0 here)
--   trust       = EigenTrust over follows, seeded by FIDs ≤ 50,000, d = 0.85, normalized by the top-100 mean, × age
-- Only what happened after both accounts' last custody change counts (a bought account starts at zero).
-- Simplified on purpose: eligibility uses F0 (not an app), F1 (has cast), F2 (≥ 3 engagers); the
-- data-derived filters F3–F6 are left out.

CREATE OR REPLACE TABLE fid AS
SELECT fid, reg, transfer, casts, replies, active_days,
       -- effective start, in Farcaster seconds (onchain times are unix; 1609459200 = 2021-01-01)
       GREATEST(COALESCE(NULLIF(GREATEST(reg, transfer), 0), 1609459200) - 1609459200, 0) AS eff,
       LEAST(1.0, GREATEST(getvariable('snap') - (GREATEST(reg, transfer) - 1609459200), 0) / 15552000.0) AS age,
       apps
FROM read_csv(getvariable('dir') || '/chunk-*/fids.tsv.gz', delim = '\t', header = false,
  columns = {'fid': 'UBIGINT', 'reg': 'BIGINT', 'transfer': 'BIGINT', 'casts': 'BIGINT', 'replies': 'BIGINT',
             'first': 'BIGINT', 'last': 'BIGINT', 'active_days': 'BIGINT', 'apps': 'VARCHAR'});

-- Follows that count: made after both accounts' effective start.
CREATE OR REPLACE TABLE follow AS
SELECT DISTINCT e.src, e.dst
FROM read_csv(getvariable('dir') || '/chunk-*/follows.tsv.gz', delim = '\t', header = false,
  columns = {'src': 'UBIGINT', 'dst': 'UBIGINT', 'ts': 'BIGINT'}) e
JOIN fid a ON a.fid = e.src JOIN fid b ON b.fid = e.dst
WHERE e.ts > a.eff AND e.ts > b.eff;

-- Directed interaction counts (replies, mentions, likes, recasts, follows), post-transfer for both sides.
-- Two stages (filter, then count) and 32-bit FIDs, so it fits in memory next to the nodes.
CREATE OR REPLACE TABLE inter_raw AS
SELECT e.src::UINTEGER AS src, e.dst::UINTEGER AS dst
FROM read_csv(getvariable('dir') || '/chunk-*/inter.tsv.gz', delim = '\t', header = false,
  columns = {'src': 'UBIGINT', 'dst': 'UBIGINT', 'ts': 'BIGINT', 'kind': 'VARCHAR'}) e
JOIN fid a ON a.fid = e.src JOIN fid b ON b.fid = e.dst
WHERE e.ts > a.eff AND e.ts > b.eff;
INSERT INTO inter_raw SELECT src::UINTEGER, dst::UINTEGER FROM follow;
CREATE OR REPLACE TABLE inter AS SELECT src, dst, count(*) AS n FROM inter_raw GROUP BY src, dst;
DROP TABLE inter_raw;

-- EigenTrust. Seeds: FIDs ≤ 50,000. Each step: t = 0.15·seed + 0.85·Σ t(j)/outdeg(j) over j follows i.
CREATE OR REPLACE TABLE outdeg AS SELECT src, count(*)::DOUBLE AS d FROM follow GROUP BY src;
CREATE OR REPLACE TABLE seed AS SELECT fid, CASE WHEN fid <= 50000 THEN 1.0 / 50000 ELSE 0.0 END AS s FROM fid;
CREATE OR REPLACE TABLE trust_raw AS SELECT fid, s AS t FROM seed;
