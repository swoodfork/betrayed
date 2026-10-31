import { loadConfig } from "./config.js";

try {
  loadConfig();
  console.info("Zors Bot configuration is valid.");
} catch (error) {
  console.error("Zors Bot configuration is invalid.", error);
  process.exitCode = 1;
}
