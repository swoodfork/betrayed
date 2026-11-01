import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Client, GatewayIntentBits, Routes } from "discord.js";

import { loadConfig } from "../config.js";

const classKeys = [
  "druid",
  "hunter",
  "mage",
  "paladin",
  "priest",
  "rogue",
  "shaman",
  "warlock",
  "warrior",
] as const;

interface GuildEmojiRecord {
  id: string;
  name: string | null;
}

function argumentValue(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index === -1 || !value) {
    throw new Error(`Missing required argument ${name}.`);
  }
  return value;
}

async function validatePng(filePath: string): Promise<void> {
  const file = await readFile(filePath);
  if (file.length > 256 * 1024) {
    throw new Error(`${path.basename(filePath)} exceeds Discord's 256 KB limit.`);
  }
  if (
    file.length < 24 ||
    file.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  ) {
    throw new Error(`${path.basename(filePath)} is not a valid PNG.`);
  }
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  if (width !== 1024 || height !== 1024) {
    throw new Error(
      `${path.basename(filePath)} must be 1024 × 1024; received ${width} × ${height}.`,
    );
  }
}

async function main(): Promise<void> {
  const scope = argumentValue("--scope");
  if (scope !== "test" && scope !== "production") {
    throw new Error("--scope must be test or production.");
  }
  const iconsDirectory = path.resolve(argumentValue("--icons"));
  const outputPath = path.resolve(argumentValue("--output"));
  const approvedGuildId = argumentValue("--approve-guild-id");
  const config = loadConfig();
  const guildId =
    scope === "test"
      ? config.DISCORD_TEST_GUILD_ID
      : config.DISCORD_PRODUCTION_GUILD_ID;
  if (approvedGuildId !== guildId) {
    throw new Error(`${scope} emoji upload guild approval does not match.`);
  }

  const iconPaths = new Map(
    classKeys.map((classKey) => [
      classKey,
      path.join(iconsDirectory, `zors_class_${classKey}.png`),
    ]),
  );
  await Promise.all([...iconPaths.values()].map(validatePng));

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(config.DISCORD_TOKEN);
    const guild = await client.guilds.fetch(guildId);
    const existing = (await client.rest.get(
      Routes.guildEmojis(guildId),
    )) as GuildEmojiRecord[];
    const emojiIds: Record<string, string> = {};

    for (const classKey of classKeys) {
      const name = `zors_${classKey}`;
      const matches = existing.filter((emoji) => emoji.name === name);
      if (matches.length > 1) {
        throw new Error(
          `${guild.name} has multiple custom emojis named ${name}.`,
        );
      }
      const current = matches[0];
      const iconPath = iconPaths.get(classKey)!;
      const emoji =
        current ??
        ((await client.rest.post(Routes.guildEmojis(guildId), {
          body: {
            name,
            image: `data:image/png;base64,${(await readFile(iconPath)).toString("base64")}`,
          },
          reason: `Zors Bot uniform ${classKey} class marker`,
        })) as GuildEmojiRecord);
      emojiIds[classKey] = emoji.id;
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          version: 1,
          scope,
          guildId: guild.id,
          guildName: guild.name,
          generatedAt: new Date().toISOString(),
          classEmojiIds: emojiIds,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.info(
      `Verified ${classKeys.length} Zors class emojis in ${guild.name}; bindings written to ${outputPath}.`,
    );
  } finally {
    client.destroy();
  }
}

main().catch((error: unknown) => {
  console.error("Unable to upload Zors class emojis.", error);
  process.exitCode = 1;
});
