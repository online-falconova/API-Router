import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import { validateBody, isValidationFailure } from "@/shared/validation/helpers";
import { syncSkillCatalog, CatalogConfigError } from "@/lib/skills/apiRouterCatalog";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";

const syncSchema = z.object({
  /** Skip the ETag check and re-download the index even if it looks unchanged. */
  force: z.boolean().optional().default(false),
});

/**
 * POST /api/skills/apirouter/sync
 *
 * Download the pinned catalog index and rebuild the local cache. This is the only
 * route that talks upstream; search reads SQLite. Sends If-None-Match, so an
 * unchanged catalog costs a 304 rather than a ~25 MB download.
 */
export async function POST(request: Request) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Body is optional: an empty POST means a normal (non-forced) sync.
    let rawBody: unknown = {};
    try {
      const text = await request.text();
      if (text.trim()) rawBody = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateBody(syncSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json(validation.error, { status: 400 });
    }

    const result = await syncSkillCatalog({ force: validation.data.force });
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const status = err instanceof CatalogConfigError ? 400 : 502;
    return NextResponse.json(
      { error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) },
      { status }
    );
  }
}
