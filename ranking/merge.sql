-- Fatline ranking, step 3: one list from both networks. Each network's scores become shares of that
-- network's total, the two shares are averaged (an account missing on one network counts 0 there), and
-- the list is ranked by that average. Ties go to the lower FID. Tiers: 1 = top 777, 2 = top 7,777,
-- 3 = top 77,777, 4 = everyone else ranked.
COPY (
  WITH s AS (SELECT fid, score / sum(score) OVER () AS share FROM read_csv(getvariable('snap_dir') || '/score.tsv')),
       h AS (SELECT fid, score / sum(score) OVER () AS share FROM read_csv(getvariable('hyper_dir') || '/score.tsv')),
       m AS (SELECT fid, round((COALESCE(s.share, 0) + COALESCE(h.share, 0)) / 2, 15) AS avg_share,
                    round(COALESCE(s.share, 0), 15) AS snapchain, round(COALESCE(h.share, 0), 15) AS hypersnap
             FROM s FULL OUTER JOIN h USING (fid))
  SELECT row_number() OVER (ORDER BY avg_share DESC, fid ASC) AS rank, fid,
         CASE WHEN rank <= 777 THEN 1 WHEN rank <= 7777 THEN 2 WHEN rank <= 77777 THEN 3 ELSE 4 END AS tier,
         avg_share, snapchain, hypersnap
  FROM m ORDER BY rank
) TO '__OUT__' (DELIMITER '\t', HEADER true);
