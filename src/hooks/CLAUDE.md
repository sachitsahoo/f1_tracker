# src/hooks/ — Data Hooks

React hooks that own polling logic and expose typed state to components. Each hook maps to one concern.

## Files

| Hook | Polls | Interval |
|---|---|---|
| `useSession.ts` | `/v1/sessions?year=2026` | On mount only |
| `useDrivers.ts` | `/v1/drivers?session_key=…` | On session change only |
| `usePositions.ts` | `/v1/position` + `/v1/intervals` | Every 4s |
| `useLocations.ts` | `/v1/location` | Every 1s |

## Rules

- **Never hardcode `session_key` or driver numbers** — receive `sessionKey` from `useSession`, driver data from `useDrivers`; never pass integer literals
- **All hook return types must use interfaces from `src/types/f1.ts`** — no `any`, no inline object shapes
- Use a shared `useInterval` hook for all polling — always clean up on unmount
- Pass `date_gt` of last received timestamp to each poll call to fetch only new data
- Return `{ data, loading, error }` shape from every hook
- When `sessionKey` is null/undefined, skip polling and return `loading: true`
- Surface rate-limit errors (429) distinctly so the UI can back off gracefully
- Never call the API directly — always go through `src/api/` functions
