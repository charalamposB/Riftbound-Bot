
import type { Client, TextChannel, Interaction } from 'discord.js'
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from 'discord.js'
import fs from 'fs'
import path from 'path'

let _tiktokWired = false;

export function registerTikTokInteractions(client: Client) {
  if (_tiktokWired) return;   // <-- αποφυγή διπλής εγγραφής
  _tiktokWired = true;

  client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return
    if (interaction.commandName !== 'tiktok') return
    await handleTikTokSlash(interaction as ChatInputCommandInteraction, client)
  })
}

type TikTokState = { lastId: string | null }
const STATE_PATH = path.resolve('./data/tiktok_state.json')
const DEBUG_PATH = path.resolve('./tiktok_debug_item_list_webfull_json.txt')

const env = (name: string, optional = false): string => {
  const v = process.env[name]
  if (!v && !optional) throw new Error(`Missing env var: ${name}`)
  return v ?? ''
}

function loadState(): TikTokState {
  try {
    if (!fs.existsSync(STATE_PATH)) return { lastId: null }
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return { lastId: null }
  }
}
function saveState(s: TikTokState) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2))
  } catch {}
}

/**
 * Διαβάζει το τελευταίο video από το debug dump.
 * Το δικό σου schema έχει `itemList` στην ρίζα.
 */
function readLatestFromDebugFile(verbose = false): { id: string; desc?: string } | null {
  try {
    if (!fs.existsSync(DEBUG_PATH)) {
      if (verbose) console.log('[TikTok] Debug file not found at', DEBUG_PATH)
      return null
    }
    if (verbose) console.log('[TikTok] Using debug file:', DEBUG_PATH)

    const raw = fs.readFileSync(DEBUG_PATH, 'utf8')
    const data = JSON.parse(raw)

    const list: any[] = Array.isArray(data?.itemList) ? data.itemList : []
    if (verbose) console.log('[TikTok] itemList length:', list.length)
    if (!list.length) return null

    const first: any = list[0]
    const id = first?.id
    const desc = first?.desc

    if (!id) {
      if (verbose) console.log('[TikTok] No id field in first item keys:', Object.keys(first || {}))
      return null
    }
    return { id: String(id), desc: desc ? String(desc) : undefined }
  } catch (e) {
    console.error('[TikTok] Failed to parse debug file:', e)
    return null
  }
}

async function postLog(client: Client, videoId: string, desc?: string) {
  const username = env('TIKTOK_USERNAME')
  const channelId = env('TIKTOK_CHANNEL_ID')
  const pingEveryone = (env('TIKTOK_PING_EVERYONE', true) || '').toLowerCase() === 'true'

  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel || !channel.isTextBased()) return

  const url = `https://www.tiktok.com/@${username}/video/${videoId}`
  const text =
    `${pingEveryone ? '@everyone ' : ''}🎵 **Νέο TikTok ανέβηκε!**\n` +
    `• Creator: @${username}\n` +
    (desc ? `• Περιγραφή: ${desc}\n` : '') +
    `👉 ${url}`

  await (channel as TextChannel).send({ content: text })
}

/* ====================== Public API ====================== */

/** Background watcher (προαιρετικό) */
export function startTikTokWatcher(client: Client, intervalMs = 5 * 60 * 1000) {
  const runOnce = async () => {
    const latest = readLatestFromDebugFile()
    if (!latest) return
    const state = loadState()
    if (state.lastId === latest.id) return
    await postLog(client, latest.id, latest.desc)
    saveState({ lastId: latest.id })
  }
  runOnce().catch(() => {})
  setInterval(() => runOnce().catch(() => {}), intervalMs)
}

/** Slash commands για register */
export function getTikTokCommands() {
  return [
    new SlashCommandBuilder()
      .setName('tiktok')
      .setDescription('TikTok tools')
      .addSubcommand(sc =>
        sc.setName('status').setDescription('Δείξε ποιο video έχει δημοσιευτεί τελευταία'),
      )
      .addSubcommand(sc =>
        sc.setName('check').setDescription('Διάβασε το debug file και αν υπάρχει νέο video, κάνε post'),
      )
      .addSubcommand(sc =>
        sc.setName('post')
          .setDescription('Αναγκαστικό post (με id ή το πιο πρόσφατο από το debug file)')
          .addStringOption(o =>
            o.setName('id').setDescription('TikTok video id (optional)'),
          ),
      )
      .addSubcommand(sc =>
        sc.setName('show').setDescription('Δείξε id/desc από το debug file'),
      ),
  ]
}

/** Handler για /tiktok */
async function handleTikTokSlash(i: ChatInputCommandInteraction, client: Client) {
  const sub = i.options.getSubcommand()

  if (sub === 'status') {
    const state = loadState()
    await i.reply({
      content: state.lastId
        ? `📼 Τελευταίο posted video id: \`${state.lastId}\``
        : '📼 Δεν έχει καταγραφεί posted video ακόμα.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  if (sub === 'check') {
    await i.deferReply({ flags: MessageFlags.Ephemeral })
    const latest = readLatestFromDebugFile()
    if (!latest) {
      await i.editReply('⚠️ Δεν βρέθηκε/δεν διαβάστηκε το debug file.')
      return
    }
    const state = loadState()
    if (state.lastId === latest.id) {
      await i.editReply('ℹ️ Δεν υπάρχει νέο video στο debug file.')
      return
    }
    await postLog(client, latest.id, latest.desc)
    saveState({ lastId: latest.id })
    await i.editReply(`✅ Έγινε post το νέο video: \`${latest.id}\``)
    return
  }

  if (sub === 'post') {
    await i.deferReply({ flags: MessageFlags.Ephemeral })
    const customId = i.options.getString('id')?.trim()
    if (customId) {
      await postLog(client, customId)
      saveState({ lastId: customId })
      await i.editReply(`✅ Έγινε post με id: \`${customId}\``)
      return
    }
    const latest = readLatestFromDebugFile()
    if (!latest) {
      await i.editReply('⚠️ Δεν βρέθηκε/δεν διαβάστηκε το debug file.')
      return
    }
    await postLog(client, latest.id, latest.desc)
    saveState({ lastId: latest.id })
    await i.editReply(`✅ Έγινε post (latest από debug): \`${latest.id}\``)
    return
  }

  if (sub === 'show') {
    const latest = readLatestFromDebugFile(true)
    if (!latest) {
      await i.reply({
        content: '⚠️ Δεν μπόρεσα να διαβάσω/βρω item στο debug file.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    await i.reply({
      content:
        `📄 Path: ${DEBUG_PATH}\n` +
        `🆔 id: \`${latest.id}\`\n` +
        (latest.desc ? `📝 desc: ${latest.desc.substring(0, 180)}…` : '📝 desc: (none)'),
      flags: MessageFlags.Ephemeral,
    })
    return
  }
}

/** Σύνδεση στο client για να δουλέψουν τα /tiktok subcommands */
// export function registerTikTokInteractions(client: Client) {
//   client.on('interactionCreate', async (interaction: Interaction) => {
//     if (!interaction.isChatInputCommand()) return
//     if (interaction.commandName !== 'tiktok') return
//     await handleTikTokSlash(interaction as ChatInputCommandInteraction, client)
//   })
