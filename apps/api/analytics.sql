-- Recall product analytics (brief M4). Read-only queries over `events` and `review_logs`.
-- Each one is tested against a hand-made fixture in test/analytics.test.ts.
--
-- Conventions:
-- * All timestamps are epoch ms (device clock, clamped by the server to ≤ now + 24 h).
-- * "First seen" = a user's earliest event of any type. Anonymous use is recorded on the
--   device and synced at sign-in, so this is earlier and truer than users.created_at.
-- * Weeks are UTC weeks starting on Monday.
-- * Voided (undone) reviews are ignored everywhere.
-- * Event payloads never contain card text (enforced by the core schema).
--
-- Usage: run each query from code (a driver binds $1), or paste it into psql with $1
-- replaced by an epoch-ms number. Only return_rate takes a parameter (the as-of time).

-- name: time_to_first_review
-- Per user: ms from first seen to the earliest first_review_completed (one per device
-- is possible; the earliest counts). NULL = never reviewed.
SELECT
  user_id,
  (MIN(occurred_at) FILTER (WHERE type = 'first_review_completed') - MIN(occurred_at))::float8
    AS ms_to_first_review
FROM events
GROUP BY user_id
ORDER BY user_id;

-- name: return_rate
-- D1 / D7 / D30 return. A user "returned on day N" if they have any event in
-- [first seen + N days, first seen + N+1 days). Only users whose day N has fully passed
-- by $1 (as-of, epoch ms) are eligible. rate is NULL when nobody is eligible yet.
WITH first_seen AS (
  SELECT user_id, MIN(occurred_at) AS t0 FROM events GROUP BY user_id
),
days AS (
  SELECT unnest(ARRAY[1, 7, 30]) AS day
),
eligible AS (
  SELECT d.day, f.user_id, f.t0
  FROM days d
  JOIN first_seen f ON f.t0 + (d.day + 1) * 86400000::bigint <= $1::bigint
)
SELECT
  d.day,
  COUNT(e.user_id)::int AS eligible,
  COUNT(e.user_id) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM events ev
      WHERE ev.user_id = e.user_id
        AND ev.occurred_at >= e.t0 + d.day * 86400000::bigint
        AND ev.occurred_at < e.t0 + (d.day + 1) * 86400000::bigint
    )
  )::int AS returned,
  ROUND(
    (COUNT(e.user_id) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM events ev
        WHERE ev.user_id = e.user_id
          AND ev.occurred_at >= e.t0 + d.day * 86400000::bigint
          AND ev.occurred_at < e.t0 + (d.day + 1) * 86400000::bigint
      )
    ))::numeric / NULLIF(COUNT(e.user_id), 0),
    4
  )::float8 AS rate
FROM days d
LEFT JOIN eligible e ON e.day = d.day
GROUP BY d.day
ORDER BY d.day;

-- name: weekly_active_learners
-- Distinct users with at least one non-voided review in the UTC week.
SELECT
  to_char(date_trunc('week', to_timestamp(reviewed_at / 1000.0) AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
    AS week_start,
  COUNT(DISTINCT user_id)::int AS learners
FROM review_logs
WHERE voided_at IS NULL
GROUP BY 1
ORDER BY 1;

-- name: due_review_completion_rate
-- Per UTC week: sessions started, finished with nothing left (completed) or left with
-- cards remaining (abandoned). rate = completed / started. Approximation: events carry
-- no session id, so a session started on Sunday and finished on Monday counts in two
-- weeks, and sessions closed without pressing ✕ / "Back to home" end neither way.
SELECT
  to_char(date_trunc('week', to_timestamp(occurred_at / 1000.0) AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
    AS week_start,
  COUNT(*) FILTER (WHERE type = 'session_started')::int AS started,
  COUNT(*) FILTER (WHERE type = 'session_completed')::int AS completed,
  COUNT(*) FILTER (WHERE type = 'session_abandoned')::int AS abandoned,
  ROUND(
    (COUNT(*) FILTER (WHERE type = 'session_completed'))::numeric
      / NULLIF(COUNT(*) FILTER (WHERE type = 'session_started'), 0),
    4
  )::float8 AS rate
FROM events
WHERE type IN ('session_started', 'session_completed', 'session_abandoned')
GROUP BY 1
ORDER BY 1;

-- name: true_retention
-- Per user: of reviews of cards in "review state", the share not rated Again (1).
-- Approximation (the server doesn't store CardState): a review counts as review-state
-- when the previous non-voided review of the same card was at least 1 day earlier.
-- This leaves out first reviews and same-day learning steps, as true retention should.
WITH ordered AS (
  SELECT
    user_id,
    rating,
    reviewed_at,
    LAG(reviewed_at) OVER (PARTITION BY card_id ORDER BY reviewed_at, id) AS prev_at
  FROM review_logs
  WHERE voided_at IS NULL
)
SELECT
  user_id,
  COUNT(*)::int AS reviews,
  COUNT(*) FILTER (WHERE rating > 1)::int AS passed,
  ROUND((COUNT(*) FILTER (WHERE rating > 1))::numeric / COUNT(*), 4)::float8 AS retention
FROM ordered
WHERE prev_at IS NOT NULL AND reviewed_at - prev_at >= 86400000
GROUP BY user_id
ORDER BY user_id;

-- name: catalog_deck_funnel
-- M7 store funnel, per catalog deck (slug), in distinct users: viewed its store page →
-- added it → reviewed at least one of its cards → still reviewing it 7+ days after adding
-- it (a review at least 7 days after their copy was created, device clock). Unlisted
-- decks are included. Undone reviews don't count.
WITH viewed AS (
  SELECT props->>'slug' AS slug, COUNT(DISTINCT user_id) AS n
  FROM events WHERE type = 'catalog_deck_viewed' GROUP BY 1
),
added AS (
  SELECT props->>'slug' AS slug, COUNT(DISTINCT user_id) AS n
  FROM events WHERE type = 'catalog_deck_added' GROUP BY 1
),
copies AS (
  SELECT catalog_slug AS slug, user_id, MIN(created_at) AS added_at
  FROM decks WHERE catalog_slug IS NOT NULL GROUP BY 1, 2
),
reviews AS (
  SELECT d.catalog_slug AS slug, r.user_id, r.reviewed_at
  FROM review_logs r
  JOIN cards c ON c.id = r.card_id AND c.user_id = r.user_id
  JOIN decks d ON d.id = c.deck_id AND d.user_id = c.user_id
  WHERE d.catalog_slug IS NOT NULL AND r.voided_at IS NULL
),
slugs AS (
  SELECT slug FROM viewed UNION SELECT slug FROM added UNION SELECT slug FROM copies
)
SELECT
  s.slug,
  COALESCE(v.n, 0)::int AS viewers,
  COALESCE(a.n, 0)::int AS adders,
  (SELECT COUNT(DISTINCT r.user_id) FROM reviews r WHERE r.slug = s.slug)::int AS reviewers,
  (SELECT COUNT(DISTINCT r.user_id)
     FROM reviews r JOIN copies c ON c.slug = r.slug AND c.user_id = r.user_id
     WHERE r.slug = s.slug AND r.reviewed_at >= c.added_at + 7 * 86400000)::int AS retained_7d
FROM slugs s
LEFT JOIN viewed v ON v.slug = s.slug
LEFT JOIN added a ON a.slug = s.slug
ORDER BY s.slug;

-- name: paid_deck_funnel
-- M8 funnel, per paid catalog deck (latest version's price > 0), in distinct users: viewed
-- its store page → viewed the purchase info → redeemed a code for it → studied it 7+
-- days after unlocking (a non-undone review of a card in their copy, at least 7 days
-- after the entitlement was created).
WITH paid AS (
  SELECT d.slug
  FROM catalog_deck d
  JOIN catalog_deck_version v ON v.slug = d.slug AND v.version = d.latest_version
  WHERE (v.content->>'price')::int > 0
),
viewed AS (
  SELECT props->>'slug' AS slug, COUNT(DISTINCT user_id) AS n
  FROM events WHERE type = 'catalog_deck_viewed' GROUP BY 1
),
info AS (
  SELECT props->>'slug' AS slug, COUNT(DISTINCT user_id) AS n
  FROM events WHERE type = 'purchase_info_viewed' GROUP BY 1
),
redeemed AS (
  SELECT slug, COUNT(DISTINCT user_id) AS n FROM entitlement GROUP BY 1
),
studied AS (
  SELECT e.slug, COUNT(DISTINCT e.user_id) AS n
  FROM entitlement e
  JOIN decks d ON d.user_id = e.user_id AND d.catalog_slug = e.slug
  JOIN cards c ON c.deck_id = d.id AND c.user_id = d.user_id
  JOIN review_logs r ON r.card_id = c.id AND r.user_id = c.user_id
  WHERE r.voided_at IS NULL
    AND r.reviewed_at >= (extract(epoch FROM e.created_at) * 1000)::bigint + 7 * 86400000
  GROUP BY 1
)
SELECT
  p.slug,
  COALESCE(v.n, 0)::int AS viewers,
  COALESCE(i.n, 0)::int AS purchase_info_viewers,
  COALESCE(x.n, 0)::int AS redeemers,
  COALESCE(s.n, 0)::int AS studied_7d
FROM paid p
LEFT JOIN viewed v ON v.slug = p.slug
LEFT JOIN info i ON i.slug = p.slug
LEFT JOIN redeemed x ON x.slug = p.slug
LEFT JOIN studied s ON s.slug = p.slug
ORDER BY p.slug;

-- name: break_return_sessions
-- Feel pass: of the users shown "Welcome back" (break_return_shown: no review for 2+
-- study days and more than 30 due), the share who started a session within 24 hours of
-- a showing, capped ("Start with 20", capped_session_started) vs full. Distinct users;
-- one can count as both, after different showings or on different devices. A session
-- is capped when its device recorded capped_session_started within a minute of it.
WITH shown AS (
  SELECT user_id, occurred_at FROM events WHERE type = 'break_return_shown'
),
sessions AS (
  SELECT
    s.user_id,
    s.occurred_at,
    EXISTS (
      SELECT 1 FROM events c
      WHERE c.type = 'capped_session_started'
        AND c.user_id = s.user_id
        AND c.device_id = s.device_id
        AND abs(c.occurred_at - s.occurred_at) <= 60000
    ) AS capped
  FROM events s
  WHERE s.type = 'session_started'
),
started AS (
  SELECT sh.user_id, bool_or(se.capped) AS capped, bool_or(NOT se.capped) AS uncapped
  FROM shown sh
  JOIN sessions se
    ON se.user_id = sh.user_id
   AND se.occurred_at >= sh.occurred_at
   AND se.occurred_at < sh.occurred_at + 86400000
  GROUP BY sh.user_id
),
totals AS (
  SELECT
    (SELECT COUNT(DISTINCT user_id) FROM shown) AS users_shown,
    COUNT(*) AS started_any,
    COUNT(*) FILTER (WHERE capped) AS started_capped,
    COUNT(*) FILTER (WHERE uncapped) AS started_full
  FROM started
)
SELECT
  users_shown::int,
  started_any::int,
  started_capped::int,
  started_full::int,
  ROUND(started_any::numeric / NULLIF(users_shown, 0), 4)::float8 AS share_any,
  ROUND(started_capped::numeric / NULLIF(users_shown, 0), 4)::float8 AS share_capped,
  ROUND(started_full::numeric / NULLIF(users_shown, 0), 4)::float8 AS share_full
FROM totals;
