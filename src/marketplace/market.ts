import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  Client,
  Interaction,
  GuildMember,
} from 'discord.js'
import fs from 'fs'
import path from 'path'
import {
  getSlash, setSlash, deleteSlash,
  getApproval, setApproval, deleteApproval,
  PendingSlash, PendingApproval,
} from '../lib/pendingStore'

/* =========================================================
   Types
========================================================= */
type Kind = 'sell' | 'buy'

/* =========================================================
   Labels
========================================================= */
const LABELS: Record<Kind, { title: string; color: number }> = {
  sell: { title: 'Πώληση / Sell', color: 0x2ecc71 },
  buy : { title: 'Αγορά / Buy',   color: 0x3498db },
}

/* =========================================================
   ENV accessor
========================================================= */
function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

/* =========================================================
   Id helper
========================================================= */
function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/* =========================================================
   Disable controls helper (μην τροποποιείς readonly .components)
========================================================= */
async function disableControls(message: any) {
  try {
    const newRows = (message.components || []).map((r: any) => {
      const row = new ActionRowBuilder<ButtonBuilder>()
      const comps = (r.components || []).map((c: any) => ButtonBuilder.from(c).setDisabled(true))
      row.addComponents(...comps)
      return row
    })
    await message.edit({ components: newRows })
  } catch (e) {
    console.error('disableControls error:', e)
  }
}

/* =========================================================
   Export commands
========================================================= */
export function getMarketCommands() {
  return [
    new SlashCommandBuilder()
      .setName('market')
      .setDescription('Marketplace tools')
      .addSubcommand((sc) =>
        sc
          .setName('post')
          .setDescription('Create a buy/sell post (goes to CASE thread for approval)')
          .addStringOption((o) =>
            o
              .setName('type')
              .setDescription('Type of post')
              .setRequired(true)
              .addChoices(
                { name: 'Πώληση / Sell', value: 'sell' },
                { name: 'Αγορά / Buy',   value: 'buy'  },
              ),
          )
          .addAttachmentOption((o) =>
            o.setName('photo1').setDescription('1η φωτογραφία').setRequired(true),
          )
          .addAttachmentOption((o) =>
            o.setName('photo2').setDescription('2η φωτογραφία (optional)').setRequired(false),
          ),
      ),
  ]
}

/* =========================================================
   Paths / JSON helpers (approved/deals/rep)
========================================================= */
const DATA_DIR = path.resolve('./data')
const FILES = {
  approved: path.join(DATA_DIR, 'approvedPosts.json'),
  deals   : path.join(DATA_DIR, 'deals.json'),
  rep     : path.join(DATA_DIR, 'reputation.json'),
}

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(FILES.approved)) fs.writeFileSync(FILES.approved, '[]')
  if (!fs.existsSync(FILES.deals)) fs.writeFileSync(FILES.deals, '{}')
  if (!fs.existsSync(FILES.rep)) fs.writeFileSync(FILES.rep, '{}')
}

function readJSON<T = any>(file: string): T {
  try {
    ensureFiles()
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return (file === FILES.approved ? [] : {}) as T
  }
}
function writeJSON(file: string, data: unknown) {
  try {
    ensureFiles()
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
  } catch (e) {
    console.error('writeJSON error', file, e)
  }
}

function saveApprovedPost(post: any) {
  const arr = readJSON<any[]>(FILES.approved)
  arr.push(post)
  writeJSON(FILES.approved, arr)
}
function getDeal(pid: string) {
  const m = readJSON<Record<string, any>>(FILES.deals)
  return m[pid] || null
}
function upsertDeal(pid: string, dealObj: Record<string, any>) {
  const m = readJSON<Record<string, any>>(FILES.deals)
  m[pid] = { ...(m[pid] || {}), ...dealObj }
  writeJSON(FILES.deals, m)
}
function addReputation(userId: string, role: 'seller' | 'buyer') {
  const rep = readJSON<Record<string, any>>(FILES.rep)
  const cur = rep[userId] || { total: 0, asSeller: 0, asBuyer: 0 }
  cur.total += 1
  if (role === 'seller') cur.asSeller += 1
  else cur.asBuyer += 1
  rep[userId] = cur
  writeJSON(FILES.rep, rep)
}

/* =========================================================
   Helpers
========================================================= */
function isMemberMod(member: GuildMember | null): boolean {
  if (!member) return false
  const modRoleId = process.env.MOD_ROLE_ID
  const hasRole = modRoleId ? member.roles.cache.has(modRoleId) : false
  const hasPerm =
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.permissions.has(PermissionFlagsBits.ManageThreads)
  return hasRole || hasPerm
}

/* =========================================================
   Handler
========================================================= */
export async function handleMarketCommand(interaction: Interaction) {
  if (!interaction.guild) return

  // ----- Slash: /market post -----
  if (interaction.isChatInputCommand() && interaction.commandName === 'market') {
    const sub = interaction.options.getSubcommand()
    if (sub !== 'post') return

    const member = await interaction.guild.members.fetch(interaction.user.id)
    const canPost = true
    if (!canPost) {
      return interaction.reply({
        content: '⛔ Δεν έχεις δικαίωμα για /market post.',
        flags: MessageFlags.Ephemeral,
      })
    }

    try {
      const kind = interaction.options.getString('type', true) as Kind
      const photo1 = interaction.options.getAttachment('photo1')
      const photo2 = interaction.options.getAttachment('photo2') || null

      // persist προσωρινά
      const slashPayload: PendingSlash = {
        userId: interaction.user.id,
        kind,
        photo1: photo1 as any,
        photo2: (photo2 as any) || null,
        createdAt: Date.now(),
      }
      await setSlash(slashPayload)

      const modal = new ModalBuilder().setCustomId('marketPost').setTitle('Δημιουργία Αγγελίας')

      const card = new TextInputBuilder()
        .setCustomId('cardName')
        .setLabel('Όνομα Κάρτας')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)

      const location = new TextInputBuilder()
        .setCustomId('location')
        .setLabel('Περιοχή / Παράδοση')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)

      const quantity = new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel('Ποσότητα')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)

      const price = new TextInputBuilder()
        .setCustomId('price')
        .setLabel('Τιμή (SELL) ή Budget (BUY)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)

      const extra = new TextInputBuilder()
        .setCustomId('extra')
        .setLabel('Extra πληροφορίες')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(card),
        new ActionRowBuilder<TextInputBuilder>().addComponents(location),
        new ActionRowBuilder<TextInputBuilder>().addComponents(quantity),
        new ActionRowBuilder<TextInputBuilder>().addComponents(price),
        new ActionRowBuilder<TextInputBuilder>().addComponents(extra),
      )

      return interaction.showModal(modal)
    } catch (e) {
      console.error('slash market post error', e)
      return interaction.reply({
        content: '❌ Κάτι πήγε στραβά.',
        flags: MessageFlags.Ephemeral,
      })
    }
  }

  // ----- Modal submit: collect details & create CASE -----
  if (interaction.isModalSubmit() && interaction.customId === 'marketPost') {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })

      const s = getSlash(interaction.user.id)
      await deleteSlash(interaction.user.id)
      if (!s)
        return interaction.editReply('❌ Δεν βρέθηκαν τα αρχικά στοιχεία. Ξαναδοκίμασε το `/market post`.')

      const { kind, photo1, photo2 } = s

      const cardName = interaction.fields.getTextInputValue('cardName')?.trim()
      const location = interaction.fields.getTextInputValue('location')?.trim()
      const quantityRaw = interaction.fields.getTextInputValue('quantity')?.trim()
      const priceRaw = interaction.fields.getTextInputValue('price')?.trim()
      const extra = interaction.fields.getTextInputValue('extra')?.trim() || '-'

      const isSell = kind === 'sell'
      const quantity = Math.max(1, Number(quantityRaw || '1'))
      const price = priceRaw ? Number(priceRaw.replace(',', '.')) : null
      if (isSell && (!Number.isFinite(price) || (price as number) <= 0)) {
        return interaction.editReply('⚠️ Για SELL απαιτείται τιμή (>0).')
      }

      const { title, color } = LABELS[kind]

      const preview = new EmbedBuilder()
        .setTitle(`[PREVIEW] ${title} — ${cardName}`)
        .addFields(
          { name: 'Ποσότητα', value: quantity.toString(), inline: true },
          { name: isSell ? 'Τιμή' : 'Budget', value: (price ?? '-') + (price ? '€' : ''), inline: true },
          { name: 'Περιοχή / Παράδοση', value: location || '-', inline: true },
          { name: 'Extra', value: extra },
        )
        .setColor(color)
        .setFooter({ text: `Υποβλήθηκε από ${interaction.user.tag} • ${interaction.user.id}` })

      if (photo1) preview.setImage((photo1 as any).url)
      if (photo2) preview.addFields({ name: 'Επιπλέον φωτό', value: (photo2 as any).url })

      const LOG_ID = env('MARKET_LOG_CHANNEL_ID')
      const logChannel: any = interaction.guild?.channels.cache.get(LOG_ID)
      if (!logChannel) return interaction.editReply('⚠️ Δεν βρέθηκε MARKET_LOG_CHANNEL_ID στο .env.')

      const stub = await logChannel.send(
        `🧾 Case for **${cardName}** από <@${interaction.user.id}> (${kind.toUpperCase()})`,
      )
      const caseThread = await stub.startThread({
        name: `CASE • ${cardName} — ${interaction.user.username}`,
        autoArchiveDuration: 10080,
        type: ChannelType.PrivateThread,
      })

      const pid = newId()

      const reviewRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`approve:${pid}`).setLabel('Approve ✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject:${pid}`).setLabel('Reject ❌').setStyle(ButtonStyle.Danger),
      )
      const caseMsg = await caseThread.send({
        content: `📝 **Νέα αγγελία προς έγκριση** από <@${interaction.user.id}> (${kind.toUpperCase()})`,
        embeds: [preview],
        components: [reviewRow],
      })

      const modChannel: any = interaction.guild?.channels.cache.get(process.env.MOD_CHANNEL_ID!)
      modChannel?.send(`📝 Νέα αγγελία → ελέγξτε το CASE: ${caseThread.toString()}`)

      const approval: PendingApproval = {
        pid,
        guildId: interaction.guildId!,
        requesterId: interaction.user.id,
        kind,
        cardName,
        quantity,
        price,
        location,
        extra,
        photo1: photo1 as any,
        photo2: (photo2 as any) || null,
        caseThreadId: caseThread.id,
        caseMessageId: caseMsg.id,
        createdAt: Date.now(),
        contacts: [],
      }
      await setApproval(approval)

      return interaction.editReply(
        `✅ Δημιουργήθηκε CASE thread για έγκριση: ${caseThread.toString()} (PID: \`${pid}\`)`,
      )
    } catch (e) {
      console.error('modal marketPost error', e)
      return interaction.editReply('❌ Σφάλμα κατά τη δημιουργία του CASE.')
    }
  }

  // ----- Buttons -----
  if (interaction.isButton()) {
    const [action, pid] = interaction.customId.split(':')
    if (
      !['approve', 'reject', 'contact', 'close', 'complete', 'modresolve'].includes(action) ||
      !pid
    )
      return

    if (action !== 'modresolve') {
      try { await interaction.deferUpdate() } catch {}
    }

    const member = await interaction.guild!.members.fetch(interaction.user.id)
    const modPerm = isMemberMod(member)

    const payload = getApproval(pid)

    // -------- Approve --------
    if (action === 'approve') {
      if (!payload)
        return interaction.followUp({ content: '❌ Δεν βρέθηκαν στοιχεία αυτής της αίτησης.', flags: MessageFlags.Ephemeral })

      const { kind, cardName, quantity, price, location, extra, photo1, photo2, requesterId, caseThreadId, caseMessageId } =
        payload
      const isSell = kind === 'sell'
      const { title: typeLabel, color } = LABELS[kind]

      const priceText = Number.isFinite(price as number) ? `${price}€` : '-'
      const publicEmbed = new EmbedBuilder()
        .setTitle(`${typeLabel} — ${cardName}`)
        .addFields(
          { name: 'Ποσότητα', value: quantity.toString(), inline: true },
          { name: isSell ? 'Τιμή' : 'Budget', value: priceText, inline: true },
          { name: 'Περιοχή / Παράδοση', value: location || '-', inline: true },
          { name: 'Extra', value: extra || '-' },
        )
        .setColor(color)
        .setFooter({ text: `Από ${interaction.guild!.members.cache.get(requesterId)?.user?.tag || requesterId}` })
        .setTimestamp(new Date())

      if (photo1) publicEmbed.setImage((photo1 as any).url)
      if (photo2) publicEmbed.addFields({ name: 'Επιπλέον φωτό', value: (photo2 as any).url })

      const targetId = isSell ? process.env.SELL_CHANNEL_ID : process.env.BUY_CHANNEL_ID
      const targetChannel: any = interaction.guild!.channels.cache.get(targetId!)
      if (!targetId || !targetChannel) {
        console.error('Approve error: target channel missing', { kind, targetId })
        return interaction.followUp({ content: '⚠️ Δεν βρέθηκε το κανάλι στόχος (SELL/BUY).', flags: MessageFlags.Ephemeral })
      }

      const me = targetChannel.guild.members.me
      const need = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ]
      const missing = need.filter((p) => !targetChannel.permissionsFor(me)?.has(p))
      if (missing.length) {
        console.error('Approve missing perms:', missing)
        return interaction.followUp({ content: '⛔ Το bot δεν έχει δικαιώματα στο BUY/SELL (View/Send/Embed/Attach).', flags: MessageFlags.Ephemeral })
      }

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`contact:${pid}`).setLabel('Ενδιαφέρομαι 🙋').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`close:${pid}`).setLabel('Κλείσιμο Αγγελίας 🔒').setStyle(ButtonStyle.Secondary),
      )

      let postMsg: any
      try {
        postMsg = await targetChannel.send({ embeds: [publicEmbed], components: [row] })
      } catch (e) {
        console.error('Approve send error:', e)
        try {
          const caseThread: any = interaction.guild!.channels.cache.get(caseThreadId)
          const caseMsg: any = await caseThread?.messages.fetch(caseMessageId).catch(() => null)
          if (caseMsg) await disableControls(caseMsg)
          caseThread?.send(`❌ Αποτυχία δημοσίευσης στο <#${targetId}>.`)
        } catch {}
        return interaction.followUp({ content: '❌ Σφάλμα κατά τη δημοσίευση.', flags: MessageFlags.Ephemeral })
      }

      await setApproval({
        ...payload,
        postedMessageId: postMsg.id,
        postedChannelId: targetChannel.id,
        contacts: payload.contacts || [],
      })

      saveApprovedPost({
        pid,
        guildId: interaction.guildId,
        channelId: targetChannel.id,
        messageId: postMsg.id,
        requesterId,
        kind,
        cardName,
        quantity,
        price,
        location,
        extra,
        timestamp: new Date().toISOString(),
      })

      // Disable Approve/Reject στο CASE + προσθήκη Mod Resolve control
      try {
        const caseThread: any = interaction.guild!.channels.cache.get(caseThreadId)
        const caseMsg: any = await caseThread?.messages.fetch(caseMessageId).catch(() => null)
        if (caseMsg) {
          const newRows = (caseMsg.components || []).map((r: any) => {
            const row = new ActionRowBuilder<ButtonBuilder>()
            const comps = (r.components || []).map((c: any) => ButtonBuilder.from(c).setDisabled(true))
            row.addComponents(...comps)
            return row
          })
          await caseMsg.edit({ components: newRows })

          const modRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`modresolve:${pid}`).setLabel('Mod Resolve 🛡️').setStyle(ButtonStyle.Secondary),
          )
          await caseThread.send({ content: 'Controls (mods only):', components: [modRow] })
          await caseThread.send(`✅ Εγκρίθηκε από ${interaction.user}. Δημοσιεύτηκε στο <#${targetId}> (msg: ${postMsg.id}).`)
        }
      } catch {}

      return interaction.followUp({ content: `✅ Δημοσιεύτηκε στο <#${targetId}>.`, flags: MessageFlags.Ephemeral })
    }

    // -------- Reject --------
    if (action === 'reject') {
      if (!modPerm)
        return interaction.followUp({ content: '⛔ Μόνο mods.', flags: MessageFlags.Ephemeral })
      if (!payload)
        return interaction.followUp({ content: '❌ Δεν βρέθηκαν στοιχεία.', flags: MessageFlags.Ephemeral })

      const { caseThreadId, caseMessageId, cardName } = payload
      await deleteApproval(pid)

      try {
        const caseThread: any = interaction.guild!.channels.cache.get(caseThreadId)
        const caseMsg: any = await caseThread?.messages.fetch(caseMessageId).catch(() => null)
        if (caseMsg) {
          const newRows = (caseMsg.components || []).map((r: any) => {
            const row = new ActionRowBuilder<ButtonBuilder>()
            const comps = (r.components || []).map((c: any) => ButtonBuilder.from(c).setDisabled(true))
            row.addComponents(...comps)
            return row
          })
          await caseMsg.edit({ components: newRows })
          caseThread?.send(`❌ Απορρίφθηκε από ${interaction.user}. (PID: ${pid}, Card: **${cardName}**)`)
        }
      } catch {}

      return interaction.followUp({ content: '❌ Απορρίφθηκε η αγγελία.', flags: MessageFlags.Ephemeral })
    }

    // -------- Contact (open comm thread) --------
    if (action === 'contact') {
      if (!payload)
        return interaction.followUp({ content: '❌ Δεν βρέθηκε η αγγελία.', flags: MessageFlags.Ephemeral })

      if (payload.contacts?.includes(interaction.user.id)) {
        return interaction.followUp({ content: 'ℹ️ Υπάρχει ήδη συζήτηση για σένα σε αυτή την αγγελία.', flags: MessageFlags.Ephemeral })
      }

      if (!payload.postedChannelId || !payload.postedMessageId) {
        return interaction.followUp({ content: '❌ Δεν βρέθηκαν ids δημοσίευσης για την αγγελία.', flags: MessageFlags.Ephemeral })
      }

      const channel: any = interaction.guild!.channels.cache.get(payload.postedChannelId!)
      const message = await channel?.messages.fetch(payload.postedMessageId!).catch(() => null)
      if (!message) {
        return interaction.followUp({ content: '⚠️ Το αρχικό μήνυμα δεν βρέθηκε.', flags: MessageFlags.Ephemeral })
      }

      const threadName = `📦 ${payload.cardName} — ${interaction.user.username}`
      const me = channel.guild.members.me
      const canPrivate = channel
        .permissionsFor(me)
        ?.has([PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads])

      const commThread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 10080,
        type: canPrivate ? ChannelType.PrivateThread : ChannelType.PublicThread,
      })

      await commThread.members.add(payload.requesterId).catch(() => {})
      await commThread.members.add(interaction.user.id).catch(() => {})

      const newContacts = Array.from(new Set([...(payload.contacts || []), interaction.user.id]))
      await setApproval({ ...payload, contacts: newContacts })

      await commThread.send(
        `Γεια σας <@${payload.requesterId}> & <@${interaction.user.id}>!\n` +
          `• **Κάρτα:** ${payload.cardName}\n` +
          `• **Ποσότητα:** ${payload.quantity}\n` +
          (Number.isFinite(payload.price as number) ? `• **Τιμή/Budget:** ${payload.price}€\n` : '') +
          `• **Περιοχή/Παράδοση:** ${payload.location || '-'}\n\n` +
          `Όταν ολοκληρωθεί η συναλλαγή, πατήστε το κουμπί **Ολοκληρώθηκε ✅** (χρειάζονται 2 επιβεβαιώσεις σε 72h).`,
      )

      const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`complete:${pid}`).setLabel('Ολοκληρώθηκε ✅').setStyle(ButtonStyle.Success),
      )
      const controlsMsg = await commThread.send({ content: `Controls:`, components: [controls] })

      upsertDeal(pid, {
        pid,
        threadId: commThread.id,
        sellerId: payload.requesterId,
        buyerId: interaction.user.id,
        status: 'pending',
        firstConfirmBy: null,
        firstConfirmAt: null,
        caseThreadId: payload.caseThreadId,
        controlsMessageId: controlsMsg.id,
        createdAt: Date.now(),
      })

      return interaction.followUp({ content: '✅ Δημιουργήθηκε private thread επικοινωνίας.', flags: MessageFlags.Ephemeral })
    }

    // -------- Complete (double confirm, 72h) --------
    if (action === 'complete') {
      const deal = getDeal(pid)
      if (!deal)
        return interaction.followUp({ content: '❌ Δεν βρέθηκαν στοιχεία συναλλαγής.', flags: MessageFlags.Ephemeral })

      if (deal.status !== 'pending') {
        return interaction.followUp({ content: `ℹ️ Το deal είναι ήδη **${deal.status}**.`, flags: MessageFlags.Ephemeral })
      }

      const now = Date.now()
      const isSeller = interaction.user.id === deal.sellerId
      const isBuyer  = interaction.user.id === deal.buyerId
      if (!isSeller && !isBuyer) {
        return interaction.followUp({ content: '⛔ Μόνο seller ή buyer.', flags: MessageFlags.Ephemeral })
      }

      const commThread: any = interaction.channel?.isThread() ? interaction.channel : null
      const caseThread: any = deal.caseThreadId ? interaction.guild!.channels.cache.get(deal.caseThreadId) : null

      if (!deal.firstConfirmBy) {
        upsertDeal(pid, { firstConfirmBy: interaction.user.id, firstConfirmAt: now })
        await commThread?.send(`✅ 1η επιβεβαίωση από ${interaction.user}. Περιμένουμε τη 2η επιβεβαίωση (72h).`)
        await caseThread?.send(`ℹ️ 1η επιβεβαίωση στο deal από ${interaction.user} (PID: ${pid}).`)
        return interaction.followUp({ content: '👍 Καταχωρήθηκε η 1η επιβεβαίωση. Χρειάζεται άλλη μία σε 72h.', flags: MessageFlags.Ephemeral })
      }

      const within = now - (deal.firstConfirmAt || 0)
      const within72h = within <= 72 * 60 * 60 * 1000
      if (!within72h) {
        upsertDeal(pid, { status: 'expired' })
        await commThread?.send('⌛ Έληξε το παράθυρο 72h χωρίς 2η επιβεβαίωση. Το deal δεν μετράει στο rep.')
        await caseThread?.send('⌛ Έληξε χωρίς 2η επιβεβαίωση (no rep).')
        return interaction.followUp({ content: '⌛ Έληξε το παράθυρο 72h. Το deal μαρκάρεται ως expired.', flags: MessageFlags.Ephemeral })
      }

      upsertDeal(pid, { status: 'completed' })
      addReputation(deal.sellerId, 'seller')
      addReputation(deal.buyerId, 'buyer')

      try {
        const controlsMsg = await commThread?.messages.fetch(deal.controlsMessageId).catch(() => null)
        if (controlsMsg) await disableControls(controlsMsg)
        await commThread?.send('🏁 Ολοκληρώθηκε. Το thread θα αρχειοθετηθεί.')
        await commThread?.setArchived(true).catch(() => {})
        await caseThread?.send('🏁 Ολοκληρώθηκε (rep +1 σε seller & buyer).')
      } catch {}

      return interaction.followUp({ content: '✅ Ολοκληρώθηκε το deal (rep +1).', flags: MessageFlags.Ephemeral })
    }

    // -------- Mod Resolve (modal) --------
    if (action === 'modresolve') {
      if (!modPerm)
        return interaction.followUp({ content: '⛔ Μόνο mods.', flags: MessageFlags.Ephemeral })

      const modal = new ModalBuilder().setCustomId(`modresolve:${pid}`).setTitle('Mod Resolve')
      const outcome = new TextInputBuilder().setCustomId('outcome').setLabel('Outcome (seller|buyer|both|none)').setStyle(TextInputStyle.Short).setRequired(true)
      const reason  = new TextInputBuilder().setCustomId('reason').setLabel('Αιτιολογία').setStyle(TextInputStyle.Paragraph).setRequired(true)
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(outcome),
        new ActionRowBuilder<TextInputBuilder>().addComponents(reason),
      )
      return interaction.showModal(modal)
    }

    // -------- Close post ------
    if (action === 'close') {
      if (!payload)
        return interaction.followUp({ content: '❌ Δεν βρέθηκε η αγγελία.', flags: MessageFlags.Ephemeral })

      const owner = interaction.user.id === payload.requesterId
      if (!owner && !modPerm) {
        return interaction.followUp({ content: '⛔ Μόνο ο δημιουργός ή mod.', flags: MessageFlags.Ephemeral })
      }

      if (!payload.postedChannelId || !payload.postedMessageId) {
        return interaction.followUp({ content: '❌ Δεν βρέθηκαν ids δημοσίευσης για την αγγελία.', flags: MessageFlags.Ephemeral })
      }
      const channel: any = interaction.guild!.channels.cache.get(payload.postedChannelId!)
      const message = await channel?.messages.fetch(payload.postedMessageId!).catch(() => null)

      if (message) {
        const orig = message.embeds?.[0]
        if (orig) {
          const updated = EmbedBuilder.from(orig).setTitle(`[CLOSED] ${orig.title}`)
          const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`contact:${pid}`).setLabel('Ενδιαφέρομαι 🙋').setStyle(ButtonStyle.Primary).setDisabled(true),
            new ButtonBuilder().setCustomId(`close:${pid}`).setLabel('Κλείσιμο Αγγελίας 🔒').setStyle(ButtonStyle.Secondary).setDisabled(true),
          )
          try {
            await message.edit({ embeds: [updated], components: [disabledRow] })
          } catch (e) {
            console.error('close edit error', e)
          }
        }
      }

      try {
        const caseThread: any = interaction.guild!.channels.cache.get(payload.caseThreadId)
        caseThread?.send(`🔒 Κλείσιμο αγγελίας από ${owner ? 'owner' : 'mod'} ${interaction.user}.`)
      } catch {}

      return interaction.followUp({ content: '✅ Η αγγελία έκλεισε.', flags: MessageFlags.Ephemeral })
    }
  }

  // ----- Modal submit: Mod Resolve -----
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modresolve:')) {
    const pid = interaction.customId.split(':')[1]
    const member = await interaction.guild!.members.fetch(interaction.user.id)
    const modPerm = isMemberMod(member)
    if (!modPerm)
      return interaction.reply({ content: '⛔ Μόνο mods.', flags: MessageFlags.Ephemeral })

    const outcome = interaction.fields.getTextInputValue('outcome')?.trim().toLowerCase()
    const reason  = interaction.fields.getTextInputValue('reason')?.trim()
    if (!['seller', 'buyer', 'both', 'none'].includes(outcome)) {
      return interaction.reply({ content: '❌ Outcome: seller|buyer|both|none', flags: MessageFlags.Ephemeral })
    }

    const deal = getDeal(pid)
    if (!deal) {
      return interaction.reply({ content: '❌ Δεν βρέθηκε deal.', flags: MessageFlags.Ephemeral })
    }

    if (outcome === 'seller' || outcome === 'both') addReputation(deal.sellerId, 'seller')
    if (outcome === 'buyer'  || outcome === 'both') addReputation(deal.buyerId, 'buyer')

    try {
      const caseThread: any = interaction.guild!.channels.cache.get(deal.caseThreadId)
      await caseThread?.send(`🛡️ Mod Resolve από ${interaction.user}: \`${outcome}\` — ${reason}`)
      const commThread: any = deal.threadId ? interaction.guild!.channels.cache.get(deal.threadId) : null
      if (commThread) {
        try {
          const controlsMsg = await commThread.messages.fetch(deal.controlsMessageId).catch(() => null)
          if (controlsMsg) await disableControls(controlsMsg)
          await commThread.setArchived(true).catch(() => {})
        } catch {}
      }
    } catch {}

    return interaction.reply({ content: '✅ Καταχωρήθηκε το Mod Resolve.', flags: MessageFlags.Ephemeral })
  }
}

/* =========================================================
   Register interactions (κουμπώνουμε τον handler)
========================================================= */
export function registerMarketInteractions(client: Client) {
  client.on('interactionCreate', async (i) => {
    await handleMarketCommand(i)
  })
}