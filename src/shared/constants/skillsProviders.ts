/**
 * Skill catalog provider identifiers — client-safe.
 *
 * This module must stay dependency-free. It is imported by client components
 * (the Skills marketplace tab and the Settings picker), so pulling in anything
 * that reaches `@/lib/db/*` would drag the SQLite/ioredis stack into the browser
 * bundle and fail the build with "Can't resolve 'dns'".
 *
 * Server-side helpers that need the database live in
 * `src/lib/skills/providerSettings.ts`, which re-exports everything here.
 */

/**
 * - `skillsmp`   SkillsMP marketplace (requires an API key)
 * - `skillssh`   skills.sh public directory
 * - `apirouter`  API Router Skills — a pinned git catalog cached locally in SQLite
 */
export type SkillsProvider = "skillsmp" | "skillssh" | "apirouter";

export const SKILLS_PROVIDERS = ["skillsmp", "skillssh", "apirouter"] as const;

export const DEFAULT_SKILLS_PROVIDER: SkillsProvider = "skillssh";

/** Human-readable labels, shared by the settings picker and the marketplace tab. */
export const SKILLS_PROVIDER_LABELS: Record<SkillsProvider, string> = {
  skillsmp: "SkillsMP",
  skillssh: "skills.sh",
  apirouter: "API Router Skills",
};

export function isSkillsProvider(value: unknown): value is SkillsProvider {
  return typeof value === "string" && (SKILLS_PROVIDERS as readonly string[]).includes(value);
}

export function normalizeSkillsProvider(value: unknown): SkillsProvider {
  return isSkillsProvider(value) ? value : DEFAULT_SKILLS_PROVIDER;
}
