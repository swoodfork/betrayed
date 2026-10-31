import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

const protectedResourcesSchema = z.object({
  protectedChannels: z
    .array(
      z.object({
        id: z.string().regex(/^\d{17,20}$/).optional(),
        name: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .default([]),
  protectedSections: z
    .array(
      z.object({
        id: z.string().regex(/^\d{17,20}$/).optional(),
        name: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .default([]),
});

export interface ProtectedResources {
  channelIds: ReadonlySet<string>;
  channelNames: ReadonlySet<string>;
  sectionIds: ReadonlySet<string>;
  sectionNames: ReadonlySet<string>;
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export async function loadProtectedResources(): Promise<ProtectedResources> {
  const filePath = path.resolve(
    process.cwd(),
    "config",
    "protected-resources.yaml",
  );
  const file = await readFile(filePath, "utf8");
  const config = protectedResourcesSchema.parse(parse(file));

  return {
    channelIds: new Set(
      config.protectedChannels.flatMap((resource) =>
        resource.id ? [resource.id] : [],
      ),
    ),
    channelNames: new Set(
      config.protectedChannels.map((resource) => normalizeName(resource.name)),
    ),
    sectionIds: new Set(
      config.protectedSections.flatMap((resource) =>
        resource.id ? [resource.id] : [],
      ),
    ),
    sectionNames: new Set(
      config.protectedSections.map((resource) => normalizeName(resource.name)),
    ),
  };
}

export function isProtectedName(
  name: string,
  resources: ReadonlySet<string>,
): boolean {
  return resources.has(normalizeName(name));
}

export function isProtectedResource(
  id: string,
  name: string,
  ids: ReadonlySet<string>,
  names: ReadonlySet<string>,
): boolean {
  return ids.has(id) || isProtectedName(name, names);
}
