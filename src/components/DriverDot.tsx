import type { DriverDotProps } from "../types/f1";

/**
 * A single animated car marker on the SVG track map.
 *
 * Receives pre-normalised SVG coordinates (svgX, svgY) — raw OpenF1 telemetry
 * values must never be passed here directly (Rule 4). Movement between 1-second
 * polling updates is smoothed with a CSS transition.
 *
 * Rendered inside an SVG <g> by TrackMap — do not mount outside an <svg>.
 * Keyframe animations (f1-dot-pulse) are injected by TrackMap's <style> block.
 *
 * Design: F1 Broadcast / Timing Tower
 * - 10px radius filled circle in team color
 * - Driver abbreviation in white at 6.5px, centered inside the dot
 * - Outer pulsing glow ring signals live telemetry activity
 */
export function DriverDot({ svgX, svgY, color, abbreviation }: DriverDotProps) {
  return (
    <g
      style={{
        // CSS transform positions the group so all child elements use (0,0) as origin.
        // transition: transform covers both x and y movement between polling updates.
        transform: `translate(${svgX}px, ${svgY}px)`,
        transition: "transform 0.8s ease",
      }}
      aria-label={abbreviation}
    >
      {/* Outer pulsing glow ring — live telemetry indicator */}
      <circle
        cx={0}
        cy={0}
        r={17}
        fill={color}
        style={{ animation: "f1-dot-pulse 2.4s ease-in-out infinite" }}
      />

      {/* Main filled dot in team color */}
      <circle
        cx={0}
        cy={0}
        r={10}
        fill={color}
        stroke="#0A0A0A"
        strokeWidth={1.5}
      />

      {/* Three-letter abbreviation — white, centered inside the dot.
          dominantBaseline="central" is more reliable than "middle" cross-browser. */}
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={6.5}
        fontFamily="'JetBrains Mono', 'Roboto Mono', 'Courier New', monospace"
        fontWeight="700"
        fill="#FFFFFF"
        letterSpacing={0}
        style={{ userSelect: "none" }}
      >
        {abbreviation}
      </text>
    </g>
  );
}
