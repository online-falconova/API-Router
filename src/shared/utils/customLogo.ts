/**
 * Custom Logo Validation Helper.
 *
 * Determines whether a logo string represents a genuine custom logo.
 * Returns false for empty/null values, UI placeholders, and references
 * to built-in brand logos (e.g. "/logo.png", "/logo.svg") which must
 * render directly via OmniRouteLogo without unnecessary network roundtrips
 * or broken-image failure modes.
 */

export function isValidCustomLogo(logo: string | null | undefined): boolean {
  if (!logo) return false;
  const trimmed = logo.trim();
  if (!trimmed) return false;
  if (trimmed === "null" || trimmed === "undefined") return false;
  if (trimmed === "https://example.com/logo.png" || trimmed === "http://example.com/logo.png") {
    return false;
  }
  // Match built-in brand assets: /logo.png, /logo.svg, logo.png, logo.svg, /brand-logo.png, etc.
  if (/^(\/)?(brand-)?logo\.(png|svg|ico|webp)$/i.test(trimmed)) {
    return false;
  }
  return true;
}
