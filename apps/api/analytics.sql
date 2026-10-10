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
