// ─── Session ────────────────────────────────────────────────────────────────

export interface Session {
  session_key: number;
  session_name: string;
  session_type: string; // 'Race' | 'Qualifying' | 'Practice 1' | etc.
  date_start: string; // ISO 8601
  date_end: string;
  circuit_key: number;
  circuit_short_name: string;
  country_name: string;
  year: number;
  location: string;
}

// ─── Drivers ────────────────────────────────────────────────────────────────

export interface Driver {
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string; // e.g. "VER"
  team_name: string; // e.g. "red_bull" (snake_case from API)
  team_colour: string; // hex without #, e.g. "3671C6"
  headshot_url: string | null;
  session_key: number;
}

// ─── Positions ──────────────────────────────────────────────────────────────

export interface Position {
  driver_number: number;
  date: string;
  position: number;
  session_key: number;
}

// ─── Locations (telemetry X/Y/Z) ────────────────────────────────────────────

export interface Location {
  driver_number: number;
  date: string;
  x: number;
  y: number;
  z: number;
  session_key: number;
}

// ─── Intervals (gaps) ────────────────────────────────────────────────────────

export interface Interval {
  driver_number: number;
  date: string;
  gap_to_leader: string | number | null;
  interval: string | number | null;
  session_key: number;
}

// ─── Stints (tires) ──────────────────────────────────────────────────────────

export interface Stint {
  driver_number: number;
  lap_start: number;
  lap_end: number | null;
  compound: "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET" | string;
  tyre_age_at_start: number;
  session_key: number;
}

// ─── Circuit (MultiViewer) ────────────────────────────────────────────────────

export interface CircuitCorner {
  number: number;
  letter: string;
  trackPosition: { x: number; y: number };
}

export interface CircuitData {
  x: number[];
  y: number[];
  rotation?: number;
  corners?: CircuitCorner[];
  marshalSectors?: Array<{ trackPosition: { x: number; y: number } }>;
  marshalLights?: Array<{ trackPosition: { x: number; y: number } }>;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export interface ApiError {
  status: number;
  message: string;
  isRateLimit: boolean;
}
