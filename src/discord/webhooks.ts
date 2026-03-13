import type { EmbedBuilder, TextChannel, Webhook, WebhookMessageCreateOptions } from "discord.js";

const webhookCache = new Map<string, Webhook>();

function cacheKey(channelId: string, name: string): string {
  return `${channelId}:${name}`;
}

export async function getOrCreateWebhook(
  channel: TextChannel,
  name: string,
  avatarUrl?: string,
): Promise<Webhook> {
  const key = cacheKey(channel.id, name);
  const cached = webhookCache.get(key);
  if (cached) return cached;

  // Check for existing webhook with this name
  const existing = await channel.fetchWebhooks();
  let webhook = existing.find((w) => w.name === name && w.owner?.id === channel.client.user?.id);

  if (!webhook) {
    webhook = await channel.createWebhook({
      name,
      avatar: avatarUrl,
      reason: `DnDnAi identity for ${name}`,
    });
  }

  webhookCache.set(key, webhook);
  return webhook;
}

export async function sendAsIdentity(
  channel: TextChannel,
  name: string,
  content: string,
  options?: {
    avatarUrl?: string;
    embeds?: EmbedBuilder[];
  },
): Promise<void> {
  const send = async (webhook: Webhook) => {
    const msgOptions: WebhookMessageCreateOptions = {
      username: name,
      ...(options?.avatarUrl && { avatarURL: options.avatarUrl }),
    };

    // Split long messages (Discord 2000 char limit)
    if (content.length > 1900 && !options?.embeds) {
      const chunks = splitMessage(content, 1900);
      for (const chunk of chunks) {
        await webhook.send({ ...msgOptions, content: chunk });
      }
    } else {
      if (content) msgOptions.content = content;
      if (options?.embeds) msgOptions.embeds = options.embeds;
      await webhook.send(msgOptions);
    }
  };

  const webhook = await getOrCreateWebhook(channel, name, options?.avatarUrl);

  try {
    await send(webhook);
  } catch (err: unknown) {
    // Stale webhook (deleted externally) — clear cache and retry once
    const code = (err as { code?: number }).code;
    if (code === 10015) {
      webhookCache.delete(cacheKey(channel.id, name));
      const fresh = await getOrCreateWebhook(channel, name, options?.avatarUrl);
      await send(fresh);
    } else {
      throw err;
    }
  }
}

export function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen / 2) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

export function clearWebhookCache(): void {
  webhookCache.clear();
}
