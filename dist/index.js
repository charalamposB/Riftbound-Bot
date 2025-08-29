"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const tiktok_1 = require("./socials/tiktok");
const discord_js_1 = require("discord.js");
const market_1 = require("./marketplace/market");
const helpers_1 = require("./lib/helpers");
const dotenv = __importStar(require("dotenv"));
// Ανάλογα με το NODE_ENV φορτώνει το σωστό env file
const envFile = process.env.NODE_ENV === "production" ? ".env.prod" : ".env.dev";
dotenv.config({ path: envFile });
console.log("Running with:", envFile);
// -------- load env (typed) --------
const token = (0, helpers_1.requireEnv)('TOKEN'); // Bot token
const clientId = (0, helpers_1.requireEnv)('CLIENT_ID'); // Application (Client) ID
const guildId = process.env.GUILD_ID?.trim(); // optional for fast guild registration
// -------- local commands (ping) --------
const ping = new discord_js_1.SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!');
// -------- collect all commands --------
const commands = [ping, ...(0, market_1.getMarketCommands)(), ...(0, tiktok_1.getTikTokCommands)()];
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
    (0, tiktok_1.registerTikTokInteractions)(client);
    client.once(discord_js_1.Events.ClientReady, () => {
        console.log(`🤖 Logged in as ${client.user?.tag}`);
        // Ξεκίνα TikTok logs
        try {
            (0, tiktok_1.startTikTokWatcher)(client);
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
    (0, market_1.registerMarketInteractions)(client);
    await client.login(token);
}
main().catch((err) => {
    console.error('❌ Fatal error starting bot:', err);
    process.exit(1);
});
