"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Skeleton, ConfirmModal } from "@/shared/components";

/**
 * API Router Skills browser.
 *
 * Design notes (UI/UX Pro Max — "Marketplace / Directory" pattern, density 8/10):
 *  - The search field is the primary CTA and is debounced, so results stream in as
 *    the user types instead of requiring Enter.
 *  - Loading renders a skeleton grid at the same dimensions as the result grid, so
 *    there is no layout shift when results land.
 *  - Both empty states are actionable: "not synced" offers Sync, "no matches"
 *    offers concrete next steps rather than a dead end.
 *  - Scores are shown as labelled chips, never colour alone.
 *  - Motion stays in the 150-200ms band and is dropped under prefers-reduced-motion.
 *
 * Palette deliberately uses the app's existing semantic tokens (primary / surface /
 * border / text-muted) rather than introducing a new one, so this tab inherits the
 * brand red and both themes automatically.
 */

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

interface CatalogSkill {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
  sourceRepo: string | null;
  author: string | null;
  version: string | null;
  complexity: string | null;
  risk: string | null;
  qualityScore: number | null;
  securityScore: number | null;
  securityStatus: string | null;
}

interface CatalogSource {
  repo: string;
  ref: string;
  catalogVersion?: string | null;
  generatedAt?: string | null;
  syncedAt?: string;
  totalSkills?: number;
}

interface CatalogResponse {
  synced: boolean;
  source: CatalogSource | null;
  skills: CatalogSkill[];
  total: number;
  categories: { category: string; count: number }[];
  error?: string;
}

interface PendingRisk {
  skill: CatalogSkill;
  securityScore: number | null;
  securityStatus: string | null;
  threshold: number;
}

interface ApiRouterSkillsTabProps {
  onRefreshSkills: () => Promise<void>;
}

function scoreTone(score: number | null): string {
  if (score === null) return "bg-bg-subtle text-text-muted border-border";
  if (score >= 90) return "bg-emerald-500/10 text-emerald-500 border-emerald-500/30";
  if (score >= 80) return "bg-amber-500/10 text-amber-600 border-amber-500/30";
  return "bg-red-500/10 text-red-500 border-red-500/30";
}

function Chip({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone?: string;
  title?: string;
}): JSX.Element {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-control border text-[11px] font-medium ${
        tone || "bg-bg-subtle text-text-muted border-border"
      }`}
    >
      <span className="text-text-muted font-normal">{label}</span>
      {value}
    </span>
  );
}

export function ApiRouterSkillsTab({ onRefreshSkills }: ApiRouterSkillsTabProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState("");
  const [skills, setSkills] = useState<CatalogSkill[]>([]);
  const [categories, setCategories] = useState<{ category: string; count: number }[]>([]);
  const [source, setSource] = useState<CatalogSource | null>(null);
  const [synced, setSynced] = useState<boolean | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [pendingRisk, setPendingRisk] = useState<PendingRisk | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Debounce the query so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (nextOffset: number, append: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        });
        if (debouncedQuery) params.set("q", debouncedQuery);
        if (category) params.set("category", category);

        const res = await fetch(`/api/skills/apirouter?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as CatalogResponse;

        if (!res.ok) {
          setError(data.error || "Could not load the skills catalog.");
          return;
        }

        setSynced(data.synced);
        setSource(data.source);
        setTotal(data.total);
        setCategories(data.categories || []);
        setSkills((prev) => (append ? [...prev, ...data.skills] : data.skills));
        setOffset(nextOffset);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load the skills catalog.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debouncedQuery, category]
  );

  useEffect(() => {
    void load(0, false);
    return () => abortRef.current?.abort();
  }, [load]);

  const runSync = useCallback(
    async (force: boolean) => {
      setSyncing(true);
      setError("");
      setStatus("");
      try {
        const res = await fetch("/api/skills/apirouter/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        });
        const data = (await res.json()) as {
          success?: boolean;
          status?: string;
          totalSkills?: number;
          skippedEntries?: number;
          error?: string;
        };
        if (!res.ok || !data.success) {
          setError(data.error || "Catalog sync failed.");
          return;
        }
        const skippedNote = data.skippedEntries
          ? ` ${data.skippedEntries.toLocaleString()} entries were skipped as unreadable.`
          : "";
        setStatus(
          data.status === "unchanged"
            ? "Catalog already up to date."
            : `Catalog synced — ${(data.totalSkills || 0).toLocaleString()} skills available.${skippedNote}`
        );
        await load(0, false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Catalog sync failed.");
      } finally {
        setSyncing(false);
      }
    },
    [load]
  );

  const install = useCallback(
    async (skill: CatalogSkill, acknowledgeRisk: boolean) => {
      setInstallingId(skill.id);
      setError("");
      setStatus("");
      try {
        const res = await fetch("/api/skills/apirouter/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: skill.id, acknowledgeRisk }),
        });
        const data = (await res.json()) as {
          success?: boolean;
          error?: string;
          requiresAcknowledgement?: boolean;
          securityScore?: number | null;
          securityStatus?: string | null;
          threshold?: number;
        };

        // 412: upstream security review flagged the skill — ask before installing.
        if (res.status === 412 && data.requiresAcknowledgement) {
          setPendingRisk({
            skill,
            securityScore: data.securityScore ?? skill.securityScore,
            securityStatus: data.securityStatus ?? skill.securityStatus,
            threshold: data.threshold ?? 80,
          });
          return;
        }

        if (!res.ok || !data.success) {
          setError(data.error || "Install failed.");
          return;
        }

        setInstalledIds((prev) => (prev.includes(skill.id) ? prev : [...prev, skill.id]));
        setStatus(`Installed "${skill.name}". It is disabled until you enable it.`);
        await onRefreshSkills();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Install failed.");
      } finally {
        setInstallingId(null);
      }
    },
    [onRefreshSkills]
  );

  const confirmRisk = useCallback(async () => {
    if (!pendingRisk) return;
    const skill = pendingRisk.skill;
    setPendingRisk(null);
    await install(skill, true);
  }, [pendingRisk, install]);

  const hasMore = skills.length < total;
  const syncedLabel = useMemo(() => {
    if (!source?.syncedAt) return null;
    const parsed = new Date(source.syncedAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString();
  }, [source?.syncedAt]);

  return (
    <div className="grid gap-4">
      {/* ── Search + source header ─────────────────────────────────────────── */}
      <Card padding="sm">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="font-semibold flex items-center gap-2">
              <span
                className="material-symbols-outlined text-[20px] text-primary"
                aria-hidden="true"
              >
                extension
              </span>
              API Router Skills
            </h3>
            <p className="text-sm text-text-muted mt-0.5">
              {synced && source ? (
                <>
                  <span className="font-mono text-xs">
                    {source.repo}@{source.ref}
                  </span>
                  {typeof source.totalSkills === "number" && (
                    <> · {source.totalSkills.toLocaleString()} skills</>
                  )}
                  {syncedLabel && <> · synced {syncedLabel}</>}
                </>
              ) : (
                "A pinned skill catalog, cached locally for offline search."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => runSync(synced === true)}
            disabled={syncing}
            className="inline-flex items-center gap-2 h-11 px-4 text-sm font-medium rounded-control bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition-colors duration-150 cursor-pointer"
          >
            <span
              className={`material-symbols-outlined text-[18px] ${
                syncing ? "animate-spin motion-reduce:animate-none" : ""
              }`}
              aria-hidden="true"
            >
              {syncing ? "progress_activity" : "sync"}
            </span>
            {syncing ? "Syncing…" : synced ? "Re-sync catalog" : "Sync catalog"}
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <label htmlFor="apirouter-skill-search" className="sr-only">
              Search API Router Skills
            </label>
            <span
              className="material-symbols-outlined text-[18px] text-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            >
              search
            </span>
            <input
              id="apirouter-skill-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, description or tag…"
              className="w-full h-11 pl-10 pr-3 rounded-control bg-bg border border-border text-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50"
            />
          </div>
          <div>
            <label htmlFor="apirouter-skill-category" className="sr-only">
              Filter by category
            </label>
            <select
              id="apirouter-skill-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-11 w-full sm:w-56 px-3 rounded-control bg-bg border border-border text-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.category} value={c.category}>
                  {c.category} ({c.count})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status region: announced to screen readers, kept next to the controls. */}
        <div aria-live="polite" className="mt-3 empty:mt-0">
          {error && (
            <p className="flex items-start gap-2 p-3 rounded-control bg-red-500/10 text-red-500 text-sm">
              <span className="material-symbols-outlined text-[18px] shrink-0" aria-hidden="true">
                error
              </span>
              {error}
            </p>
          )}
          {!error && status && (
            <p className="flex items-start gap-2 p-3 rounded-control bg-emerald-500/10 text-emerald-500 text-sm">
              <span className="material-symbols-outlined text-[18px] shrink-0" aria-hidden="true">
                check_circle
              </span>
              {status}
            </p>
          )}
        </div>
      </Card>

      {/* ── Loading skeletons (same grid metrics as results: no layout shift) ── */}
      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} padding="sm">
              <Skeleton className="h-4 w-2/3 mb-3" />
              <Skeleton className="h-3 w-full mb-1.5" />
              <Skeleton className="h-3 w-4/5 mb-4" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-16" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Empty state: catalog never synced ─────────────────────────────── */}
      {!loading && synced === false && (
        <Card>
          <div className="text-center py-10 px-4">
            <span
              className="material-symbols-outlined text-[40px] text-text-muted"
              aria-hidden="true"
            >
              cloud_download
            </span>
            <h4 className="font-semibold mt-3">Catalog not synced yet</h4>
            <p className="text-sm text-text-muted mt-1 max-w-md mx-auto">
              Sync once to download the pinned catalog index and cache it locally. After that,
              search and filtering work offline.
            </p>
            {source && (
              <p className="text-xs font-mono text-text-muted mt-2">
                {source.repo}@{source.ref}
              </p>
            )}
            <button
              type="button"
              onClick={() => runSync(false)}
              disabled={syncing}
              className="mt-4 inline-flex items-center gap-2 h-11 px-5 text-sm font-medium rounded-control bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition-colors duration-150 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                sync
              </span>
              {syncing ? "Syncing…" : "Sync catalog now"}
            </button>
          </div>
        </Card>
      )}

      {/* ── Empty state: synced but no matches ────────────────────────────── */}
      {!loading && synced && skills.length === 0 && !error && (
        <Card>
          <div className="text-center py-10 px-4">
            <span
              className="material-symbols-outlined text-[40px] text-text-muted"
              aria-hidden="true"
            >
              search_off
            </span>
            <h4 className="font-semibold mt-3">
              No skills match{query ? ` "${query}"` : " these filters"}
            </h4>
            <p className="text-sm text-text-muted mt-1">
              Try a broader term, or clear the category filter.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
              {(category || query) && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setCategory("");
                  }}
                  className="h-11 px-4 text-sm font-medium rounded-control border border-border hover:bg-bg-subtle transition-colors duration-150 cursor-pointer"
                >
                  Clear filters
                </button>
              )}
              {["git", "docker", "testing", "database"].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setCategory("");
                    setQuery(suggestion);
                  }}
                  className="h-11 px-4 text-sm rounded-control border border-border text-text-muted hover:text-text-main hover:bg-bg-subtle transition-colors duration-150 cursor-pointer"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* ── Results ───────────────────────────────────────────────────────── */}
      {!loading && skills.length > 0 && (
        <>
          <p className="text-xs text-text-muted px-1">
            Showing {skills.length.toLocaleString()} of {total.toLocaleString()} skills
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {skills.map((skill) => {
              const installed = installedIds.includes(skill.id);
              const busy = installingId === skill.id;
              return (
                <Card key={skill.id} padding="sm" className="flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-semibold text-sm leading-snug break-words">
                      {skill.displayName || skill.name}
                    </h4>
                    {skill.category && (
                      <span className="shrink-0 px-2 py-0.5 rounded-control bg-primary/10 text-primary border border-primary/20 text-[11px] font-medium">
                        {skill.category}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-text-muted mt-1.5 line-clamp-3 flex-1">
                    {skill.description || "No description provided upstream."}
                  </p>

                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {typeof skill.qualityScore === "number" && (
                      <Chip
                        label="Quality"
                        value={String(Math.round(skill.qualityScore))}
                        tone={scoreTone(skill.qualityScore)}
                        title="Upstream quality score out of 100"
                      />
                    )}
                    {typeof skill.securityScore === "number" && (
                      <Chip
                        label="Security"
                        value={String(Math.round(skill.securityScore))}
                        tone={scoreTone(skill.securityScore)}
                        title="Upstream security score out of 100"
                      />
                    )}
                    {skill.complexity && <Chip label="Level" value={skill.complexity} />}
                  </div>

                  {skill.sourceRepo && (
                    <p
                      className="text-[11px] text-text-muted mt-2 truncate"
                      title={skill.sourceRepo}
                    >
                      Source: {skill.sourceRepo}
                    </p>
                  )}

                  <div className="mt-3 pt-3 border-t border-border">
                    <button
                      type="button"
                      onClick={() => install(skill, false)}
                      disabled={busy || installed}
                      aria-label={`Install ${skill.name}`}
                      className={`w-full inline-flex items-center justify-center gap-2 h-11 px-4 text-sm font-medium rounded-control transition-colors duration-150 disabled:opacity-60 ${
                        installed
                          ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 cursor-default"
                          : "bg-primary text-white hover:bg-primary-hover cursor-pointer"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                        {installed ? "check" : busy ? "progress_activity" : "download"}
                      </span>
                      {installed ? "Installed" : busy ? "Installing…" : "Install"}
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>

          {hasMore && (
            <button
              type="button"
              onClick={() => load(offset + PAGE_SIZE, true)}
              disabled={loadingMore}
              className="h-11 px-5 mx-auto inline-flex items-center gap-2 text-sm font-medium rounded-control border border-border hover:bg-bg-subtle disabled:opacity-50 transition-colors duration-150 cursor-pointer"
            >
              {loadingMore ? "Loading…" : `Load ${Math.min(PAGE_SIZE, total - skills.length)} more`}
            </button>
          )}
        </>
      )}

      <ConfirmModal
        isOpen={pendingRisk !== null}
        onClose={() => setPendingRisk(null)}
        onConfirm={confirmRisk}
        variant="danger"
        title="Install a flagged skill?"
        confirmText="Install anyway"
        cancelText="Cancel"
        message={
          <span className="block text-sm">
            <strong>{pendingRisk?.skill.displayName || pendingRisk?.skill.name}</strong> scored{" "}
            {pendingRisk?.securityScore ?? "unknown"} on the upstream security review, below the{" "}
            {pendingRisk?.threshold} threshold
            {pendingRisk?.securityStatus ? ` (status: ${pendingRisk.securityStatus})` : ""}.
            <span className="block mt-2 text-text-muted">
              A skill is an instruction payload handed to a model that may have tool access. Review
              the source before enabling it. It installs disabled either way.
            </span>
          </span>
        }
      />
    </div>
  );
}

export default ApiRouterSkillsTab;
