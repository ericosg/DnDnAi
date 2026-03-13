import { config } from "./config.js";
import { createBot } from "./discord/client.js";

console.log("Starting DnDnAi...");

const client = createBot();
client.login(config.discordToken);
