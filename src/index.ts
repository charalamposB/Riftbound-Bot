import * as dotenv from 'dotenv';

// Φόρτωση σωστού env file πριν τη χρήση μεταβλητών
const envFile = process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev';
dotenv.config({ path: envFile });
console.log('Running with:', envFile);

import {
  getTikTokCommands,
  registerTikTokInteractions,
  startTikTokWatcher,
} from './socials/tiktok';

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Events,
  MessageFlags,
} from 'discord.js';

import {
  getMarketCommands,
  registerMarketInteractions,
} from './marketplace/market';

import { init as initPending } from './lib/pendingStore';
import { startPendingCleanup } from './workers/pendingCleanup';
import { requireEnv } from './lib/helpers';
import { debugPendingInfo } from './lib/pendingStore';

// -------- load env (typed) --------
const token = requireEnv('TOKEN');        // Bot token
const clientId = requireEnv('CLIENT_ID'); // Application (Client) ID
const guildId = process.env.GUILD_ID?.trim(); // optional for fast guild registration

// -------- local commands (ping) --------
const ping = new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!');

// -------- collect all commands (ONLY builders here) --------
const commandDefs = [
  ping,
  ...getMarketCommands(),
  ...getTikTokCommands(),
].filter(Boolean) as SlashCommandBuilder[];

const commandBodies = commandDefs.map((c) => c.toJSON());

// -------- register commands --------
async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(token);
  const route =
    guildId && guildId !== ''
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);

  await rest.put(route, { body: commandBodies });
  console.log(`✅ Registered ${commandBodies.length} command(s) ${guildId ? '(guild)' : '(global)'}`);
}

// -------- start bot --------
async function main(): Promise<void> {
  await initPending();
  console.log('[pendingStore]', debugPendingInfo());
  startPendingCleanup(); // optional

  await registerCommands();

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  // ΜΟΝΟ /ping εδώ. Όλα τα market/tiktok interactions τα κάνουν
  // register τα αντίστοιχα modules με δικούς τους listeners.
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'ping') {
      const i = interaction as ChatInputCommandInteraction;
      await i.reply({ content: 'Pong!', flags: MessageFlags.Ephemeral });
    }
  });

  registerTikTokInteractions(client);
  registerMarketInteractions(client);

  client.once(Events.ClientReady, () => {
    console.log(`🤖 Logged in as ${client.user?.tag}`);

    // Ξεκίνα TikTok logs
    try {
      startTikTokWatcher(client);
      console.log('🎵 TikTok watcher started');
    } catch (e) {
      console.error('TikTok watcher failed to start:', e);
    }
  });

  await client.login(token);
}

main().catch((err) => {
  console.error('❌ Fatal error starting bot:', err);
  process.exit(1);
});