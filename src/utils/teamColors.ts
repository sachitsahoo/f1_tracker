// ─── 2026 Constructor colour palette ─────────────────────────────────────────
// Keyed by every known variant of the team name that OpenF1 may return:
// snake_case slugs, full display names, and common abbreviations.
// Add new variants here if the API changes naming conventions mid-season.

export const TEAM_COLORS: Record<string, string> = {
  // Red Bull
  red_bull: "#3671C6",
  "red bull racing": "#3671C6",
  "red bull": "#3671C6",

  // Ferrari
  ferrari: "#E8002D",
  "scuderia ferrari": "#E8002D",
  "scuderia ferrari hp": "#E8002D",

  // Mercedes
  mercedes: "#27F4D2",
  "mercedes-amg petronas f1 team": "#27F4D2",
  "mercedes amg petronas": "#27F4D2",

  // McLaren
  mclaren: "#FF8000",
  "mclaren f1 team": "#FF8000",

  // Aston Martin
  aston_martin: "#229971",
  "aston martin": "#229971",
  "aston martin aramco": "#229971",
  "aston martin f1 team": "#229971",

  // Alpine
  alpine: "#FF87BC",
  "alpine f1 team": "#FF87BC",
  "bwt alpine f1 team": "#FF87BC",

  // Williams
  williams: "#64C4FF",
  "williams racing": "#64C4FF",

  // Racing Bulls (formerly AlphaTauri / Toro Rosso)
  rb: "#6692FF",
  "racing bulls": "#6692FF",
  "visa cash app rb": "#6692FF",
  "visa cash app rb f1 team": "#6692FF",
  alphatauri: "#6692FF",
  "scuderia alphatauri": "#6692FF",

  // Kick Sauber (formerly Alfa Romeo)
  kick_sauber: "#52E252",
  "kick sauber": "#52E252",
  sauber: "#52E252",
  "stake f1 team kick sauber": "#52E252",
  "alfa romeo": "#52E252",

  // Haas
  haas: "#B6BABD",
  "haas f1 team": "#B6BABD",
  "moneygramm haas f1 team": "#B6BABD",
  "moneygram haas f1 team": "#B6BABD",
} as const;

/** Fallback colour rendered when a team name is unrecognised. */
const FALLBACK_COLOR = "#FFFFFF";

// ─── getTeamColor ─────────────────────────────────────────────────────────────

/**
 * Returns the hex colour string for a given team name.
 *
 * Accepts any casing or spacing variant — the lookup is normalised to
 * lowercase and trimmed before matching. Covers both the snake_case slugs
 * OpenF1 sometimes returns AND the full display names it returns in other
 * seasons/endpoints (e.g. "Red Bull Racing", "Haas F1 Team").
 *
 * Prefer `driverTeamColor()` when you have a full Driver object — it uses the
 * `team_colour` hex field that OpenF1 provides directly, which is always
 * authoritative regardless of how `team_name` is formatted.
 */
export function getTeamColor(teamName: string): string {
  const normalised = teamName.trim().toLowerCase();
  return TEAM_COLORS[normalised] ?? FALLBACK_COLOR;
}

// ─── driverTeamColor ──────────────────────────────────────────────────────────

/**
 * Preferred way to get a driver's team colour when you have the full Driver
 * object. Uses `driver.team_colour` (a 6-char hex without `#` supplied by
 * OpenF1) as the primary source, which is always correct regardless of how
 * `team_name` happens to be formatted in a given season.
 *
 * Falls back to the static map lookup only if `team_colour` is missing/empty.
 */
export function driverTeamColor(driver: {
  team_colour: string;
  team_name: string;
}): string {
  if (driver.team_colour && driver.team_colour.length === 6) {
    return `#${driver.team_colour}`;
  }
  return getTeamColor(driver.team_name);
}
