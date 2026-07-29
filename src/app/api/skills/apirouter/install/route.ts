import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import { skillRegistry } from "@/lib/skills/registry";
import { getSkillsProviderSetting } from "@/lib/skills/providerSettings";
import { getSkillCatalogEntry } from "@/lib/db/skillCatalog";
import {
  fetchCatalogSkillMd,
  getCatalogBlobUrl,
  getCatalogSource,
  CatalogConfigError,
} from "@/lib/skills/apiRouterCatalog";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";

const installSchema = z.object({
  id: z.string().min(1).max(256),
  /**
   * Install a skill whose upstream security review flagged it. Off by default:
   * a SKILL.md is an instruction payload for an LLM that may hold tool access,
   * so a flagged skill needs a deliberate override rather than a silent install.
   */
  acknowledgeRisk: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(false),
});

/** Upstream security scores below this are treated as needing an explicit override. */
const SECURITY_SCORE_THRESHOLD = 80;
const BLOCKED_SECURITY_STATUSES = new Set(["fail", "failed", "blocked", "rejected"]);
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * POST /api/skills/apirouter/install
 *
 * Install one catalog skill into the local skill registry. The SKILL.md is pulled
 * from the pinned ref at install time (not from the cache) so the stored payload
 * always matches the ref recorded in the catalog metadata.
 */
export async function POST(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const provider = await getSkillsProviderSetting();
    if (provider !== "apirouter") {
      return NextResponse.json(
        {
          error:
            "Active skills provider is not API Router Skills. Switch provider in Settings → Memory & Skills.",
        },
        { status: 409 }
      );
    }

    const rawBody = await request.json().catch(() => null);
    if (rawBody === null) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const validation = validateBody(installSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json(validation.error, { status: 400 });
    }
    const { id, acknowledgeRisk, enabled } = validation.data;

    const entry = getSkillCatalogEntry(id);
    if (!entry) {
      return NextResponse.json(
        { error: "Skill not found in the local catalog. Sync the catalog and try again." },
        { status: 404 }
      );
    }

    // ── Safety gate ────────────────────────────────────────────────────────
    const statusFlagged = entry.securityStatus
      ? BLOCKED_SECURITY_STATUSES.has(entry.securityStatus.toLowerCase())
      : false;
    const scoreFlagged =
      typeof entry.securityScore === "number" && entry.securityScore < SECURITY_SCORE_THRESHOLD;

    if ((statusFlagged || scoreFlagged) && !acknowledgeRisk) {
      return NextResponse.json(
        {
          error: "This skill was flagged by the upstream security review.",
          requiresAcknowledgement: true,
          securityScore: entry.securityScore,
          securityStatus: entry.securityStatus,
          threshold: SECURITY_SCORE_THRESHOLD,
        },
        { status: 412 }
      );
    }

    const entrypoint = entry.entrypointPath || `${entry.path}/SKILL.md`;
    const skillMdContent = await fetchCatalogSkillMd(entrypoint);
    const source = getCatalogSource();
    const blobUrl = getCatalogBlobUrl(entrypoint, source);

    const description = truncate(
      entry.description || entry.displayName || entry.name,
      MAX_DESCRIPTION_LENGTH
    );

    // Provenance header keeps CC BY 4.0 attribution attached to the stored payload.
    const handler = [
      `// Installed from API Router Skills`,
      `// Catalog: ${source.repo}@${source.ref}`,
      `// Skill id: ${entry.id}`,
      entry.sourceRepo ? `// Upstream source: ${entry.sourceRepo}` : null,
      entry.author ? `// Author: ${entry.author}` : null,
      `// Source: ${blobUrl}`,
      `// Content licence: CC BY 4.0 — see SKILLS-ATTRIBUTION.md`,
      `// SKILL.md content:`,
      skillMdContent,
    ]
      .filter(Boolean)
      .join("\n");

    const tags = Array.from(
      new Set(["api-router-skills", ...(entry.category ? [entry.category] : []), ...entry.tags])
    ).slice(0, 24);

    const skill = await skillRegistry.register({
      name: truncate(entry.name, MAX_NAME_LENGTH),
      version: entry.version || "1.0.0",
      description,
      schema: { input: { content: "string" }, output: { result: "string" } },
      handler,
      apiKeyId: "apirouter",
      enabled,
      mode: enabled ? "on" : "off",
      sourceProvider: "apirouter",
      tags,
      installCount: 1,
    });

    return NextResponse.json({
      success: true,
      id: skill.id,
      name: skill.name,
      sourceUrl: blobUrl,
      ref: source.ref,
    });
  } catch (err: unknown) {
    const status = err instanceof CatalogConfigError ? 400 : 500;
    return NextResponse.json(
      { error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      { status }
    );
  }
}
