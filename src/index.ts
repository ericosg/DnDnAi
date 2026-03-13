import { config } from "./config.js";
import { createBot } from "./discord/client.js";
import { log } from "./logger.js";

log.info("Starting DnDnAi...");

const client = createBot();
client.login(config.discordToken);
