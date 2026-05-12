/**
 * One-shot: connect to Discord with the bot token, list every channel the bot
 * can see in every guild it's in, then exit. Read-only. Safe to run while the
 * main bot is down — but if the main bot IS running it will steal the gateway
 * connection (Discord allows only one gateway per token at a time).
 *
 * Run: bun run scripts/list-channels.ts
 */

import { Client, ChannelType, GatewayIntentBits } from "discord.js";
import { config } from "../src/config.js";

const KIND: Partial<Record<ChannelType, string>> = {
  [ChannelType.GuildText]: "text",
  [ChannelType.GuildVoice]: "voice",
  [ChannelType.GuildAnnouncement]: "announce",
  [ChannelType.GuildForum]: "forum",
  [ChannelType.GuildStageVoice]: "stage",
  [ChannelType.GuildCategory]: "category",
  [ChannelType.GuildDirectory]: "dir",
  [ChannelType.GuildMedia]: "media",
  [ChannelType.PublicThread]: "thread/pub",
  [ChannelType.PrivateThread]: "thread/priv",
  [ChannelType.AnnouncementThread]: "thread/announce",
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", async (c) => {
  console.log(`\nLogged in as ${c.user.tag} (${c.user.id})\n`);

  const guilds = c.guilds.cache;
  console.log(`In ${guilds.size} guild(s):\n`);

  for (const guild of guilds.values()) {
    // Fetch ensures we have a complete channel list (cache may be partial)
    const channels = await guild.channels.fetch();
    console.log(`━━ Guild: ${guild.name} (${guild.id}) — ${channels.size} channel(s)`);

    // Group by category for readability
    const categories = new Map<string, string>();
    for (const ch of channels.values()) {
      if (ch && ch.type === ChannelType.GuildCategory) {
        categories.set(ch.id, ch.name);
      }
    }

    const byCategory = new Map<string, typeof channels extends Map<string, infer V> ? V[] : never[]>();
    for (const ch of channels.values()) {
      if (!ch) continue;
      if (ch.type === ChannelType.GuildCategory) continue;
      const parentId = "parentId" in ch ? (ch.parentId ?? "(no category)") : "(no category)";
      const list = byCategory.get(parentId) ?? [];
      list.push(ch as never);
      byCategory.set(parentId, list);
    }

    for (const [parentId, items] of byCategory) {
      const catName = parentId === "(no category)" ? "(no category)" : (categories.get(parentId) ?? `(unknown ${parentId})`);
      console.log(`  ▸ ${catName}`);
      for (const ch of items) {
        const kind = KIND[ch.type] ?? `type=${ch.type}`;
        console.log(`      ${ch.id}  [${kind.padEnd(14)}]  #${ch.name}`);
      }
    }
    console.log();
  }

  await c.destroy();
  process.exit(0);
});

client.on("error", (e) => {
  console.error("Discord error:", e);
  process.exit(1);
});

client.login(config.discordToken).catch((e) => {
  console.error("Login failed:", e);
  process.exit(1);
});
