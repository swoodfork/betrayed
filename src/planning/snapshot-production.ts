import { writeFile } from "node:fs/promises";
import path from "node:path";

import { Client, GatewayIntentBits } from "discord.js";

import { loadConfig } from "../config.js";
import { createInventory } from "../inventory.js";
import { loadProtectedResources } from "../protected-resources.js";

function argumentValue(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index === -1 || !value) {
    throw new Error(`Missing required argument ${name}.`);
  }
  return value;
}

async function main(): Promise<void> {
  const output = path.resolve(argumentValue("--output"));
  const approvedGuildId = argumentValue("--approve-production-guild-id");
  const config = loadConfig();
  if (approvedGuildId !== config.DISCORD_PRODUCTION_GUILD_ID) {
    throw new Error("Production snapshot guild approval does not match.");
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  try {
    await client.login(config.DISCORD_TOKEN);
    const guild = await client.guilds.fetch(config.DISCORD_PRODUCTION_GUILD_ID);
    const inventory = await createInventory(
      guild,
      await loadProtectedResources(),
    );
    await writeFile(
      output,
      `${JSON.stringify(inventory, null, 2)}\n`,
      "utf8",
    );
  } finally {
    client.destroy();
  }
}

main().catch((error: unknown) => {
  console.error("Unable to snapshot Betrayed Production for planning.", error);
  process.exitCode = 1;
});
