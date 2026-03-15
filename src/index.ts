import { config, VERSION } from "./config.js";
import { createBot } from "./discord/client.js";
import { log } from "./logger.js";

log.info(`DnDnAi v${VERSION}`);

const client = createBot();
client.login(config.discordToken);
