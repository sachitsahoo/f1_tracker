# src/api/ — API Layer

All external data fetching lives here. No React, no hooks — pure async functions returning typed data.

## Files

- `openf1.ts` — All OpenF1 REST fetch functions
- `multiviewer.ts` — Circuit path fetch from MultiViewer

## Rules

- Every function must have a typed return value using interfaces from `src/types/f1.ts`
- Never hardcode session keys — accept `sessionKey: number | 'latest'` as a parameter
- Always use `date_gt` query param when polling to avoid re-fetching stale data
- On HTTP error or rate limit (429), throw a typed error — let hooks handle retry logic
- No polling logic here — that belongs in `src/hooks/`

## OpenF1 Base URL

`https://api.openf1.org/v1/`

Rate limit: 6 req/s, 60 req/min (sponsor tier). Add `date_gt=<ISO timestamp>` to incremental polls.

## MultiViewer Base URL

`https://api.multiviewer.app/api/v1/circuits/{circuitKey}/{year}`

Circuit key comes from OpenF1 `/v1/meetings` → `circuit_key` field.
