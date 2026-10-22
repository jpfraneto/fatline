-- One EigenTrust step (FIP §8.2.2). run.sh repeats it until the L1 change is below 1e-6 or 50 steps.
CREATE OR REPLACE TABLE trust_next AS
SELECT s.fid, 0.15 * s.s + 0.85 * COALESCE(p.v, 0) AS t
FROM seed s LEFT JOIN (
  SELECT f.dst AS fid, sum(r.t / o.d) AS v
  FROM follow f JOIN trust_raw r ON r.fid = f.src JOIN outdeg o ON o.src = f.src
  GROUP BY f.dst
) p ON p.fid = s.fid;
SELECT round(sum(abs(n.t - o.t)), 12) AS change FROM trust_next n JOIN trust_raw o USING (fid);
CREATE OR REPLACE TABLE trust_raw AS SELECT * FROM trust_next;
