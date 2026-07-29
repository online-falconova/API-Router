import { getSettings } from "@/lib/db/settings";

/**
 * Skill catalog providers available to the Skills page.
 *
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

export async function getSkillsProviderSetting(): Promise<SkillsProvider> {
  const settings = (await getSettings()) as Record<string, unknown>;
  return normalizeSkillsProvider(settings.skillsProvider);
}
