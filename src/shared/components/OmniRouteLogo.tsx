/**
 * API Router logo — hexagon ring around an isometric cube.
 * Matches public/logo.svg (favicon, PWA and apple-touch icons).
 *
 * This inline variant is monotone: it inherits `currentColor` so the sidebar and
 * other chrome can tint it (brand red by default, via --color-primary). Depth is
 * carried by opacity tiers instead of the three literal reds used in the asset
 * files, and the plugs plus the "API" lettering are omitted because this renders
 * at ~20px. The background is transparent.
 */
type OmniRouteLogoProps = {
  size?: number;
  className?: string;
};

export default function OmniRouteLogo({ size = 20, className = "" }: OmniRouteLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="API Router"
    >
      {/* Hexagon ring */}
      <path
        d="M256 24 L457 140 L457 372 L256 488 L55 372 L55 140 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="36"
        strokeLinejoin="round"
      />
      {/* Isometric cube — top / left / right faces */}
      <path d="M256 116 L396 196 L256 276 L116 196 Z" fill="currentColor" opacity="0.55" />
      <path d="M116 196 L256 276 L256 428 L116 348 Z" fill="currentColor" />
      <path d="M396 196 L256 276 L256 428 L396 348 Z" fill="currentColor" opacity="0.8" />
    </svg>
  );
}
