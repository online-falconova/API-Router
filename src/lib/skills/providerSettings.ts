import { getSettings } from "@/lib/db/settings";
import { normalizeSkillsProvider, type SkillsProvider } from "@/shared/constants/skillsProviders";

/**
 * Server-side skills-provider helper.
 *
 * The identifiers, labels and guards live in `@/shared/constants/skillsProviders`
 * because client components need them; this module adds the database read, so it
 * must only ever be imported from server code.
 */
export {
  SKILLS_PROVIDERS,
  DEFAULT_SKILLS_PROVIDER,
  SKILLS_PROVIDER_LABELS,
  isSkillsProvider,
  normalizeSkillsProvider,
  type SkillsProvider,
} from "@/shared/constants/skillsProviders";

export async function getSkillsProviderSetting(): Promise<SkillsProvider> {
  const settings = (await getSettings()) as Record<string, unknown>;
  return normalizeSkillsProvider(settings.skillsProvider);
}
