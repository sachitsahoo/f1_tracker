import type { DriverDotProps } from "../types/f1";

/**
 * A single animated car marker on the SVG track map.
 *
 * Receives pre-normalised SVG coordinates (svgX, svgY) — raw OpenF1 telemetry
 * values must never be passed here directly (Rule 4). Movement between 1-second
 * polling updates is smoothed with a CSS transition.
 *
 * Rendered inside an SVG <g> by TrackMap — do not mount outside an <svg>.
 */
export function DriverDot({ svgX, svgY, color, abbreviation }: DriverDotProps) {
  return (
    <g
      style={{
        // CSS transform positions the group so all child elements use (0,0) as origin.
        // transition: all covers both x and y movement between polling updates.
        transform: `translate(${svgX}px, ${svgY}px)`,
        transition: "all 0.8s ease",
      }}
      aria-label={abbreviation}
    >
      {/* Glow ring — subtle pulse indicating a live data point */}
      <circle cx={0} cy={0} r={10} fill={color} opacity={0.18} />

      {/* Main dot */}
      <circle
        cx={0}
        cy={0}
        r={6}
        fill={color}
        stroke="#000000"
        strokeWidth={1.5}
      />

      {/* Three-letter abbreviation label — paintOrder renders the stroke behind
          the fill so the text remains legible on any track color */}
      <text
        x={0}
        y={-11}
        textAnchor="middle"
        fontSize={8}
        fontFamily="monospace"
        fontWeight="bold"
        fill={color}
        stroke="#000000"
        strokeWidth={2.5}
        paintOrder="stroke"
        style={{ userSelect: "none" }}
      >
        {abbreviation}
      </text>
    </g>
  );
}
