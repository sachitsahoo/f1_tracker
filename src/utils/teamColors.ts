// ─── 2026 Constructor colour palette ─────────────────────────────────────────
// Keys match the snake_case team_name field returned by OpenF1 /v1/drivers.

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
} as const;

/** Fallback colour rendered when a team name is unrecognised. */
const FALLBACK_COLOR = "#FFFFFF";

// ─── getTeamColor ─────────────────────────────────────────────────────────────

/**
 * Returns the hex colour string for a given team name.
 *
 * @param teamName - The snake_case team_name from OpenF1 /v1/drivers
 *                   (e.g. "red_bull", "kick_sauber").  The lookup is
 *                   case-insensitive and trims surrounding whitespace so that
 *                   minor API inconsistencies don't cause silent misses.
 * @returns A CSS hex colour string (e.g. "#3671C6"), or white if unknown.
 */
export function getTeamColor(teamName: string): string {
  const normalised = teamName.trim().toLowerCase();
  return TEAM_COLORS[normalised] ?? FALLBACK_COLOR;
}
