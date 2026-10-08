// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import OmniRouteLogo from "@/shared/components/OmniRouteLogo";

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
