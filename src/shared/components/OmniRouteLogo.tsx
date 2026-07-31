/**
 * API Router brand logo.
 *
 * Renders the canonical brand artwork at `public/logo.png` (the operator-
 * provided logo). The `size` prop sets a square box and the image is
 * `object-contain`, so the logo keeps its aspect ratio at any call site
 * (sidebar, landing nav/footer, login).
 *
 * The `className` is preserved for layout tweaks. Any color utility (e.g.
 * `text-white`) is a no-op on a raster image and is simply ignored.
 */
type OmniRouteLogoProps = {
  size?: number;
  className?: string;
};

export default function OmniRouteLogo({ size = 20, className = "" }: OmniRouteLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      width={size}
      height={size}
      alt="API Router"
      className={`object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
