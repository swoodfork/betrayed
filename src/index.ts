import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = createBot(config);

  const shutdown = (): void => {
    console.info("Stopping Zors Bot.");
    client.destroy();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await client.login(config.DISCORD_TOKEN);
}

main().catch((error: unknown) => {
  console.error("Zors Bot failed to start.", error);
  process.exitCode = 1;
});
