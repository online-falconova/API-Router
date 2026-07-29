-- API Router Skills catalog cache.
--
-- The upstream catalog index (skills_index.json) is ~25 MB for 4,715 skills, far
-- too large to fetch on every dashboard render. It is fetched once per pinned ref
-- and projected into these tables, so search runs locally against SQLite.
--
-- skill_catalog_entries holds one row per catalog skill (a slim projection of the
-- upstream index). skill_catalog_meta is a single-row table recording which repo
-- and ref produced the cache, plus the ETag used for revalidation.

CREATE TABLE IF NOT EXISTS skill_catalog_entries (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL,
  name              TEXT NOT NULL,
  display_name      TEXT,
  description       TEXT,
  category          TEXT,
  tags              TEXT NOT NULL DEFAULT '[]',
  source_repo       TEXT,
  author            TEXT,
  version           TEXT,
  path              TEXT NOT NULL,
  entrypoint_path   TEXT,
  complexity        TEXT,
  risk              TEXT,
  quality_score     REAL,
  security_score    REAL,
  security_status   TEXT,
  validation_status TEXT,
  install_targets   TEXT NOT NULL DEFAULT '[]',
  synced_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sce_name ON skill_catalog_entries(name);
CREATE INDEX IF NOT EXISTS idx_sce_category ON skill_catalog_entries(category);
CREATE INDEX IF NOT EXISTS idx_sce_security_score ON skill_catalog_entries(security_score);
CREATE INDEX IF NOT EXISTS idx_sce_quality_score ON skill_catalog_entries(quality_score);

CREATE TABLE IF NOT EXISTS skill_catalog_meta (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  repo            TEXT NOT NULL,
  ref             TEXT NOT NULL,
  etag            TEXT,
  catalog_version TEXT,
  generated_at    TEXT,
  total_skills    INTEGER NOT NULL DEFAULT 0,
  synced_at       TEXT NOT NULL
);
