# Active task — Add race_control table + seed (2026-05-22)

## Status: SHIPPED for session 9839; remaining 88 sessions need backfill

## Done

- [x] Added `race_control` to `db/schema.sql` (BIGSERIAL id PK, NOT NULL on session_key/date/message, FK DEFERRABLE INITIALLY DEFERRED, unique index on (session_key, date, message), session_date index).
- [x] Mirrored CREATE TABLE in `scripts/seed.ts` `ensureSchema()` + FK migration block (guarded by `to_regclass`).
- [x] Added `seedRaceControl()` in `scripts/seed.ts` and wired into `seedSession()` (runs between stints and laps).
- [x] Created `scripts/backfill-race-control.ts` — back-fills sessions that were seeded before the table existed. Idempotent via the unique index.
- [x] Applied schema to Supabase via psql.
- [x] Verified: session 9839 → 109 messages seeded → `/api/race-control?session_key=9839` returns 200 in prod.

## Next

- [ ] Run full backfill across the remaining 88 sessions: `npx tsx scripts/backfill-race-control.ts` (no SESSION_KEY filter). ~89 × 400ms = ~36s minimum, expect a few minutes with API latency.
- [ ] Commit the schema + seed changes on the `security-fixes` branch (or split into its own branch — race_control isn't a security fix).
- [ ] Decide whether to keep `api/race-control.ts`'s "Database query failed" generic message or include a session-not-found 404 case once the schema is correct everywhere.
