/**
 * One-shot: post a single message to a Discord channel as the bot, then exit.
 *
 * Usage:
 *   bun run scripts/post-message.ts <channel-id> <path-to-message-file>
 *
 * The message file is read as UTF-8 plain text (Discord markdown supported).
 * Safer than passing the message via argv — long strings hit MAX_ARG_STRLEN.
 */

import { readFile } from "node:fs/promises";
import { Client, GatewayIntentBits, type TextChannel } from "discord.js";
import { config } from "../src/config.js";

const channelId = process.argv[2];
const messageFile = process.argv[3];

if (!channelId || !messageFile) {
  console.error("Usage: bun run scripts/post-message.ts <channel-id> <path-to-message-file>");
  process.exit(2);
}

const content = (await readFile(messageFile, "utf-8")).trim();
if (!content) {
  console.error("Message file is empty.");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async (c) => {
  try {
    const channel = await c.channels.fetch(channelId);
    if (!channel || !("send" in channel)) {
      console.error(`Channel ${channelId} not found or not a text channel.`);
      process.exit(1);
    }
    const msg = await (channel as TextChannel).send(content);
    console.log(`Posted message ${msg.id} to #${(channel as TextChannel).name} (${channelId})`);
  } catch (e) {
    console.error("Post failed:", e);
    process.exit(1);
  } finally {
    await c.destroy();
    process.exit(0);
  }
});

client.login(config.discordToken).catch((e) => {
  console.error("Login failed:", e);
  process.exit(1);
});
