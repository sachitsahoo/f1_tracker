import React from "react";
import type { SessionPickerProps } from "../types/f1";
import type { Session } from "../types/f1";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Computes a round number for each session within its year.
 * Sessions sorted ascending by date_start within a year get R01, R02, …
 * Returns a Map<session_key, roundNumber>.
 */
function buildRoundMap(sessions: Session[]): Map<number, number> {
  const byYear = new Map<number, Session[]>();
  for (const s of sessions) {
    const year = s.year ?? new Date(s.date_start).getFullYear();
    const list = byYear.get(year) ?? [];
    list.push(s);
    byYear.set(year, list);
  }

  const map = new Map<number, number>();
  for (const [, list] of byYear) {
    const sorted = [...list].sort(
      (a, b) =>
        new Date(a.date_start).getTime() - new Date(b.date_start).getTime(),
    );
    sorted.forEach((s, i) => map.set(s.session_key, i + 1));
  }
  return map;
}

/** Formats a session option label: "2025 R03 · Jeddah" */
function formatLabel(session: Session, round: number): string {
  const r = String(round).padStart(2, "0");
  return `${session.year} R${r} · ${session.circuit_short_name}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Dropdown for selecting a historical or current Race session.
 * Renders as a native <select> styled to match the dark monospace theme.
 * Groups sessions by year with <optgroup>.
 */
export default function SessionPicker({
  sessions,
  selectedKey,
  onSelect,
}: SessionPickerProps) {
  const roundMap = buildRoundMap(sessions);

  // Group sessions by year (sessions are already newest-first)
  const years = [
    ...new Set(
      sessions.map((s) => s.year ?? new Date(s.date_start).getFullYear()),
    ),
  ].sort((a, b) => b - a);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const key = Number(e.target.value);
    const session = sessions.find((s) => s.session_key === key);
    if (session) onSelect(session);
  }

  if (sessions.length === 0) {
    return (
      <select disabled style={styles.select}>
        <option>Loading sessions…</option>
      </select>
    );
  }

  return (
    <select
      value={selectedKey ?? ""}
      onChange={handleChange}
      style={styles.select}
      aria-label="Select session"
    >
      {years.map((year) => (
        <optgroup key={year} label={String(year)}>
          {sessions
            .filter(
              (s) => (s.year ?? new Date(s.date_start).getFullYear()) === year,
            )
            .map((s) => (
              <option key={s.session_key} value={s.session_key}>
                {formatLabel(s, roundMap.get(s.session_key) ?? 0)}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  select: {
    backgroundColor: "#1A1A1A",
    color: "#FFFFFF",
    border: "1px solid #444444",
    borderRadius: "4px",
    padding: "3px 6px",
    fontSize: "12px",
    fontFamily: "'Roboto Mono', 'Courier New', monospace",
    letterSpacing: "0.04em",
    cursor: "pointer",
    outline: "none",
    maxWidth: "220px",
  },
};
