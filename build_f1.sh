#!/bin/bash

# =============================================================================
# build_f1.sh — F1 Live Tracker: 0 to 100 orchestrator
# Uses memory.sh for context-aware, incremental Claude builds
# Usage: chmod +x build_f1.sh && ./build_f1.sh
#
# Run from INSIDE the f1-live-tracker/ project directory.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEMORY_SH="$SCRIPT_DIR/memory.sh"   # FIX 1: memory.sh lives in the project root, not $HOME
PROJECT_DIR="$SCRIPT_DIR"           # FIX 2: we ARE the project — no nested f1-live-tracker/
MEMORY_FILE="$PROJECT_DIR/.claude-memory.md"
LESSONS_FILE="$PROJECT_DIR/tasks/lessons.md"

# ── colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'

log()  { echo -e "${CYAN}[BUILD]${RESET} $1"; }
ok()   { echo -e "${GREEN}[DONE] ${RESET} $1"; }
warn() { echo -e "${YELLOW}[WARN] ${RESET} $1"; }
fail() { echo -e "${RED}[FAIL] ${RESET} $1"; exit 1; }
sep()  { echo -e "\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"; }

# ── sanity checks ─────────────────────────────────────────────────────────────
[ -f "$MEMORY_SH" ] || fail "memory.sh not found at $MEMORY_SH"
[ -x "$MEMORY_SH" ] || chmod +x "$MEMORY_SH"
command -v node &>/dev/null || fail "Node.js is required"
command -v npm  &>/dev/null || fail "npm is required"

# ── helpers ───────────────────────────────────────────────────────────────────

append_memory() {
  local msg="$1"
  mkdir -p "$(dirname "$MEMORY_FILE")"
  echo -e "\n## $(date '+%Y-%m-%d %H:%M') — $msg" >> "$MEMORY_FILE"
}

append_lesson() {
  local msg="$1"
  mkdir -p "$PROJECT_DIR/tasks"
  echo -e "- $msg" >> "$LESSONS_FILE"
}

run_phase() {
  local phase_name="$1"
  local prompt="$2"

  sep
  log "Phase: ${BOLD}$phase_name${RESET}"
  echo ""

  (cd "$PROJECT_DIR" && bash "$MEMORY_SH" "$prompt")

  append_memory "Completed phase: $phase_name"
  ok "$phase_name complete"
}

# ── phase 0: scaffold ─────────────────────────────────────────────────────────
sep
log "${BOLD}Phase 0 — Verify project exists and is ready${RESET}"

# FIX 2 (continued): PROJECT_DIR is now the current dir, so check for package.json
# instead of a nested directory. Scaffold is already done.
if [ -f "$PROJECT_DIR/package.json" ]; then
  warn "Project already scaffolded — skipping npm create"
else
  fail "No package.json found in $PROJECT_DIR. Run: npm create vite@latest . -- --template react-ts && npm install"
fi

cd "$PROJECT_DIR"

# Ensure node_modules exist
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  log "node_modules missing — running npm install"
  npm install
fi

# Ensure git is initialised
if ! git rev-parse --git-dir &>/dev/null; then
  git init && git add -A && git commit -m "chore: initial vite scaffold"
fi

# Seed memory + lessons files
mkdir -p tasks
[ -f "$MEMORY_FILE" ] || cat > "$MEMORY_FILE" <<'EOF'
# Claude Memory — F1 Live Tracker

## Project goal
Real-time F1 race tracker: SVG circuit map (left) + live leaderboard (right).
Stack: React + TypeScript + Vite.
Primary API: OpenF1 (https://api.openf1.org/v1/) — free, no key required.
Circuit maps: MultiViewer API (https://api.multiviewer.app/api/v1/circuits/{key}/{year}).
EOF

[ -f "$LESSONS_FILE" ] || cat > "$LESSONS_FILE" <<'EOF'
# Lessons Learned

- Never hardcode session_key or driver numbers — always derive from API
- All API shapes need TypeScript interfaces in src/types/f1.ts before use
- Every setInterval must be cleaned up in useEffect return
- Raw OpenF1 X/Y coords must pass through normalizeCoords() before SVG render
EOF

append_memory "Project verified and memory seeded"
ok "Phase 0 complete"

# ── phase 1: types + api layer ────────────────────────────────────────────────
run_phase "Types + API Layer" \
"Create src/types/f1.ts with TypeScript interfaces for every OpenF1 endpoint we use: Session, Driver, Position, Location, Interval, Stint, RaceControl, Lap. Then create src/api/openf1.ts with typed fetch functions for each endpoint (getLatestSession, getDrivers, getPositions, getLocations, getIntervals, getStints, getRaceControl, getLaps). Add src/api/multiviewer.ts with a getCircuit(circuitKey, year) function. All functions must return typed data. No 'any'. IMPORTANT: preserve any existing CLAUDE.md files in src/ subdirectories — do not delete or overwrite them. Follow the PROJECT RULES in CLAUDE.md. After writing, run: npx tsc --noEmit and fix any errors before finishing."

git add -A && git commit -m "feat: types and API layer"
append_lesson "Always run tsc --noEmit after writing types to catch shape mismatches early"

# ── phase 2: hooks ────────────────────────────────────────────────────────────
# FIX 3: added useStints.ts — it was referenced in phase 7 but never built
run_phase "Polling Hooks" \
"Create a shared src/hooks/useInterval.ts hook that wraps setInterval with proper useEffect cleanup. Then create five hooks: useSession.ts (fetches latest Race session from /v1/sessions), useDrivers.ts (driver list + team colors), usePositions.ts (polls /v1/position + /v1/intervals every 4s using date_gt filter), useLocations.ts (polls /v1/location every 1s using date_gt filter), useStints.ts (polls /v1/stints every 30s — tire data changes rarely). All hooks must use the useInterval hook for polling — no raw setInterval calls. All state must be typed using interfaces from src/types/f1.ts. Handle loading and error states. IMPORTANT: preserve any existing CLAUDE.md files in src/hooks/ — do not delete or overwrite them."

git add -A && git commit -m "feat: polling hooks with cleanup"
append_lesson "useInterval hook centralises cleanup — all polling goes through it, never raw setInterval"

# ── phase 3: coordinate utils + team colors ───────────────────────────────────
run_phase "Utilities" \
"Create src/utils/coordinates.ts with a normalizeCoords(x, y, minX, maxX, minY, maxY, svgWidth, svgHeight) function that maps raw OpenF1 telemetry integers to SVG viewport coordinates. Also add computeBounds(locations: Location[]) that returns {minX, maxX, minY, maxY} from an array of location points. Create src/utils/teamColors.ts with the TEAM_COLORS map from CLAUDE.md and a getTeamColor(teamName: string) helper. All functions fully typed."

git add -A && git commit -m "feat: coordinate normalisation and team color utils"
append_lesson "Compute bounds once on circuit load, then reuse for all driver dot normalisation"

# ── phase 4: SVG track map ────────────────────────────────────────────────────
# FIX 4: explicit instruction to preserve CLAUDE.md in src/components/
run_phase "TrackMap Component" \
"Create src/components/DriverDot.tsx — a small SVG circle for a driver, takes position (svgX, svgY), color, abbreviation as props typed with interfaces from src/types/f1.ts. Use CSS transition: all 0.8s ease for smooth movement. Create src/components/TrackMap.tsx — fetches the circuit outline from MultiViewer API using the circuitKey prop, renders it as an SVG <path>, then overlays a DriverDot for each driver whose location data is available. Normalise all coordinates via normalizeCoords() — never use raw values. Show a loading skeleton while the circuit loads. IMPORTANT: preserve the existing CLAUDE.md in src/components/ — do not delete or overwrite it."

git add -A && git commit -m "feat: SVG track map with animated driver dots"
append_lesson "CSS transition on DriverDot SVG circles gives smooth movement between 1s polling updates"

# ── phase 5: leaderboard ─────────────────────────────────────────────────────
run_phase "Leaderboard Component" \
"Create src/components/Leaderboard.tsx. It receives the sorted positions array and renders a ranked table with: position number, driver abbreviation, team color swatch, gap to leader (from intervals data), current tire compound + age (from stints data), last lap time. Use team colors from getTeamColor(). Highlight P1 row. Mark the current lap / total laps in the header. If no live session, show a REPLAY badge. All props typed using interfaces from src/types/f1.ts. IMPORTANT: preserve the existing CLAUDE.md in src/components/ — do not delete or overwrite it."

git add -A && git commit -m "feat: leaderboard with gaps, tires, team colors"
append_lesson "Leaderboard must handle missing interval/stint data gracefully — gaps appear mid-race only"

# ── phase 6: status bar ───────────────────────────────────────────────────────
run_phase "StatusBar + RaceControl" \
"Create src/components/StatusBar.tsx that displays: session name, current lap / total laps, session status (live / replay / off-season), and the most recent race control message (safety car, VSC, flag) from /v1/race_control. Colour the bar yellow for SC/VSC, red for red flag, green for clear. Poll race_control every 10s via useInterval. All props typed using interfaces from src/types/f1.ts. IMPORTANT: preserve the existing CLAUDE.md in src/components/ — do not delete or overwrite it."

git add -A && git commit -m "feat: status bar with flags and race control messages"

# ── phase 7: wire everything in App.tsx ───────────────────────────────────────
run_phase "App.tsx Integration" \
"Rewrite src/App.tsx to compose the full layout: StatusBar across the top, TrackMap on the left (~60% width), Leaderboard on the right (~40%). Wire all hooks together: useSession → sessionKey, useDrivers(sessionKey) → drivers, usePositions(sessionKey) → positions + intervals, useLocations(sessionKey) → locations, useStints(sessionKey) → stints. Pass the correct circuitKey from session data to TrackMap. Handle the off-season state (no live session) with a clear REPLAY banner. Ensure the page is responsive down to 1024px wide."

git add -A && git commit -m "feat: full app layout wired together"
append_lesson "Pass circuitKey from session.circuit_key — do not hardcode it"

# ── phase 8: error handling + rate limits ─────────────────────────────────────
run_phase "Error Handling + Rate Limits" \
"Add a global error boundary in src/components/ErrorBoundary.tsx. In each API function in src/api/openf1.ts, handle HTTP 429 (rate limit) by backing off for 60s and retrying once — log a warning in the UI via a small toast or StatusBar message. Handle network errors gracefully: show stale data with a 'Connection lost' indicator rather than crashing. Add a retry button to the error boundary fallback UI. IMPORTANT: preserve the existing CLAUDE.md in src/components/ — do not delete or overwrite it."

git add -A && git commit -m "feat: error boundary, rate limit backoff, stale data indicator"
append_lesson "OpenF1 free tier: 3 req/s, 30 req/min. Back off on 429 — do not hammer the endpoint"

# ── phase 9: polish ───────────────────────────────────────────────────────────
run_phase "Polish + Production Build" \
"Apply final polish: (1) Add a dark theme matching F1 aesthetics — dark background (#0f0f0f), white text, team colors for accents. (2) Add a loading skeleton for the initial data fetch. (3) Add a <title> and favicon referencing F1. (4) Run npx tsc --noEmit and fix all type errors. (5) Run npm run build and confirm it succeeds with no warnings. (6) Update .claude-memory.md with a summary of the completed architecture."

git add -A && git commit -m "feat: dark theme, loading skeletons, production build passing"
append_lesson "Final build check: tsc --noEmit + npm run build must both pass before shipping"

# ── done ──────────────────────────────────────────────────────────────────────
sep
echo -e "\n${GREEN}${BOLD}  F1 Live Tracker build complete!${RESET}"
echo ""
echo -e "  ${CYAN}npm run dev${RESET}"
echo ""
echo -e "  Phases completed:"
echo -e "   0  Project verified (Vite + React + TS)"
echo -e "   1  Types + API layer (OpenF1 + MultiViewer)"
echo -e "   2  Polling hooks with cleanup (incl. useStints)"
echo -e "   3  Coordinate normalisation + team colors"
echo -e "   4  SVG TrackMap + animated DriverDots"
echo -e "   5  Leaderboard (gaps, tires, team colors)"
echo -e "   6  StatusBar + race control flags"
echo -e "   7  Full App.tsx integration"
echo -e "   8  Error handling + rate limit backoff"
echo -e "   9  Polish + production build"
echo ""
sep
