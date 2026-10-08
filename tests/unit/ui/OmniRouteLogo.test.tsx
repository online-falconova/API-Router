// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import OmniRouteLogo from "@/shared/components/OmniRouteLogo";
import { isValidCustomLogo } from "@/shared/utils/customLogo";

// @ts-expect-error test environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLElement[] = [];

function renderLogo(props: { size?: number; className?: string } = {}): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);

  const root = createRoot(container);
  act(() => {
    root.render(<OmniRouteLogo {...props} />);
  });
  return container;
}

describe("OmniRouteLogo", () => {
  afterEach(() => {
    while (containers.length > 0) {
      const c = containers.pop();
      c?.remove();
    }
  });

  it("renders a vector SVG directly without external img network dependency", () => {
    const container = renderLogo({ size: 40 });
    const svg = container.querySelector("svg");
    const img = container.querySelector("img");

    expect(img).toBeNull();
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("API Router");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 512 512");
  });

  it("applies the requested size and className", () => {
    const container = renderLogo({ size: 48, className: "test-logo-class" });
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("width")).toBe("48");
    expect(svg?.getAttribute("height")).toBe("48");
    expect(svg?.getAttribute("class")).toContain("test-logo-class");
    expect(svg?.getAttribute("class")).toContain("shrink-0");
  });

  it("includes all canonical brand artwork paths and groups", () => {
    const container = renderLogo({ size: 40 });
    const paths = container.querySelectorAll("path");
    const rects = container.querySelectorAll("rect");

    // Hexagon ring + 4 plug heads + 3 cube faces + 2 API letter paths = at least 10 paths
    expect(paths.length).toBeGreaterThanOrEqual(10);
    // Plug pins + letter bars = at least 10 rects
    expect(rects.length).toBeGreaterThanOrEqual(10);
  });
});

describe("isValidCustomLogo", () => {
  it("rejects empty, null, undefined, or string literal null values", () => {
    expect(isValidCustomLogo(null)).toBe(false);
    expect(isValidCustomLogo(undefined)).toBe(false);
    expect(isValidCustomLogo("")).toBe(false);
    expect(isValidCustomLogo("   ")).toBe(false);
    expect(isValidCustomLogo("null")).toBe(false);
    expect(isValidCustomLogo("undefined")).toBe(false);
  });

  it("rejects references to the built-in default logo assets", () => {
    expect(isValidCustomLogo("/logo.png")).toBe(false);
    expect(isValidCustomLogo("logo.png")).toBe(false);
    expect(isValidCustomLogo("/logo.svg")).toBe(false);
    expect(isValidCustomLogo("logo.svg")).toBe(false);
    expect(isValidCustomLogo("/brand-logo.png")).toBe(false);
    expect(isValidCustomLogo("brand-logo.png")).toBe(false);
    expect(isValidCustomLogo("/logo.ico")).toBe(false);
    expect(isValidCustomLogo("/logo.webp")).toBe(false);
  });

  it("rejects UI placeholder URLs", () => {
    expect(isValidCustomLogo("https://example.com/logo.png")).toBe(false);
    expect(isValidCustomLogo("http://example.com/logo.png")).toBe(false);
  });

  it("accepts valid custom uploaded base64 data URIs and custom URLs", () => {
    expect(isValidCustomLogo("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...")).toBe(true);
    expect(isValidCustomLogo("https://mycompany.com/assets/custom-logo.png")).toBe(true);
    expect(isValidCustomLogo("/uploads/tenants/custom-logo.png")).toBe(true);
  });
});
