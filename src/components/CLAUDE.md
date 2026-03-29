# src/components/ — UI Components

Pure presentational and composite React components. Consume hooks; do not fetch data directly.

## Files

- `TrackMap.tsx` — SVG circuit outline with animated driver dots
- `Leaderboard.tsx` — Right-panel ranked driver list with gaps, tires, team colors
- `DriverDot.tsx` — Single animated car marker on the SVG map
- `StatusBar.tsx` — Session status badge, flag state, current lap / total laps

## Rules

- No `fetch` or `useInterval` calls inside components — consume hooks from `src/hooks/`
- Driver dot positions must use CSS `transition` for smooth movement between 1s updates
- Use team colors from `src/utils/teamColors.ts` — never hardcode hex values here
- Show a "REPLAY" badge in `StatusBar` when the session is not live (historical data)
- All SVG coordinates must come from `src/utils/coordinates.ts` normalization — never
  render raw OpenF1 telemetry X/Y values directly
- Handle loading and error states visibly — blank screens are not acceptable
