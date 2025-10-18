// src/index.ts
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';

// Load env
dotenv.config();

// Import marketplace
import { getMarketCommands, registerMarketInteractions } from './marketplace/market';
import { getMarketPanelCommand, registerMarketPanelInteractions } from './marketplace/marketPanel';

// Import other modules (if any)
// import { getTikTokCommands, registerTikTokInteractions } from './socials/tiktok';

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional για guild-only commands

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Missing TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ✅ Register all commands
const commands = [
  ...getMarketCommands(),
  ...getMarketPanelCommand(),
  // ...getTikTokCommands(), // αν έχεις
];

// ✅ Register slash commands
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN!);

  try {
    console.log('🔄 Registering slash commands...');

    if (GUILD_ID) {
      // Guild-specific (faster for dev)
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID!, GUILD_ID), {
        body: commands.map(c => c.toJSON()),
      });
      console.log(`✅ Commands registered for guild ${GUILD_ID}`);
    } else {
      // Global (takes ~1h to propagate)
      await rest.put(Routes.applicationCommands(CLIENT_ID!), {
        body: commands.map(c => c.toJSON()),
      });
      console.log('✅ Commands registered globally');
    }
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
}

// ✅ Bot ready
client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user?.tag}`);
  await registerCommands();
});

// ✅ Register all interaction handlers
registerMarketInteractions(client);
registerMarketPanelInteractions(client);
// registerTikTokInteractions(client); // αν έχεις

// ✅ Login
client.login(TOKEN).catch((err) => {
  console.error('❌ Failed to login:', err);
  process.exit(1);
});