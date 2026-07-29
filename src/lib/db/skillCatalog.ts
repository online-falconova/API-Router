import { getDbInstance } from "./core";

const ENTRIES_TABLE = "skill_catalog_entries";
const META_TABLE = "skill_catalog_meta";

/** Hard ceiling on a single search page, so a crafted `limit` cannot scan the table. */
const MAX_SEARCH_LIMIT = 100;

export interface SkillCatalogEntry {
  id: string;
  slug: string;
  name: string;
  displayName: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
  sourceRepo: string | null;
  author: string | null;
  version: string | null;
  path: string;
  entrypointPath: string | null;
  complexity: string | null;
  risk: string | null;
  qualityScore: number | null;
  securityScore: number | null;
  securityStatus: string | null;
  validationStatus: string | null;
  installTargets: string[];
  syncedAt: string;
}

export interface SkillCatalogMeta {
  repo: string;
  ref: string;
  etag: string | null;
  catalogVersion: string | null;
  generatedAt: string | null;
  totalSkills: number;
  syncedAt: string;
}

export interface SkillCatalogSearchOptions {
  query?: string;
  category?: string;
  /** Drop entries scoring below this security score. */
  minSecurityScore?: number;
  limit?: number;
  offset?: number;
}

export interface SkillCatalogSearchResult {
  entries: SkillCatalogEntry[];
  total: number;
}

interface EntryRow {
  id: string;
  slug: string;
  name: string;
  display_name: string | null;
  description: string | null;
  category: string | null;
  tags: string;
  source_repo: string | null;
  author: string | null;
  version: string | null;
  path: string;
  entrypoint_path: string | null;
  complexity: string | null;
  risk: string | null;
  quality_score: number | null;
  security_score: number | null;
  security_status: string | null;
  validation_status: string | null;
  install_targets: string;
  synced_at: string;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function rowToEntry(row: EntryRow): SkillCatalogEntry {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    category: row.category,
    tags: parseJsonArray(row.tags),
    sourceRepo: row.source_repo,
    author: row.author,
    version: row.version,
    path: row.path,
    entrypointPath: row.entrypoint_path,
    complexity: row.complexity,
    risk: row.risk,
    qualityScore: row.quality_score,
    securityScore: row.security_score,
    securityStatus: row.security_status,
    validationStatus: row.validation_status,
    installTargets: parseJsonArray(row.install_targets),
    syncedAt: row.synced_at,
  };
}

/**
 * Replace the whole cache in one transaction.
 *
 * A full replace (rather than an upsert) is deliberate: the upstream index is
 * regenerated wholesale, and skills do get removed between releases. Doing it
 * inside a transaction means a failed sync leaves the previous catalog intact
 * rather than a half-written one.
 */
export function replaceSkillCatalog(
  entries: SkillCatalogEntry[],
  meta: Omit<SkillCatalogMeta, "syncedAt"> & { syncedAt?: string }
): number {
  const db = getDbInstance();
  const syncedAt = meta.syncedAt ?? new Date().toISOString();

  const insert = db.prepare(
    `INSERT INTO ${ENTRIES_TABLE} (
       id, slug, name, display_name, description, category, tags, source_repo, author,
       version, path, entrypoint_path, complexity, risk, quality_score, security_score,
       security_status, validation_status, install_targets, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const run = db.transaction((rows: SkillCatalogEntry[]) => {
    db.prepare(`DELETE FROM ${ENTRIES_TABLE}`).run();
    for (const e of rows) {
      insert.run(
        e.id,
        e.slug,
        e.name,
        e.displayName,
        e.description,
        e.category,
        JSON.stringify(e.tags ?? []),
        e.sourceRepo,
        e.author,
        e.version,
        e.path,
        e.entrypointPath,
        e.complexity,
        e.risk,
        e.qualityScore,
        e.securityScore,
        e.securityStatus,
        e.validationStatus,
        JSON.stringify(e.installTargets ?? []),
        syncedAt
      );
    }
    db.prepare(
      `INSERT INTO ${META_TABLE} (id, repo, ref, etag, catalog_version, generated_at, total_skills, synced_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         repo = excluded.repo,
         ref = excluded.ref,
         etag = excluded.etag,
         catalog_version = excluded.catalog_version,
         generated_at = excluded.generated_at,
         total_skills = excluded.total_skills,
         synced_at = excluded.synced_at`
    ).run(
      meta.repo,
      meta.ref,
      meta.etag,
      meta.catalogVersion,
      meta.generatedAt,
      rows.length,
      syncedAt
    );
  });

  run(entries);
  return entries.length;
}

export function getSkillCatalogMeta(): SkillCatalogMeta | null {
  const db = getDbInstance();
  const row = db
    .prepare(
      `SELECT repo, ref, etag, catalog_version, generated_at, total_skills, synced_at
         FROM ${META_TABLE} WHERE id = 1`
    )
    .get() as
    | {
        repo: string;
        ref: string;
        etag: string | null;
        catalog_version: string | null;
        generated_at: string | null;
        total_skills: number;
        synced_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    repo: row.repo,
    ref: row.ref,
    etag: row.etag,
    catalogVersion: row.catalog_version,
    generatedAt: row.generated_at,
    totalSkills: row.total_skills,
    syncedAt: row.synced_at,
  };
}

export function searchSkillCatalog(
  options: SkillCatalogSearchOptions = {}
): SkillCatalogSearchResult {
  const db = getDbInstance();
  const limit = Math.min(Math.max(options.limit ?? 24, 1), MAX_SEARCH_LIMIT);
  const offset = Math.max(options.offset ?? 0, 0);

  const where: string[] = [];
  const params: (string | number)[] = [];

  const q = options.query?.trim();
  if (q) {
    // Parameterised LIKE: wildcards go into the bound value, never into the SQL.
    // User-supplied % and _ are escaped so a query like "100%" stays literal.
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(
      "(name LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\'" +
        " OR description LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like, like);
  }
  if (options.category) {
    where.push("category = ?");
    params.push(options.category);
  }
  if (typeof options.minSecurityScore === "number") {
    where.push("(security_score IS NULL OR security_score >= ?)");
    params.push(options.minSecurityScore);
  }

  const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM ${ENTRIES_TABLE} ${filter}`).get(...params) as {
      n: number;
    }
  ).n;

  const rows = db
    .prepare(
      `SELECT * FROM ${ENTRIES_TABLE} ${filter}
        ORDER BY quality_score DESC NULLS LAST, name ASC
        LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as EntryRow[];

  return { entries: rows.map(rowToEntry), total };
}

export function getSkillCatalogEntry(id: string): SkillCatalogEntry | null {
  const db = getDbInstance();
  const row = db.prepare(`SELECT * FROM ${ENTRIES_TABLE} WHERE id = ?`).get(id) as
    EntryRow | undefined;
  return row ? rowToEntry(row) : null;
}

export function listSkillCatalogCategories(): { category: string; count: number }[] {
  const db = getDbInstance();
  return db
    .prepare(
      `SELECT category, COUNT(*) AS count FROM ${ENTRIES_TABLE}
        WHERE category IS NOT NULL AND category <> ''
        GROUP BY category ORDER BY count DESC, category ASC`
    )
    .all() as { category: string; count: number }[];
}

export function clearSkillCatalog(): void {
  const db = getDbInstance();
  db.transaction(() => {
    db.prepare(`DELETE FROM ${ENTRIES_TABLE}`).run();
    db.prepare(`DELETE FROM ${META_TABLE}`).run();
  })();
}
