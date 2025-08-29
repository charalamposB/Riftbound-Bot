"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTikTokWatcher = startTikTokWatcher;
exports.getTikTokCommands = getTikTokCommands;
exports.registerTikTokInteractions = registerTikTokInteractions;
const discord_js_1 = require("discord.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const STATE_PATH = path_1.default.resolve('./tiktok_state.json');
const DEBUG_PATH = path_1.default.resolve('./tiktok_debug_item_list_webfull_json.txt');
const DEFAULT_DEBUG_NAME = 'tiktok_debug_item_list_webfull_json.txt';
const env = (name, optional = false) => {
    const v = process.env[name];
    if (!v && !optional)
        throw new Error(`Missing env var: ${name}`);
    return v ?? '';
};
function loadState() {
    try {
        if (!fs_1.default.existsSync(STATE_PATH))
            return { lastId: null };
        return JSON.parse(fs_1.default.readFileSync(STATE_PATH, 'utf8'));
    }
    catch {
        return { lastId: null };
    }
}
function saveState(s) {
    try {
        fs_1.default.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
    }
    catch { }
}
/** Διαβάζει το τελευταίο video από το debug dump (τοπικό αρχείο). */
function readLatestFromDebugFile(verbose = false) {
    try {
        const { chosen, candidates } = getDebugPath();
        if (!chosen) {
            if (verbose)
                console.log('[TikTok] Debug file not found. Tried:', candidates);
            return null;
        }
        if (verbose)
            console.log('[TikTok] Using debug file:', chosen);
        const raw = fs_1.default.readFileSync(chosen, 'utf8');
        const data = JSON.parse(raw);
        const list = data?.ItemList?.items ||
            (data?.ItemModule && Object.values(data.ItemModule)) ||
            data?.aweme_list ||
            [];
        const first = Array.isArray(list) && list.length > 0 ? list[0] : null;
        if (!first)
            return null;
        const id = first.id || first.aweme_id || first.awemeId;
        const desc = first.desc || first.title || first.share_info?.share_title;
        if (!id)
            return null;
        return { id: String(id), desc: desc ? String(desc) : undefined };
    }
    catch (e) {
        console.error('[TikTok] Failed to parse debug file:', e);
        return null;
    }
}
function getDebugPath() {
    const fromEnv = process.env.TIKTOK_DEBUG_PATH?.trim();
    const candidates = [
        fromEnv || '', // 1) .env override
        path_1.default.resolve(DEFAULT_DEBUG_NAME), // 2) ./<name>  (root)
        path_1.default.resolve('./data', DEFAULT_DEBUG_NAME), // 3) ./data/<name>
        path_1.default.join(process.cwd(), DEFAULT_DEBUG_NAME), // 4) cwd/<name>
        path_1.default.join(process.cwd(), 'data', DEFAULT_DEBUG_NAME),
        // όταν τρέχεις compiled (dist/)
        path_1.default.join(__dirname, '../../', DEFAULT_DEBUG_NAME),
        path_1.default.join(__dirname, '../../../', DEFAULT_DEBUG_NAME),
        path_1.default.join(__dirname, '../../data', DEFAULT_DEBUG_NAME),
    ].filter(Boolean);
    const chosen = candidates.find(p => fs_1.default.existsSync(p)) || null;
    return { chosen, candidates };
}
async function postLog(client, videoId, desc) {
    const username = env('TIKTOK_USERNAME');
    const channelId = env('TIKTOK_CHANNEL_ID');
    const pingEveryone = (env('TIKTOK_PING_EVERYONE', true) || '').toLowerCase() === 'true';
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased())
        return;
    const url = `https://www.tiktok.com/@${username}/video/${videoId}`;
    const text = `${pingEveryone ? '@everyone ' : ''}🎵 **Νέο TikTok ανέβηκε!**\n` +
        `• Creator: @${username}\n` +
        (desc ? `• Περιγραφή: ${desc}\n` : '') +
        `👉 ${url}`;
    await channel.send({ content: text });
}
/* ====================== Public API ====================== */
/** Background watcher (προαιρετικό) */
function startTikTokWatcher(client, intervalMs = 5 * 60 * 1000) {
    const runOnce = async () => {
        const latest = readLatestFromDebugFile();
        if (!latest)
            return;
        const state = loadState();
        if (state.lastId === latest.id)
            return;
        await postLog(client, latest.id, latest.desc);
        saveState({ lastId: latest.id });
    };
    runOnce().catch(() => { });
    setInterval(() => runOnce().catch(() => { }), intervalMs);
}
/** Slash commands για register */
function getTikTokCommands() {
    return [
        new discord_js_1.SlashCommandBuilder()
            .setName('tiktok')
            .setDescription('TikTok tools')
            .addSubcommand(sc => sc.setName('status').setDescription('Δείξε ποιο video έχει δημοσιευτεί τελευταία'))
            .addSubcommand(sc => sc.setName('check').setDescription('Διάβασε το debug file και αν υπάρχει νέο video, κάνε post'))
            .addSubcommand(sc => sc.setName('debugpaths').setDescription('Δείξε paths που δοκιμάζει για το debug file'))
            .addSubcommand(sc => sc.setName('post')
            .setDescription('Αναγκαστικό post (με id ή το πιο πρόσφατο από το debug file)')
            .addStringOption(o => o.setName('id').setDescription('TikTok video id (optional)'))),
    ];
}
/** Handler για /tiktok */
async function handleTikTokSlash(i, client) {
    const sub = i.options.getSubcommand();
    if (sub === 'status') {
        const state = loadState();
        await i.reply({
            content: state.lastId
                ? `📼 Τελευταίο posted video id: \`${state.lastId}\``
                : '📼 Δεν έχει καταγραφεί posted video ακόμα.',
            flags: discord_js_1.MessageFlags.Ephemeral,
        });
        return;
    }
    if (sub === 'debugpaths') {
        const { chosen, candidates } = getDebugPath();
        const lines = candidates.map(p => `${fs_1.default.existsSync(p) ? '✅' : '❌'} ${p}`);
        await i.reply({
            content: (chosen ? `**Using:** ${chosen}\n` : '**No file found**\n') +
                lines.join('\n'),
            flags: discord_js_1.MessageFlags.Ephemeral,
        });
        return;
    }
    if (sub === 'check') {
        await i.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        const latest = readLatestFromDebugFile();
        if (!latest) {
            await i.editReply('⚠️ Δεν βρέθηκε/δεν διαβάστηκε το debug file.');
            return;
        }
        const state = loadState();
        if (state.lastId === latest.id) {
            await i.editReply('ℹ️ Δεν υπάρχει νέο video στο debug file.');
            return;
        }
        await postLog(client, latest.id, latest.desc);
        saveState({ lastId: latest.id });
        await i.editReply(`✅ Έγινε post το νέο video: \`${latest.id}\``);
        return;
    }
    if (sub === 'post') {
        await i.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
        const customId = i.options.getString('id')?.trim();
        if (customId) {
            await postLog(client, customId);
            saveState({ lastId: customId });
            await i.editReply(`✅ Έγινε post με id: \`${customId}\``);
            return;
        }
        const latest = readLatestFromDebugFile();
        if (!latest) {
            await i.editReply('⚠️ Δεν βρέθηκε/δεν διαβάστηκε το debug file.');
            return;
        }
        await postLog(client, latest.id, latest.desc);
        saveState({ lastId: latest.id });
        await i.editReply(`✅ Έγινε post (latest από debug): \`${latest.id}\``);
        return;
    }
}
/** Σύνδεση στο client για να δουλέψουν τα /tiktok subcommands */
function registerTikTokInteractions(client) {
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand())
            return;
        if (interaction.commandName !== 'tiktok')
            return;
        await handleTikTokSlash(interaction, client);
    });
}
