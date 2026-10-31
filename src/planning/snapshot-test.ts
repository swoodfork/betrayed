import { writeFile } from "node:fs/promises";
import path from "node:path";

import { ChannelType, Client, GatewayIntentBits } from "discord.js";

import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const outputIndex = process.argv.indexOf("--output");
  const outputValue = process.argv[outputIndex + 1];
  if (outputIndex === -1 || !outputValue) {
    throw new Error("Missing required argument --output.");
  }

  const config = loadConfig();
  if (config.DISCORD_TEST_GUILD_ID === config.DISCORD_PRODUCTION_GUILD_ID) {
    throw new Error("Test and production guild boundaries are invalid.");
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(config.DISCORD_TOKEN);
    const guild = await client.guilds.fetch(config.DISCORD_TEST_GUILD_ID);
    const [channels, roles] = await Promise.all([
      guild.channels.fetch(),
      guild.roles.fetch(),
    ]);
    const inventory = {
      guild: { id: guild.id, name: guild.name },
      roles: [...roles.values()]
        .map((role) => ({
          id: role.id,
          name: role.name,
          position: role.position,
          managed: role.managed,
          color: role.colors.primaryColor,
          permissions: role.permissions.toArray().sort(),
        }))
        .sort(
          (left, right) =>
            right.position - left.position || left.id.localeCompare(right.id),
        ),
      channels: [...channels.values()]
        .filter((channel) => channel !== null)
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: ChannelType[channel.type] ?? `Unknown(${channel.type})`,
          parentId: channel.parentId,
          position: channel.rawPosition,
          permissionOverwrites: [
            ...channel.permissionOverwrites.cache.values(),
          ].map((overwrite) => ({
            id: overwrite.id,
            type: overwrite.type === 0 ? "role" : "member",
            allow: overwrite.allow.toArray().sort(),
            deny: overwrite.deny.toArray().sort(),
          })),
        }))
        .sort(
          (left, right) =>
            left.position - right.position || left.id.localeCompare(right.id),
        ),
    };

    await writeFile(
      path.resolve(outputValue),
      `${JSON.stringify(inventory, null, 2)}\n`,
      "utf8",
    );
  } finally {
    client.destroy();
  }
}

main().catch((error: unknown) => {
  console.error("Unable to snapshot Betrayed Test for planning.", error);
  process.exitCode = 1;
});
