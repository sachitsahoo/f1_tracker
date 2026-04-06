// ─── Session ────────────────────────────────────────────────────────────────

export interface Session {
  session_key: number;
  session_name: string;
  session_type: string; // 'Race' | 'Sprint' | 'Qualifying' | 'Practice 1' | etc.
  date_start: string; // ISO 8601
  date_end: string;
  circuit_key: number;
  meeting_key?: number;
  // Fields present in OpenF1 responses but not in the backend /api/sessions endpoint:
  circuit_short_name?: string;
  country_name?: string;
  year?: number; // derived from date_start when absent — use session.year ?? new Date(session.date_start).getFullYear()
  location?: string;
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
  country_code?: string; // IOC 3-letter country code, e.g. "NED", "GBR"
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
  /** Nullable — OpenF1 returns null for stints recorded before a driver's first lap. */
  lap_start: number | null;
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

// ─── Race Control (flags, safety car, incidents) ─────────────────────────────

export interface RaceControl {
  date: string;
  driver_number: number | null;
  flag: string | null; // 'GREEN' | 'YELLOW' | 'RED' | 'SAFETY CAR' | 'VIRTUAL SAFETY CAR' | etc.
  lap_number: number | null;
  message: string;
  scope: string | null; // 'Track' | 'Sector' | 'Driver'
  sector: number | null;
  session_key: number;
}

// ─── Laps ────────────────────────────────────────────────────────────────────

export interface Lap {
  date_start: string;
  driver_number: number;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  i1_speed: number | null; // speed trap at intermediate 1 (km/h)
  i2_speed: number | null; // speed trap at intermediate 2 (km/h)
  is_pit_out_lap: boolean;
  lap_duration: number | null; // total lap time in seconds
  lap_number: number;
  segments_sector_1: number[] | null; // mini-sector status codes
  segments_sector_2: number[] | null;
  segments_sector_3: number[] | null;
  st_speed: number | null; // speed trap at finish straight (km/h)
  session_key: number;
}

// ─── Token proxy ─────────────────────────────────────────────────────────────

export interface TokenProxyResponse {
  token: string;
}

export interface TokenProxyError {
  error: string;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export interface ApiError {
  status: number;
  message: string;
  isRateLimit: boolean;
}

// ─── Network / Toast ─────────────────────────────────────────────────────────

/** A single UI notification produced by API lifecycle events. */
export interface Toast {
  id: number;
  /** Distinguishes rate-limit warnings from connectivity errors. */
  type: "rate-limit" | "network-error" | "info";
  message: string;
  /**
   * Optional expiry: `Date.now() + ttl_ms`. Used by the overlay to
   * auto-dismiss rate-limit toasts once the backoff window has elapsed.
   */
  expiresAt?: number;
}

/** Shape exposed by `useNetworkStatus()` and the NetworkStatusContext. */
export interface NetworkStatusContextValue {
  /** Active notifications, newest last. Capped at 5 entries. */
  toasts: Toast[];
  /** Remove a specific toast by id. */
  dismissToast: (id: number) => void;
  /**
   * True while consecutive network errors are being received.
   * Cleared automatically when the next successful API response arrives.
   */
  connectionLost: boolean;
}

// ─── Component Props ─────────────────────────────────────────────────────────

/** Props for the DriverDot SVG marker. All coordinates must be pre-normalised. */
export interface DriverDotProps {
  /** Normalised SVG X coordinate — output of normalizeCoords(), never raw telemetry. */
  svgX: number;
  /** Normalised SVG Y coordinate — output of normalizeCoords(), never raw telemetry. */
  svgY: number;
  /** CSS hex color string (e.g. "#FF8000") for the dot and label. */
  color: string;
  /** Driver three-letter abbreviation, e.g. "VER". From Driver.name_acronym. */
  abbreviation: string;
  /** Driver number — used as React key by the parent. */
  driverNumber: number;
}

/** Props for the Leaderboard right-panel component. */
export interface LeaderboardProps {
  /** Positions sorted ascending by position number (P1 first). */
  positions: Position[];
  /** Full driver roster for the session — used for abbreviation and team name. */
  drivers: Driver[];
  /**
   * Latest known interval per driver, keyed by driver_number.
   * Comes directly from useIntervals(). Gaps are already formatted strings from the API.
   */
  intervals: Record<number, Interval>;
  /**
   * Current active stint per driver, keyed by driver_number.
   * Should be the most-recent stint from useStints().
   */
  stints: Record<number, Stint>;
  /**
   * Most recent completed lap per driver, keyed by driver_number.
   * Comes from useLaps(). Used to display last lap time.
   */
  laps: Record<number, Lap>;
  /** Current lap number in the race. Null when unknown or off-season. */
  currentLap: number | null;
  /** Total scheduled race laps. Null when unknown. */
  totalLaps: number | null;
  /**
   * True when a live session is active; false for historical/replay data.
   * When false a REPLAY badge is shown in the header.
   */
  isLive: boolean;
}

/** Props for the StatusBar top-of-page component. */
export interface StatusBarProps {
  /**
   * Current session, or null when no session has loaded yet / off-season.
   * Provides session_name / circuit_short_name for display.
   */
  session: Session | null;
  /** Current lap number in the race. Null when unknown or not yet started. */
  currentLap: number | null;
  /** Total scheduled race laps. Null when unknown. */
  totalLaps: number | null;
  /**
   * True when a live session is active (date_start ≤ now ≤ date_end).
   * False for historical/replay data. When session is null, treat as off-season.
   */
  isLive: boolean;
  /**
   * Race control messages for the session — passed down from App so the same
   * data can also drive the ReplayScrubber event markers. App owns the
   * useRaceControl call; StatusBar is purely presentational here.
   */
  messages: RaceControl[];
  /** When provided, a SessionPicker dropdown replaces the plain session title text. */
  sessions?: Session[];
  /** Required when sessions is provided. */
  onSessionChange?: (session: Session) => void;
}

/** Props for the lap-based replay scrubber bar. */
export interface ReplayScrubberProps {
  /** Total number of laps in the session. */
  totalLaps: number;
  /** Currently selected replay lap (1-indexed). */
  replayLap: number;
  /** Called when the user drags the slider to a new lap. */
  onChange: (lap: number) => void;
  /**
   * All race control messages for the session.
   * Used to render event markers (safety car, red flag) on the slider rail.
   */
  events: RaceControl[];
}

/** Props for the SessionPicker dropdown component. */
export interface SessionPickerProps {
  /** All available sessions, newest first. */
  sessions: Session[];
  /** The session_key of the currently selected session, or null while loading. */
  selectedKey: number | null;
  /** Called when the user picks a different session. */
  onSelect: (session: Session) => void;
}

/** Props for the TrackMap composite component. */
export interface TrackMapProps {
  /** OpenF1 circuit_key from the session — never hardcoded. */
  circuitKey: number;
  /** Season year — used to fetch the correct circuit layout revision. */
  year: number;
  /** Full driver roster for the session. Used to look up name/color per dot. */
  drivers: Driver[];
  /**
   * Latest known telemetry location per driver, keyed by driver_number.
   * Raw X/Y values — normalisation happens inside TrackMap, never outside.
   * Comes directly from useLocations().locations.
   */
  locations: Record<number, Location>;
  /** Whether the session is currently live. Controls LIVE vs REPLAY badge. */
  isLive?: boolean;
}
