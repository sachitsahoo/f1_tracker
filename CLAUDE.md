# F1 Live Tracker — CLAUDE.md

Project context and architecture guide for AI-assisted development.

---

## Project Overview

A real-time F1 race tracker that displays driver positions on a circuit map with a live leaderboard. The left panel shows an SVG circuit map with colored driver dots moving in near-real-time. The right panel shows a ranked leaderboard with gaps, tire compounds, and team colors.

---

## Tech Stack Recommendation

**Use TypeScript + React + Vite.**

TypeScript is strongly recommended for this project because:

- The OpenF1 API returns complex nested JSON — typed interfaces catch shape mismatches early
- Driver, session, position, and telemetry data structures all benefit from explicit typing
- SVG coordinate math (normalizing X/Y telemetry into viewport coords) is error-prone without types
- Scales better when adding features like lap history, tire strategy, etc.

Scaffolding:

```bash
npm create vite@latest f1-live-tracker -- --template react-ts
cd f1-live-tracker
npm install
```

---

## APIs

### Primary: OpenF1 (Recommended)

**URL:** `https://api.openf1.org/v1/`  
**Cost:** Free, no API key required for historical + polling use  
**Rate limit:** 3 req/s, 30 req/min on the free tier  
**Docs:** https://openf1.org/docs/

Key endpoints for this project:

| Endpoint                              | What it gives you                       | Update frequency    |
| ------------------------------------- | --------------------------------------- | ------------------- |
| `/v1/sessions?year=2026`              | Active session key                      | On demand           |
| `/v1/position?session_key=latest`     | Race position (P1–P20) per driver       | Every 4 seconds     |
| `/v1/location?session_key=latest`     | X/Y/Z car coordinates on track          | ~3.7 Hz (telemetry) |
| `/v1/drivers?session_key=latest`      | Driver number, name, team, abbreviation | Static per session  |
| `/v1/intervals?session_key=latest`    | Gap to leader, gap ahead                | Every 4 seconds     |
| `/v1/stints?session_key=latest`       | Tire compound, lap stint started        | Per pit stop        |
| `/v1/race_control?session_key=latest` | Safety car, flags, incidents            | Event-driven        |
| `/v1/laps?session_key=latest`         | Lap times, sector times                 | Per lap             |

**Authentication:** None required for REST polling. For WebSocket/MQTT streaming (more efficient), you need a paid sponsor account.

**Critical caveat on location data:** F1 locked raw GPS/position data behind F1 TV subscription in 2025. OpenF1 still provides X/Y coordinates via their `/v1/location` endpoint derived from telemetry, but as of the 2025 Dutch GP, some third-party projects (like f1-dash) report this data is no longer freely streamed. **Test this endpoint during a live session before relying on it.** Fallback: use mini-sector position approximation (see below).

**Polling strategy:**

```ts
// Poll /v1/location every 1s during live session
// Poll /v1/position and /v1/intervals every 4s
// Use ?date_gt= filter to only fetch new data since last poll
```

Example filtered location request:

```
GET https://api.openf1.org/v1/location?session_key=9958&date_gt=2025-03-16T14:00:00Z
```

---

### Track Map: MultiViewer Circuit API (Recommended)

**URL:** `https://api.multiviewer.app/api/v1/circuits/{circuitKey}/{year}`  
**Cost:** Free, unofficial  
**Returns:** SVG-ready circuit path coordinates, corner labels, marshal sector positions

This is the cleanest source for circuit outlines. FastF1 also credits MultiViewer for its circuit data.

```ts
// Example: Get 2026 Bahrain circuit
const res = await fetch("https://api.multiviewer.app/api/v1/circuits/3/2026");
const data = await res.json(); // includes x/y path coordinates
```

Circuit keys map to OpenF1's `circuit_key` field in the `/v1/meetings` endpoint.

---

### Alternative / Fallback APIs

| API                                 | Strengths                                                   | Limitations                                                     |
| ----------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| **FastF1** (Python library)         | Best historical telemetry, full X/Y car position, tire data | Python only, not a REST API — needs a backend                   |
| **Ergast API**                      | Historical results back to 1950, very stable                | Deprecated, shutting down soon, no live data                    |
| **API-Sports F1**                   | Season standings, results                                   | Paid, no live car position                                      |
| **F1 Live Timing (SignalR stream)** | Official real-time data, same feed MultiViewer uses         | Requires reverse-engineering, some data now locked behind F1 TV |
| **livef1 (PyPI)**                   | Real-time + historical, X/Y/Z positions                     | Python only, needs backend                                      |

---

## Architecture

```
f1-live-tracker/
├── src/
│   ├── api/
│   │   ├── openf1.ts          # All OpenF1 fetch functions + types
│   │   └── multiviewer.ts     # Circuit path fetch + normalization
│   ├── hooks/
│   │   ├── useSession.ts      # Current session key
│   │   ├── useDrivers.ts      # Driver list + team colors
│   │   ├── usePositions.ts    # Race positions + intervals (4s poll)
│   │   └── useLocations.ts    # X/Y car coords (1s poll)
│   ├── components/
│   │   ├── TrackMap.tsx       # SVG circuit + driver dots
│   │   ├── Leaderboard.tsx    # Right panel rankings
│   │   ├── DriverDot.tsx      # Individual animated car marker
│   │   └── StatusBar.tsx      # Session status, flags, lap count
│   ├── utils/
│   │   ├── coordinates.ts     # Normalize telemetry X/Y → SVG viewport
│   │   └── teamColors.ts      # Driver number → team hex color
│   ├── types/
│   │   └── f1.ts              # Shared TypeScript interfaces
│   └── App.tsx
```

---

## Key Implementation Notes

### Coordinate Normalization

OpenF1 location data returns raw telemetry coordinates (large integers, circuit-specific). These must be normalized to fit the SVG viewport:

```ts
function normalizeCoords(
  x: number,
  y: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  svgWidth: number,
  svgHeight: number,
) {
  return {
    svgX: ((x - minX) / (maxX - minX)) * svgWidth,
    svgY: ((y - minY) / (maxY - minY)) * svgHeight,
  };
}
```

Compute min/max from the circuit path data on first load, then apply to all driver positions.

### Session Key

Always fetch the latest session dynamically — hardcoding it breaks between race weekends:

```ts
const sessions = await fetch("https://api.openf1.org/v1/sessions?year=2026");
// Filter for session_type = 'Race' and most recent date
```

### Polling vs. WebSocket

- **Free tier (REST polling):** Poll `/location` every 1s, `/position` every 4s. Efficient with `date_gt` filter.
- **Authenticated (WebSocket/MQTT):** Push-based, near-instant. Requires sponsoring OpenF1. Better for production.
- **Paid tier (current):** MQTT push from OpenF1 during live sessions — frontend never calls OpenF1 directly, all data goes through the backend API.

### Off-Season / No Live Session

When no session is live, `session_key=latest` returns the most recent historical session. The app will still work but shows past race data — make this clear in the UI with a "REPLAY" badge.

---

## Driver & Team Colors (2026 Grid)

```ts
export const TEAM_COLORS: Record<string, string> = {
  red_bull: "#3671C6",
  ferrari: "#E8002D",
  mercedes: "#27F4D2",
  mclaren: "#FF8000",
  aston_martin: "#229971",
  alpine: "#FF87BC",
  williams: "#64C4FF",
  rb: "#6692FF",
  kick_sauber: "#52E252",
  haas: "#B6BABD",
};
```

Match via `driver.team_name` from the `/v1/drivers` endpoint.

---

## Backend Architecture

### Hosting

- **Backend:** Node + Fastify, deployed as Vercel Serverless Functions
- **Database:** Supabase (PostgreSQL) — used for both local dev (via Supabase CLI) and production
- **No Redis** — in-memory JS Maps for live race state (scoped to a long-lived process; see caveat below)
- **Frontend** hosted on Vercel alongside the backend

### OpenF1 Auth

NOT a static API key — uses username/password to fetch a JWT:

```
POST https://api.openf1.org/token
Content-Type: application/x-www-form-urlencoded

username=<email>&password=<password>
```

- JWT expires after ~3600s — must be fetched fresh each run
- Same JWT is used as the MQTT password for live data
- Credentials stored as `OPENF1_USERNAME` and `OPENF1_PASSWORD`
- **Never use `VITE_` prefix** — backend only, never exposed to browser

### Live Data Strategy

Paid OpenF1 subscription — MQTT push during live sessions.

In-memory JS Maps hold live state (no Redis needed):

```ts
const liveLocations = new Map<number, Location>();
const livePositions = new Map<number, Position>();
const liveIntervals = new Map<number, Interval>();
const liveStints = new Map<number, Stint>();
```

- **Calendar gate:** MQTT subscriber only active during live session windows (`date_start` to `date_end` + 2h buffer)
- **WebSocket to browsers:** snapshot on connect, delta pushes thereafter
- **Frontend never calls OpenF1 directly** — all calls go through the backend API

> **Vercel caveat:** Standard Serverless Functions are stateless and short-lived. The MQTT subscriber and in-memory Maps must run in a long-lived process (e.g., a Vercel Edge Function with streaming, or a dedicated background worker). Do not attempt to hold Map state across standard serverless invocations.

### Database

- Supabase project used for all environments; local dev uses `supabase start` (Supabase CLI)
- Schema lives in `supabase/migrations/` (managed via Supabase CLI migrations)
- Seed script: `scripts/seed.ts` — run against local Supabase instance or remote via `DATABASE_URL`
- 89 sessions seeded (2023–2025), ~289MB
- Includes Race and Sprint sessions; `session_name` field distinguishes them in the UI
- `lap_start` is nullable on stints (OpenF1 returns null for some)
- One location snapshot per driver per lap (not raw 3.7Hz)
- Foreign keys use `DEFERRABLE INITIALLY DEFERRED`
- Use Supabase client (`@supabase/supabase-js`) for all DB queries from API routes — never use raw `pg` directly

### Implementation Phases

**Phase 1 — DB + REST proxy**
Stand up Fastify API routes on Vercel, proxy OpenF1 calls, serve from Supabase for historical sessions. Frontend points at backend API instead of OpenF1 directly.

**Phase 2 — WebSocket + in-memory state**
Add WS server (requires long-lived runtime — not standard Vercel Functions). Seed in-memory Maps from REST on session start, fan out to connected clients. Clients switch from polling to WS.

**Phase 3 — Swap REST for MQTT push**
Replace Phase 2 REST polling with MQTT subscriber. In-memory update logic and WS broadcast unchanged — one file swap.

### Environment Variables

```
OPENF1_USERNAME=           # OpenF1 account email
OPENF1_PASSWORD=           # OpenF1 account password
SUPABASE_URL=              # Supabase project URL (from Supabase dashboard)
SUPABASE_SERVICE_ROLE_KEY= # Service role key — backend only, never expose to browser
DATABASE_URL=              # Direct Postgres connection string (for seed script / migrations)
DELAY_MS=150               # Seed script request delay (paid tier)
```

---

## Development Commands

```bash
npm run dev       # Start local dev server
npm run build     # Production build
npm run typecheck # tsc --noEmit
npm run lint      # ESLint
```

---

## PROJECT RULES

These rules are enforced across the entire codebase. Any AI-generated or human-written code must comply.

### Rule 1 — Never hardcode session keys or driver numbers

`session_key` and driver numbers must **never** appear as literals in source code.
Always derive them from API responses:

- `session_key` → `/v1/sessions` (filter by `session_type` and most recent date)
- Driver numbers → `/v1/drivers?session_key=<key>`

### Rule 2 — TypeScript interfaces required for all API responses

Every OpenF1 API response shape must have a TypeScript interface defined in `src/types/f1.ts` **before** it is used anywhere in the codebase. No `any`, no inline object shapes, no ad-hoc casting.

### Rule 3 — Polling cleanup is mandatory

Every `useInterval` or `setInterval` call must have a corresponding cleanup returned from `useEffect`. Intervals must never be left running after a component unmounts. Use the shared `useInterval` hook for all polling.

### Rule 4 — SVG coordinate normalization is mandatory

Raw OpenF1 X/Y telemetry values must **never** be rendered into SVG directly. All coordinates must be passed through `normalizeCoords()` in `src/utils/coordinates.ts` before use in any SVG element.

---

## Notes for AI Assistance

- All API calls should be typed with interfaces in `src/types/f1.ts`
- Polling intervals should be managed via `useInterval` hook, cleaned up on unmount
- SVG driver dots should use CSS transitions for smooth movement between position updates
- The app must gracefully handle no-session states (off-season) and API rate limit errors
- Do not hardcode session keys or driver lists — always derive from API responses
