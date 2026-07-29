import { NextResponse } from "next/server";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import {
  searchSkillCatalog,
  getSkillCatalogMeta,
  listSkillCatalogCategories,
} from "@/lib/db/skillCatalog";
import { getCatalogSource, CatalogConfigError } from "@/lib/skills/apiRouterCatalog";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

/**
 * GET /api/skills/apirouter
 *
 * Search the locally cached API Router Skills catalog. Reads only from SQLite —
 * no upstream call — so the dashboard stays responsive and works offline once
 * synced. Use POST /api/skills/apirouter/sync to refresh the cache.
 */
export async function GET(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() || "";
    const category = searchParams.get("category")?.trim() || "";
    const limitParam = Number(searchParams.get("limit"));
    const offsetParam = Number(searchParams.get("offset"));
    const minSecurityParam = Number(searchParams.get("minSecurityScore"));

    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;
    const minSecurityScore = Number.isFinite(minSecurityParam) ? minSecurityParam : undefined;

    const meta = getSkillCatalogMeta();
    if (!meta) {
      // Not an error: the catalog simply has not been synced yet. The UI turns
      // this into a "Sync catalog" empty state rather than a dead end.
      let source: { repo: string; ref: string } | null = null;
      try {
        const s = getCatalogSource();
        source = { repo: s.repo, ref: s.ref };
      } catch {
        source = null;
      }
      return NextResponse.json({
        synced: false,
        source,
        skills: [],
        total: 0,
        categories: [],
      });
    }

    const { entries, total } = searchSkillCatalog({
      query,
      category: category || undefined,
      minSecurityScore,
      limit,
      offset,
    });

    return NextResponse.json({
      synced: true,
      source: {
        repo: meta.repo,
        ref: meta.ref,
        catalogVersion: meta.catalogVersion,
        generatedAt: meta.generatedAt,
        syncedAt: meta.syncedAt,
        totalSkills: meta.totalSkills,
      },
      skills: entries,
      total,
      limit,
      offset,
      categories: listSkillCatalogCategories(),
    });
  } catch (err: unknown) {
    const status = err instanceof CatalogConfigError ? 400 : 500;
    return NextResponse.json(
      { error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      { status }
    );
  }
}
