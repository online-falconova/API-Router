// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import OmniRouteLogo, { BRAND_LOGO_DATA_URI } from "@/shared/components/OmniRouteLogo";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

  it("renders the official brand logo with embedded data URI and zero network latency", () => {
    const container = renderLogo({ size: 40 });
    const img = container.querySelector("img");

    expect(img).not.toBeNull();
    expect(img?.getAttribute("role")).toBe("img");
    expect(img?.getAttribute("alt")).toBe("API Router");
    expect(img?.getAttribute("aria-label")).toBe("API Router");
    expect(img?.getAttribute("src")).toBe(BRAND_LOGO_DATA_URI);
    expect(img?.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  });

  it("applies the requested size, attributes, and className", () => {
    const container = renderLogo({ size: 48, className: "test-logo-class" });
    const img = container.querySelector("img");

    expect(img?.getAttribute("width")).toBe("48");
    expect(img?.getAttribute("height")).toBe("48");
    expect(img?.getAttribute("class")).toContain("test-logo-class");
    expect(img?.getAttribute("class")).toContain("shrink-0");
    expect(img?.getAttribute("class")).toContain("object-contain");
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(img?.getAttribute("decoding")).toBe("sync");
    expect(img?.style.width).toBe("48px");
    expect(img?.style.height).toBe("48px");
  });

  it("embeds a valid high-resolution PNG asset", () => {
    expect(BRAND_LOGO_DATA_URI).toBeDefined();
    expect(BRAND_LOGO_DATA_URI.startsWith("data:image/png;base64,")).toBe(true);

    // PNG base64 payload starts with iVBORw0KGgo (standard PNG magic bytes)
    const base64Part = BRAND_LOGO_DATA_URI.replace("data:image/png;base64,", "");
    expect(base64Part.startsWith("iVBORw0KGgo")).toBe(true);
    expect(base64Part.length).toBeGreaterThan(1000);
  });
});
