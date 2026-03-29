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

| Endpoint | What it gives you | Update frequency |
|---|---|---|
| `/v1/sessions?year=2026` | Active session key | On demand |
| `/v1/position?session_key=latest` | Race position (P1–P20) per driver | Every 4 seconds |
| `/v1/location?session_key=latest` | X/Y/Z car coordinates on track | ~3.7 Hz (telemetry) |
| `/v1/drivers?session_key=latest` | Driver number, name, team, abbreviation | Static per session |
| `/v1/intervals?session_key=latest` | Gap to leader, gap ahead | Every 4 seconds |
| `/v1/stints?session_key=latest` | Tire compound, lap stint started | Per pit stop |
| `/v1/race_control?session_key=latest` | Safety car, flags, incidents | Event-driven |
| `/v1/laps?session_key=latest` | Lap times, sector times | Per lap |

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
const res = await fetch('https://api.multiviewer.app/api/v1/circuits/3/2026');
const data = await res.json(); // includes x/y path coordinates
```

Circuit keys map to OpenF1's `circuit_key` field in the `/v1/meetings` endpoint.

---

### Alternative / Fallback APIs

| API | Strengths | Limitations |
|---|---|---|
| **FastF1** (Python library) | Best historical telemetry, full X/Y car position, tire data | Python only, not a REST API — needs a backend |
| **Ergast API** | Historical results back to 1950, very stable | Deprecated, shutting down soon, no live data |
| **API-Sports F1** | Season standings, results | Paid, no live car position |
| **F1 Live Timing (SignalR stream)** | Official real-time data, same feed MultiViewer uses | Requires reverse-engineering, some data now locked behind F1 TV |
| **livef1 (PyPI)** | Real-time + historical, X/Y/Z positions | Python only, needs backend |

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
  x: number, y: number,
  minX: number, maxX: number,
  minY: number, maxY: number,
  svgWidth: number, svgHeight: number
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
const sessions = await fetch('https://api.openf1.org/v1/sessions?year=2026');
// Filter for session_type = 'Race' and most recent date
```

### Polling vs. WebSocket

- **Free tier (REST polling):** Poll `/location` every 1s, `/position` every 4s. Efficient with `date_gt` filter.
- **Authenticated (WebSocket/MQTT):** Push-based, near-instant. Requires sponsoring OpenF1. Better for production.

### Off-Season / No Live Session

When no session is live, `session_key=latest` returns the most recent historical session. The app will still work but shows past race data — make this clear in the UI with a "REPLAY" badge.

---

## Driver & Team Colors (2026 Grid)

```ts
export const TEAM_COLORS: Record<string, string> = {
  red_bull:     '#3671C6',
  ferrari:      '#E8002D',
  mercedes:     '#27F4D2',
  mclaren:      '#FF8000',
  aston_martin: '#229971',
  alpine:       '#FF87BC',
  williams:     '#64C4FF',
  rb:           '#6692FF',
  kick_sauber:  '#52E252',
  haas:         '#B6BABD',
};
```

Match via `driver.team_name` from the `/v1/drivers` endpoint.

---

## Development Commands

```bash
npm run dev       # Start local dev server
npm run build     # Production build
npm run typecheck # tsc --noEmit
npm run lint      # ESLint
```

---

## Notes for AI Assistance

- All API calls should be typed with interfaces in `src/types/f1.ts`
- Polling intervals should be managed via `useInterval` hook, cleaned up on unmount
- SVG driver dots should use CSS transitions for smooth movement between position updates
- The app must gracefully handle no-session states (off-season) and API rate limit errors
- Do not hardcode session keys or driver lists — always derive from API responses
