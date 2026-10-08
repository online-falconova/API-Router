/**
 * API Router brand logo.
 *
 * Renders the official brand artwork with zero external network dependency
 * via an embedded high-resolution data URI. This guarantees instant, smooth
 * rendering on both localhost and live servers without broken-image icons,
 * 404s, or reverse-proxy path issues.
 */
import React from "react";
import { BRAND_LOGO_DATA_URI } from "./brandLogoAsset";

export { BRAND_LOGO_DATA_URI };

type OmniRouteLogoProps = {
  size?: number;
  className?: string;
};

export default function OmniRouteLogo({ size = 20, className = "" }: OmniRouteLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={BRAND_LOGO_DATA_URI}
      alt="API Router"
      role="img"
      aria-label="API Router"
      width={size}
      height={size}
      className={`object-contain shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
      loading="eager"
      decoding="sync"
    />
  );
}
