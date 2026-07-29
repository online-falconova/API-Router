# API Router Skills — Attribution

The **API Router Skills** provider on the Skills page installs skills from an external,
community-aggregated catalog. API Router does not author these skills and does not claim
copyright over them. This file records the attribution required by their licences.

## Catalog source

- Upstream project: [awesome-omni-skills](https://github.com/diegosouzapw/awesome-omni-skills)
- Default pinned ref: `v0.12.9`
- Configured via `OMNIROUTE_SKILLS_CATALOG_REPO` and `OMNIROUTE_SKILLS_CATALOG_REF`
  (see `.env.example`)

## Licensing

The upstream project is dual-licensed, and the two halves have different terms:

| Part                            | Licence                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| Tooling and code                | MIT                                                                |
| Skill content and documentation | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode) |

CC BY 4.0 permits sharing and adaptation for any purpose, including commercial use, on
one condition: **attribution**. Credit must be given, a link to the licence provided, and
changes indicated.

Upstream also notes that a more specific licence may apply to individual skills, because
the catalog aggregates content from many third-party repositories. The authoritative
per-source lists live upstream in `SOURCES.txt` and `REPOSITORY-SOURCES.md`.

## How attribution is preserved

Attribution is not just documented here — it is carried through the install path in code:

- Each catalog entry retains its upstream `source_repo` and `author` fields in the local
  cache (`src/lib/db/skillCatalog.ts`).
- On install, a provenance header is prepended to the stored skill payload recording the
  catalog repo and ref, the skill id, the upstream source repository and author, a link
  back to the source file, and the CC BY 4.0 notice
  (`src/app/api/skills/apirouter/install/route.ts`).
- Installed skills are tagged `api-router-skills` and recorded with
  `source_provider = 'apirouter'`, so catalog-sourced skills stay distinguishable from
  first-party and locally authored ones.

## What this does not cover

The 46 first-party skills under `skills/` in this repository are part of API Router itself
and are covered by the repository `LICENSE`, not by this file.

## If you fork the catalog

Pointing `OMNIROUTE_SKILLS_CATALOG_REPO` at your own fork does not change your obligations:
the CC BY 4.0 attribution requirement travels with the content. Keep the upstream credits
in your fork, and keep this file accurate for whichever catalog you ship.
