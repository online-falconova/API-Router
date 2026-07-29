import { z } from "zod";
import {
  replaceSkillCatalog,
  getSkillCatalogMeta,
  type SkillCatalogEntry,
} from "@/lib/db/skillCatalog";

/**
 * API Router Skills — catalog client.
 *
 * Reads a skill catalog (upstream: awesome-omni-skills) from a **pinned** git ref
 * and caches a slim projection in SQLite. The ref is pinned rather than tracking a
 * branch on purpose: these skills are instructions handed to an LLM that may hold
 * tool access, so an upstream branch push must never silently change what users
 * execute. Moving the catalog forward is an explicit config change.
 */

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";

/** `owner/repo` — anchored, so a crafted value cannot escape the raw.githubusercontent host. */
const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
/** Tag, branch or full SHA. Rejects anything with a slash or traversal characters. */
const REF_PATTERN = /^[A-Za-z0-9._-]+$/;

const DEFAULT_REPO = "diegosouzapw/awesome-omni-skills";
/** Pinned to the v0.12.9 release tag — 2,486 skills, index schema 1.2.0. */
const DEFAULT_REF = "v0.12.9";
const DEFAULT_INDEX_PATH = "skills_index.json";

const INDEX_FETCH_TIMEOUT_MS = 120_000;
const SKILL_FETCH_TIMEOUT_MS = 20_000;
/** The v0.12.9 index is ~25 MB; cap well above it but far below anything abusive. */
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_SKILL_MD_BYTES = 2 * 1024 * 1024;

export interface CatalogSource {
  repo: string;
  ref: string;
  indexPath: string;
}

export class CatalogConfigError extends Error {}

export function getCatalogSource(): CatalogSource {
  const repo = (process.env.OMNIROUTE_SKILLS_CATALOG_REPO || DEFAULT_REPO).trim();
  const ref = (process.env.OMNIROUTE_SKILLS_CATALOG_REF || DEFAULT_REF).trim();
  const indexPath = (process.env.OMNIROUTE_SKILLS_CATALOG_INDEX_PATH || DEFAULT_INDEX_PATH).trim();

  if (!REPO_PATTERN.test(repo)) {
    throw new CatalogConfigError(
      "OMNIROUTE_SKILLS_CATALOG_REPO must be in owner/repo form (letters, digits, dot, dash, underscore)."
    );
  }
  if (!REF_PATTERN.test(ref)) {
    throw new CatalogConfigError(
      "OMNIROUTE_SKILLS_CATALOG_REF must be a single tag, branch or commit SHA with no slashes."
    );
  }
  if (indexPath.includes("..") || indexPath.startsWith("/")) {
    throw new CatalogConfigError("OMNIROUTE_SKILLS_CATALOG_INDEX_PATH must be a relative path.");
  }
  return { repo, ref, indexPath };
}

export function getCatalogIndexUrl(source: CatalogSource = getCatalogSource()): string {
  return `${GITHUB_RAW_BASE}/${source.repo}/${source.ref}/${source.indexPath}`;
}

export function getCatalogBlobUrl(entryPath: string, source: CatalogSource = getCatalogSource()) {
  return `https://github.com/${source.repo}/blob/${source.ref}/${entryPath}`;
}

// ── Upstream index shape ────────────────────────────────────────────────────
// Only the fields consumed here are declared. `.passthrough()` keeps the parse
// tolerant of upstream additions, and every optional field is genuinely optional
// upstream, so a partial entry degrades instead of failing the whole sync.

const IndexEntrySchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().optional(),
    name: z.string().optional(),
    display_name: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    source_repo: z.string().optional(),
    author: z.string().optional(),
    version: z.union([z.string(), z.number()]).optional(),
    path: z.string().optional(),
    entrypoint_path: z.string().optional(),
    complexity: z.string().optional(),
    risk: z.string().optional(),
    quality_score: z.number().optional(),
    security_score: z.number().optional(),
    security_status: z.string().optional(),
    validation_status: z.string().optional(),
    // Upstream v0.12.9 ships objects here, not strings:
    //   { tool, scope, default_path, installer_flag, current_installer_behavior, invocation }
    // Verified against the real index: object entries only, zero string entries.
    // The union keeps older/simpler string forms working too.
    install_targets: z
      .array(z.union([z.string(), z.object({ tool: z.string().optional() }).passthrough()]))
      .optional(),
  })
  .passthrough();

const IndexSchema = z
  .object({
    schema_version: z.string().optional(),
    version: z.string().optional(),
    generated_at: z.string().optional(),
    total_skills: z.number().optional(),
    // Entries are validated one at a time (see syncSkillCatalog) so a single
    // malformed record is skipped instead of failing the whole multi-thousand-entry sync.
    skills: z.array(z.unknown()),
  })
  .passthrough();

export type CatalogIndexEntry = z.infer<typeof IndexEntrySchema>;

function toCatalogEntry(raw: CatalogIndexEntry): SkillCatalogEntry {
  const path = raw.path || `skills/${raw.slug || raw.id}`;
  return {
    id: raw.id,
    slug: raw.slug || raw.id,
    name: raw.name || raw.slug || raw.id,
    displayName: raw.display_name ?? null,
    description: raw.description ?? null,
    category: raw.category ?? null,
    tags: raw.tags ?? [],
    sourceRepo: raw.source_repo ?? null,
    author: raw.author ?? null,
    version: raw.version === undefined ? null : String(raw.version),
    path,
    entrypointPath: raw.entrypoint_path ?? `${path}/SKILL.md`,
    complexity: raw.complexity ?? null,
    risk: raw.risk ?? null,
    qualityScore: raw.quality_score ?? null,
    securityScore: raw.security_score ?? null,
    securityStatus: raw.security_status ?? null,
    validationStatus: raw.validation_status ?? null,
    // Normalise to plain tool ids ("claude-code", "codex-cli", …) — the only part
    // of the upstream target descriptor this app consumes.
    installTargets: (raw.install_targets ?? [])
      .map((target) => (typeof target === "string" ? target : target.tool))
      .filter((tool): tool is string => typeof tool === "string" && tool.length > 0),
    syncedAt: "",
  };
}

async function fetchWithLimit(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string; etag: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers, cache: "no-store" });
    const etag = res.headers.get("etag");
    if (res.status === 304) return { status: 304, body: "", etag };
    if (!res.ok) {
      throw new Error(`Catalog fetch failed: ${res.status} ${res.statusText} (${url})`);
    }

    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > maxBytes) {
      throw new Error(`Catalog response too large: ${declared} bytes exceeds ${maxBytes}.`);
    }

    // Stream so an undeclared/oversized body is cut off instead of filling the heap.
    if (!res.body) return { status: res.status, body: await res.text(), etag };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new Error(`Catalog response exceeded ${maxBytes} bytes.`);
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return { status: res.status, body: out, etag };
  } finally {
    clearTimeout(timeout);
  }
}

export interface SyncResult {
  status: "synced" | "unchanged";
  repo: string;
  ref: string;
  totalSkills: number;
  /** Entries rejected by validation and left out of the cache. */
  skippedEntries: number;
  catalogVersion: string | null;
  generatedAt: string | null;
}

/**
 * Fetch the pinned index and replace the local cache.
 *
 * Sends `If-None-Match` when a previous ETag exists for the same repo+ref, so a
 * repeat sync costs a 304 instead of re-downloading ~25 MB. Changing the pinned
 * ref always forces a full re-fetch.
 */
export async function syncSkillCatalog(options: { force?: boolean } = {}): Promise<SyncResult> {
  const source = getCatalogSource();
  const url = getCatalogIndexUrl(source);
  const existing = getSkillCatalogMeta();

  const sameSource = existing?.repo === source.repo && existing?.ref === source.ref;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (!options.force && sameSource && existing?.etag) {
    headers["If-None-Match"] = existing.etag;
  }

  const { status, body, etag } = await fetchWithLimit(
    url,
    INDEX_FETCH_TIMEOUT_MS,
    MAX_INDEX_BYTES,
    headers
  );

  if (status === 304 && existing) {
    return {
      status: "unchanged",
      repo: existing.repo,
      ref: existing.ref,
      totalSkills: existing.totalSkills,
      skippedEntries: 0,
      catalogVersion: existing.catalogVersion,
      generatedAt: existing.generatedAt,
    };
  }

  const parsed = IndexSchema.parse(JSON.parse(body));

  // Validate per entry. One upstream record with an unexpected field type must not
  // discard the entire catalog, so failures are counted and skipped.
  const entries: SkillCatalogEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const candidate of parsed.skills) {
    const result = IndexEntrySchema.safeParse(candidate);
    if (!result.success) {
      skipped++;
      continue;
    }
    // id is the PRIMARY KEY; a duplicate would abort the insert transaction.
    if (seen.has(result.data.id)) {
      skipped++;
      continue;
    }
    seen.add(result.data.id);
    entries.push(toCatalogEntry(result.data));
  }

  if (entries.length === 0) {
    throw new Error(
      `Catalog index contained no usable entries (${skipped} rejected). Check the pinned ref.`
    );
  }

  replaceSkillCatalog(entries, {
    repo: source.repo,
    ref: source.ref,
    etag,
    catalogVersion: parsed.version ?? null,
    generatedAt: parsed.generated_at ?? null,
    totalSkills: entries.length,
  });

  return {
    status: "synced",
    repo: source.repo,
    ref: source.ref,
    totalSkills: entries.length,
    skippedEntries: skipped,
    catalogVersion: parsed.version ?? null,
    generatedAt: parsed.generated_at ?? null,
  };
}

/** Fetch a single skill's SKILL.md from the pinned ref. */
export async function fetchCatalogSkillMd(
  entrypointPath: string,
  source: CatalogSource = getCatalogSource()
): Promise<string> {
  if (entrypointPath.includes("..") || entrypointPath.startsWith("/")) {
    throw new CatalogConfigError("Invalid skill path.");
  }
  const url = `${GITHUB_RAW_BASE}/${source.repo}/${source.ref}/${entrypointPath}`;
  const { body } = await fetchWithLimit(url, SKILL_FETCH_TIMEOUT_MS, MAX_SKILL_MD_BYTES, {
    Accept: "text/plain",
  });
  if (!body.trim()) throw new Error(`SKILL.md is empty (${url})`);
  return body;
}
