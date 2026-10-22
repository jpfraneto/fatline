-- Final scoring for one network (FIP §8.2.3, §8.3, §8.4, §6). Writes score.tsv in the extract folder.
CREATE OR REPLACE TABLE trust AS
WITH norm AS (SELECT avg(t) AS m FROM (SELECT t FROM trust_raw ORDER BY t DESC LIMIT 100))
SELECT r.fid, LEAST(1.0, GREATEST(0.0, r.t / norm.m * f.age)) AS trust
FROM trust_raw r, norm JOIN fid f ON f.fid = r.fid;

-- F0: an account that 100 or more FIDs gave app keys to is an app, not a person.
CREATE OR REPLACE TABLE app_users AS
SELECT app AS fid, count(DISTINCT fid) AS users
FROM read_csv(getvariable('dir') || '/chunk-*/signers.tsv.gz', delim = '\t', header = false,
  columns = {'fid': 'UBIGINT', 'app': 'UBIGINT'}) GROUP BY app;

-- F2: distinct other accounts that interacted with this one (post-transfer).
CREATE OR REPLACE TABLE engagers AS SELECT dst AS fid, count(DISTINCT src) AS n FROM inter WHERE src <> dst GROUP BY dst;

-- Contact variety: normalized Shannon entropy of who this account interacts with.
CREATE OR REPLACE TABLE variety AS
SELECT src AS fid,
       CASE WHEN count(*) < 2 THEN 0.0
            ELSE -sum((n / tot) * ln(n / tot)) / ln(count(*)) END AS entropy
FROM (SELECT src, n::DOUBLE AS n, sum(n) OVER (PARTITION BY src)::DOUBLE AS tot FROM inter)
GROUP BY src;

CREATE OR REPLACE TABLE cred AS
SELECT f.fid,
       0.25 * f.age + 0.35 * COALESCE(t.trust, 0) + 0.20 * COALESCE(v.entropy, 0)
     + 0.10 * LEAST(1.0, CASE WHEN f.apps IS NULL OR f.apps = '' THEN 0.0
                              ELSE log2(len(string_split(f.apps, ','))) END) AS credibility,
       COALESCE(t.trust, 0) AS trust, f.age,
       (COALESCE(a.users, 0) < 100 AND f.casts > 0 AND COALESCE(e.n, 0) >= 3) AS eligible
FROM fid f LEFT JOIN trust t USING (fid) LEFT JOIN variety v USING (fid)
LEFT JOIN app_users a USING (fid) LEFT JOIN engagers e USING (fid);

-- Crediter floor: the 10th percentile of trust among typical active accounts (≥ 10 casts, ≥ 5 active days).
CREATE OR REPLACE TABLE floor AS
SELECT quantile_cont(c.trust, 0.10) AS floor FROM cred c JOIN fid f USING (fid)
WHERE f.casts >= 10 AND f.active_days >= 5;

CREATE OR REPLACE TABLE growth AS
SELECT a.src AS fid, sum(ln(1 + a.n + b.n) * cu.credibility) AS growth
FROM inter a JOIN inter b ON b.src = a.dst AND b.dst = a.src
JOIN cred cu ON cu.fid = a.dst, floor
WHERE a.src <> a.dst AND cu.trust >= floor.floor
GROUP BY a.src;

COPY (
  SELECT c.fid, round(c.credibility * COALESCE(g.growth, 0), 9) AS score,
         round(c.credibility, 6) AS credibility, round(COALESCE(g.growth, 0), 6) AS growth,
         round(c.trust, 6) AS trust, round(c.age, 6) AS age
  FROM cred c LEFT JOIN growth g USING (fid)
  WHERE c.eligible AND COALESCE(g.growth, 0) > 0
  ORDER BY fid
) TO '__DIR__/score.tsv' (DELIMITER '\t', HEADER true);
SELECT count(*) AS scored, (SELECT floor FROM floor) AS trust_floor FROM read_csv(getvariable('dir') || '/score.tsv');
