import {
  getTikTokCommands,
  registerTikTokInteractions,
  startTikTokWatcher,
} from './socials/tiktok'
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Events,
  MessageFlags,
} from 'discord.js'
import {
  getMarketCommands,
  registerMarketInteractions, // θα χειριστεί ΟΛΑ τα market interactions
} from './marketplace/market'

import { init as initPending } from './lib/pendingStore'
import { startPendingCleanup } from './workers/pendingCleanup' // αν βάλεις το optional worker
import { requireEnv } from './lib/helpers'

import * as dotenv from "dotenv";
import { debugPendingInfo } from './lib/pendingStore'

// Ανάλογα με το NODE_ENV φορτώνει το σωστό env file
const envFile = process.env.NODE_ENV === "production" ? ".env.prod" : ".env.dev";
dotenv.config({ path: envFile });

console.log("Running with:", envFile);
// -------- load env (typed) --------
const token = requireEnv('TOKEN')        // Bot token
const clientId = requireEnv('CLIENT_ID') // Application (Client) ID
const guildId = process.env.GUILD_ID?.trim() // optional for fast guild registration

// -------- local commands (ping) --------
const ping = new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!')

// -------- collect all commands --------
const commands = [ping, ...getMarketCommands(), ...getTikTokCommands()]
const commandBodies = commands.map((c) => c.toJSON())

// -------- register commands --------
async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(token)
  const route =
    guildId && guildId !== ''
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId)

  await rest.put(route, { body: commandBodies })
  console.log(`✅ Registered ${commandBodies.length} command(s) ${guildId ? '(guild)' : '(global)'}`)
}

// -------- start bot --------
async function main(): Promise<void> {
  await initPending()
  console.log('[pendingStore]', debugPendingInfo())
  startPendingCleanup() // optional

  await registerCommands()

  const client = new Client({ intents: [GatewayIntentBits.Guilds] })
  registerTikTokInteractions(client)

  client.once(Events.ClientReady, () => {
    console.log(`🤖 Logged in as ${client.user?.tag}`)

  // Ξεκίνα TikTok logs
    try {
    startTikTokWatcher(client)
    console.log('🎵 TikTok watcher started')
  } catch (e) {
    console.error('TikTok watcher failed to start:', e)
  }
  })

  // ΜΟΝΟ το /ping εδώ.
  // ΟΛΑ τα market interactions (slash/modals/buttons) πάνε μέσω registerMarketInteractions.
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return
    if (interaction.commandName === 'ping') {
      const i = interaction as ChatInputCommandInteraction
      await i.reply({ content: 'Pong!', flags: MessageFlags.Ephemeral }) // no deprecation warning
      return
    }
  })

  // κουμπώνουμε ΟΛΑ τα market interactions (slash + buttons + modals)
  registerMarketInteractions(client)

  await client.login(token)
}

main().catch((err) => {
  console.error('❌ Fatal error starting bot:', err)
  process.exit(1)
})
