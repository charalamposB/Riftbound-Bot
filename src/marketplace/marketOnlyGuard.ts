// src/marketplace/marketOnlyGuard.ts
import { Client, Message, ChannelType } from "discord.js";

// ids των marketplace καναλιών (ή parent category)
const MARKET_CATEGORY_ID = process.env.MARKET_CATEGORY_ID!;
const ALLOWED_USER_IDS = process.env.MARKET_ALLOWED_USER_IDS?.split(",") || []; // optional (mods/bots)

export function registerMarketOnlyGuard(client: Client) {
  client.on("messageCreate", async (msg: Message) => {
    try {
      // αγνοούμε bots, threads, DMs
      if (msg.author.bot || msg.channel.type !== ChannelType.GuildText) return;

      const parent = msg.channel.parent;
      if (!parent || parent.id !== MARKET_CATEGORY_ID) return; // εκτός marketplace

      // εξαιρούμε mod/bot IDs αν χρειάζεται
      if (ALLOWED_USER_IDS.includes(msg.author.id)) return;

      // επιτρέπουμε μόνο /commands
      if (!msg.content.startsWith("/")) {
        await msg.delete().catch(() => {});
      }
    } catch (e) {
      console.error("[marketOnlyGuard] Error:", e);
    }
  });
}