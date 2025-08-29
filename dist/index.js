"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const tiktok_js_1 = require("./socials/tiktok.js");
const discord_js_1 = require("discord.js");
const market_js_1 = require("./marketplace/market.js");
// -------- env helpers --------
const requireEnv = (name) => {
    const v = process.env[name];
    if (!v || !v.trim())
        throw new Error(`Missing required env var: ${name}`);
    return v.trim();
};
// -------- load env (typed) --------
const token = requireEnv('TOKEN'); // Bot token
const clientId = requireEnv('CLIENT_ID'); // Application (Client) ID
const guildId = process.env.GUILD_ID?.trim(); // optional for fast guild registration
// -------- local commands (ping) --------
const ping = new discord_js_1.SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!');
// -------- collect all commands --------
const commands = [ping, ...(0, market_js_1.getMarketCommands)(), ...(0, tiktok_js_1.getTikTokCommands)()];
const commandBodies = commands.map((c) => c.toJSON());
// -------- register commands --------
async function registerCommands() {
    const rest = new discord_js_1.REST({ version: '10' }).setToken(token);
    const route = guildId && guildId !== ''
        ? discord_js_1.Routes.applicationGuildCommands(clientId, guildId)
        : discord_js_1.Routes.applicationCommands(clientId);
    await rest.put(route, { body: commandBodies });
    console.log(`✅ Registered ${commandBodies.length} command(s) ${guildId ? '(guild)' : '(global)'}`);
}
// -------- start bot --------
async function main() {
    await registerCommands();
    const client = new discord_js_1.Client({ intents: [discord_js_1.GatewayIntentBits.Guilds] });
    (0, tiktok_js_1.registerTikTokInteractions)(client);
    client.once(discord_js_1.Events.ClientReady, () => {
        console.log(`🤖 Logged in as ${client.user?.tag}`);
        // Ξεκίνα TikTok logs
        try {
            (0, tiktok_js_1.startTikTokWatcher)(client);
            console.log('🎵 TikTok watcher started');
        }
        catch (e) {
            console.error('TikTok watcher failed to start:', e);
        }
    });
    // ΜΟΝΟ το /ping εδώ.
    // ΟΛΑ τα market interactions (slash/modals/buttons) πάνε μέσω registerMarketInteractions.
    client.on(discord_js_1.Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand())
            return;
        if (interaction.commandName === 'ping') {
            const i = interaction;
            await i.reply({ content: 'Pong!', flags: discord_js_1.MessageFlags.Ephemeral }); // no deprecation warning
            return;
        }
    });
    // κουμπώνουμε ΟΛΑ τα market interactions (slash + buttons + modals)
    (0, market_js_1.registerMarketInteractions)(client);
    await client.login(token);
}
main().catch((err) => {
    console.error('❌ Fatal error starting bot:', err);
    process.exit(1);
});
