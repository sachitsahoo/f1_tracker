// ─── Country flag utilities ───────────────────────────────────────────────────
// Maps OpenF1's IOC 3-letter country codes → ISO 3166-1 alpha-2 codes.
// Flag images served via flagcdn.com (free, no key required).
//
// OpenF1 uses IOC codes (e.g. "NED", "GBR") which differ from ISO alpha-3
// in a handful of cases (notably GBR vs GBR, MON vs MCO, GER vs DEU).
//
// NOTE: OpenF1 returns country_code = null for 2026 season drivers.
// Use getDriverFlagUrl(countryCode, nameAcronym) which falls back to the
// DRIVER_ACRONYM_COUNTRIES static map when country_code is absent.

export const IOC_TO_ALPHA2: Record<string, string> = {
  // ── Active F1 grid nations ──────────────────────────────────────────────
  GBR: "gb", // Great Britain
  NED: "nl", // Netherlands
  MON: "mc", // Monaco
  ESP: "es", // Spain
  AUS: "au", // Australia
  FRA: "fr", // France
  GER: "de", // Germany
  ITA: "it", // Italy
  JPN: "jp", // Japan
  CAN: "ca", // Canada
  THA: "th", // Thailand
  USA: "us", // United States
  NZL: "nz", // New Zealand
  CHN: "cn", // China
  DEN: "dk", // Denmark
  FIN: "fi", // Finland
  ARG: "ar", // Argentina
  BRA: "br", // Brazil
  MEX: "mx", // Mexico
  POL: "pl", // Poland
  AUT: "at", // Austria
  BEL: "be", // Belgium
  SUI: "ch", // Switzerland
  RUS: "ru", // Russia
  IND: "in", // India
  RSA: "za", // South Africa
  MAR: "ma", // Morocco
  COL: "co", // Colombia
  VEN: "ve", // Venezuela
  // ── ISO alpha-3 fallbacks (some APIs use standard ISO codes) ────────────
  GBR3: "gb",
  MCO: "mc",
  DEU: "de",
  NLD: "nl",
  DNK: "dk",
};

// ─── Static driver acronym → IOC country code ────────────────────────────────
// Fallback for seasons where OpenF1 returns country_code = null (e.g. 2026).
// Keyed by the three-letter name_acronym field from the /v1/drivers endpoint.
// Covers the 2023–2026 grid; add new entries when drivers join the grid.

export const DRIVER_ACRONYM_COUNTRIES: Record<string, string> = {
  // 2025–2026 grid
  VER: "NED", // Max Verstappen
  LAW: "NZL", // Liam Lawson
  LEC: "MON", // Charles Leclerc
  HAM: "GBR", // Lewis Hamilton
  RUS: "GBR", // George Russell
  ANT: "ITA", // Andrea Kimi Antonelli
  NOR: "GBR", // Lando Norris
  PIA: "AUS", // Oscar Piastri
  ALO: "ESP", // Fernando Alonso
  STR: "CAN", // Lance Stroll
  GAS: "FRA", // Pierre Gasly
  DOO: "AUS", // Jack Doohan
  HAD: "FRA", // Isack Hadjar
  TSU: "JPN", // Yuki Tsunoda
  HUL: "GER", // Nico Hülkenberg
  BOR: "BRA", // Gabriel Bortoleto
  BEA: "GBR", // Oliver Bearman
  OCO: "FRA", // Esteban Ocon
  SAI: "ESP", // Carlos Sainz
  ALB: "THA", // Alex Albon
  // 2024 drivers not in 2025 grid
  MAG: "DEN", // Kevin Magnussen
  BOT: "FIN", // Valtteri Bottas
  ZHO: "CHN", // Guanyu Zhou
  SAR: "USA", // Logan Sargeant
  RIC: "AUS", // Daniel Ricciardo
  COL: "ARG", // Franco Colapinto
  PER: "MEX", // Sergio Pérez
  LAT: "CAN", // Nicholas Latifi
  LIN: "GBR", // Arvid Lindblad
  DEV: "NED", // Nyck de Vries
  // 2023 drivers
  POU: "FRA", // Théo Pourchaire
  MSC: "GER", // Mick Schumacher
  HUL2: "GER", // Nico Hülkenberg (alt acronym)
  ZHO2: "CHN", // Guanyu Zhou (alt)
};

// ─── Core lookup ──────────────────────────────────────────────────────────────

function alpha2FromCode(code: string | undefined | null): string | null {
  if (!code) return null;
  return IOC_TO_ALPHA2[code.toUpperCase().trim()] ?? null;
}

/**
 * Returns a flagcdn.com image URL for a given IOC/ISO country code.
 * Returns null if the code is unknown.
 *
 * Prefer `getDriverFlagUrl` when you also have the driver's name_acronym —
 * it handles seasons where OpenF1 returns country_code = null.
 *
 * @example
 * getFlagUrl("NED") // "https://flagcdn.com/w20/nl.png"
 * getFlagUrl("GBR") // "https://flagcdn.com/w20/gb.png"
 */
export function getFlagUrl(
  countryCode: string | undefined | null,
): string | null {
  const alpha2 = alpha2FromCode(countryCode);
  if (!alpha2) return null;
  return `https://flagcdn.com/w20/${alpha2}.png`;
}

/**
 * Returns a 2x (40px wide) hi-DPI flag URL for retina displays.
 */
export function getFlagUrl2x(
  countryCode: string | undefined | null,
): string | null {
  const alpha2 = alpha2FromCode(countryCode);
  if (!alpha2) return null;
  return `https://flagcdn.com/w40/${alpha2}.png`;
}

/**
 * Preferred flag URL resolver when you have a full Driver object.
 *
 * Resolution order:
 *  1. driver.country_code from the API (populated for 2024 and earlier)
 *  2. DRIVER_ACRONYM_COUNTRIES static fallback (covers 2026 where API returns null)
 *  3. null → render placeholder
 */
export function getDriverFlagUrl(
  countryCode: string | undefined | null,
  nameAcronym: string | undefined | null,
  size: 1 | 2 = 1,
): string | null {
  // Try API-supplied country code first
  const fromCode = alpha2FromCode(countryCode);
  if (fromCode) {
    return size === 2
      ? `https://flagcdn.com/w40/${fromCode}.png`
      : `https://flagcdn.com/w20/${fromCode}.png`;
  }

  // Fall back to static acronym map
  if (nameAcronym) {
    const ioc = DRIVER_ACRONYM_COUNTRIES[nameAcronym.toUpperCase().trim()];
    const alpha2 = alpha2FromCode(ioc);
    if (alpha2) {
      return size === 2
        ? `https://flagcdn.com/w40/${alpha2}.png`
        : `https://flagcdn.com/w20/${alpha2}.png`;
    }
  }

  return null;
}
