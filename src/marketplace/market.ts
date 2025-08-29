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

/* =========================================================
   Types
========================================================= */
type Kind = 'sell' | 'buy'

interface ApprovalPayload {
  guildId: string | null
  requesterId: string
  kind: Kind
  price: number | null
  quantity: number
  cardName: string
  location: string
  extra: string
  photo1?: { url: string } | null
  photo2?: { url: string } | null
  caseThreadId: string
  caseMessageId: string
  postedMessageId?: string
  postedChannelId?: string
  contacts?: Set<string>
}

/* =========================================================
   Labels
========================================================= */
const typeLabels: Record<Kind, { en: string; el: string }> = {
  sell: { en: 'Sell', el: 'ΠΩΛΗΣΗ' },
  buy: { en: 'Buy', el: 'ΑΓΟΡΑ' },
}

/* =========================================================
   Paths / JSON helpers
========================================================= */
const DATA_DIR = path.resolve('./data')
const FILES = {
  approved: path.join(DATA_DIR, 'approvedPosts.json'),
  deals: path.join(DATA_DIR, 'deals.json'),
  rep: path.join(DATA_DIR, 'reputation.json'),
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

/* =========================================================
   Stores
========================================================= */
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
function isMemberMod(member: GuildMember) {
  return (
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    (process.env.MOD_ROLE_ID && member.roles.cache.has(process.env.MOD_ROLE_ID))
  )
}
const env = (name: string): string => {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}
const newId = () => Math.random().toString(36).slice(2, 10)

/* Disable controls in comm threads */
async function disableControls(clientInteractionOrGuild: any, deal: any) {
  try {
    const guild = clientInteractionOrGuild.guild ?? clientInteractionOrGuild
    if (!deal?.threadId || !deal?.controlsMessageId) return
    const thread: any = await guild.channels.fetch(deal.threadId).catch(() => null)
    if (!thread) return
    const msg: any = await thread.messages.fetch(deal.controlsMessageId).catch(() => null)
    if (!msg || !msg.components?.length) return

    const rows = msg.components.map((r: any) => {
      const row = ActionRowBuilder.from(r) as ActionRowBuilder<ButtonBuilder>
      // @ts-expect-error generic loosen
      row.components = row.components.map((c: any) => ButtonBuilder.from(c).setDisabled(true))
      return row
    })
    await msg.edit({ components: rows })
  } catch (e) {
    console.error('disableControls error:', e)
  }
}

/* =========================================================
   Volatile state
========================================================= */
const pendingSlashToModal = new Map<string, { kind: Kind; photo1: any; photo2: any | null }>()
const pendingApprovals = new Map<string, ApprovalPayload>()

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
                { name: 'Αγορά / Buy', value: 'buy' },
              ),
          )
          .addAttachmentOption((o) =>
            o.setName('photo1').setDescription('Main photo (required)').setRequired(true),
          )
          .addAttachmentOption((o) =>
            o.setName('photo2').setDescription('Extra photo (optional)').setRequired(false),
          ),
      ),
  ]
}

/* =========================================================
   Main handler – κρατάει ΟΛΟ το flow και ΤΑ ΙΔΙΑ LOGS
========================================================= */
export async function handleMarketCommand(interaction: Interaction) {
  // ----- /market post → modal -----
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'market' && interaction.options.getSubcommand() === 'post') {
      const kind = interaction.options.getString('type') as Kind
      const photo1 = interaction.options.getAttachment('photo1')
      const photo2 = interaction.options.getAttachment('photo2') || null

      pendingSlashToModal.set(interaction.user.id, { kind, photo1, photo2 } as { kind: Kind; photo1: any; photo2: any })

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
        .setLabel('Τιμή / Budget (υποχρεωτικό μόνο για Πώληση)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
      const extra = new TextInputBuilder()
        .setCustomId('extra')
        .setLabel('Extra πληροφορίες (προαιρετικό)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(card),
        new ActionRowBuilder<TextInputBuilder>().addComponents(location),
        new ActionRowBuilder<TextInputBuilder>().addComponents(quantity),
        new ActionRowBuilder<TextInputBuilder>().addComponents(price),
        new ActionRowBuilder<TextInputBuilder>().addComponents(extra),
      )

      await interaction.showModal(modal)
    }
    return
  }

  // ----- Modal submit → CASE thread (MARKET_LOG_CHANNEL_ID) με Approve/Reject -----
  if (interaction.isModalSubmit() && interaction.customId === 'marketPost') {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })

      const saved = pendingSlashToModal.get(interaction.user.id)
      pendingSlashToModal.delete(interaction.user.id)
      if (!saved)
        return interaction.editReply('❌ Δεν βρέθηκαν τα αρχικά στοιχεία. Ξαναδοκίμασε το `/market post`.')

      const { kind, photo1, photo2 } = saved as { kind: Kind; photo1: any; photo2: any }

      const cardName = interaction.fields.getTextInputValue('cardName')?.trim()
      const location = interaction.fields.getTextInputValue('location')?.trim()
      const quantityRaw = interaction.fields.getTextInputValue('quantity')?.trim()
      const priceRaw = interaction.fields.getTextInputValue('price')?.trim()
      const extra = interaction.fields.getTextInputValue('extra')?.trim() || '-'

      const quantity = parseInt(quantityRaw, 10)
      const price = priceRaw ? Number(priceRaw.replace(',', '.')) : null

      if (!cardName || !location)
        return interaction.editReply(
          '❌ Τα πεδία **Όνομα Κάρτας** και **Περιοχή/Παράδοση** είναι υποχρεωτικά.',
        )
      if (!Number.isFinite(quantity) || quantity <= 0)
        return interaction.editReply('❌ Η ποσότητα πρέπει να είναι αριθμός ≥ 1.')
      if (kind === 'sell' && (price === null || !Number.isFinite(price)))
        return interaction.editReply('❌ Για αγγελίες **ΠΩΛΗΣΗΣ** η τιμή είναι υποχρεωτική.')

      const typeLabel = typeLabels[kind].el
      const isSell = kind === 'sell'
      const priceText = Number.isFinite(price as number)
        ? `${(price as number).toLocaleString('el-GR')} €`
        : '-'
      const color = isSell ? 0x00b894 : 0x0984e3

      const preview = new EmbedBuilder()
        .setTitle(`${typeLabel} — ${cardName}`)
        .addFields(
          { name: 'Ποσότητα', value: quantity.toString(), inline: true },
          { name: isSell ? 'Τιμή' : 'Budget', value: priceText, inline: true },
          { name: 'Περιοχή / Παράδοση', value: location || '-', inline: true },
          { name: 'Extra', value: extra },
        )
        .setColor(color)
        .setFooter({ text: `Υποβλήθηκε από ${interaction.user.tag} • ${interaction.user.id}` })

      if (photo1) preview.setImage(photo1.url)
      if (photo2) preview.addFields({ name: 'Επιπλέον φωτό', value: photo2.url })

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

pendingApprovals.set(pid, {
  guildId: interaction.guildId,
  requesterId: interaction.user.id,
  kind: kind as Kind,
  price,
  quantity,
  cardName,
  location,
  extra,
  photo1,
  photo2,
  caseThreadId: caseThread.id,
  caseMessageId: caseMsg.id,
} satisfies ApprovalPayload)


      await caseThread.send(
        `📥 Καταχώρηση για έγκριση.\n• User: <@${interaction.user.id}>\n• Τύπος: **${typeLabel}**\n• Ποσότητα: **${quantity}**\n• Τιμή/Budget: **${priceText}**\n• Περιοχή: **${location}**`,
      )

      await interaction.editReply('✅ Η αγγελία στάλθηκε στο CASE thread για έγκριση από mods.')
    } catch (err) {
      console.error('Modal submit error:', err)
      if (interaction.deferred || interaction.replied)
        await interaction.editReply('❌ Κάτι πήγε στραβά. Δοκίμασε ξανά.')
      else await interaction.reply({ content: '❌ Κάτι πήγε στραβά.', flags: MessageFlags.Ephemeral })
    }
    return
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
      try {
        await interaction.deferUpdate()
      } catch {}
    }

    const member = await interaction.guild!.members.fetch(interaction.user.id)
    const modPerm = isMemberMod(member)

    const payload = pendingApprovals.get(pid)

    // -------- Approve --------
    if (action === 'approve') {
      if (!payload)
        return interaction.followUp({
          content: '❌ Δεν βρέθηκαν στοιχεία αυτής της αίτησης.',
          flags: MessageFlags.Ephemeral,
        })
      const {
        kind,
        price,
        quantity,
        cardName,
        location,
        extra,
        requesterId,
        photo1,
        photo2,
        caseThreadId,
        caseMessageId,
      } = payload

      const typeLabel = typeLabels[kind]['el']
      const isSell = kind === 'sell'
      const priceText =
      price !== null && Number.isFinite(price)
        ? `${(price as number).toLocaleString('el-GR')} €`
        : '-'
      const color = isSell ? 0x00b894 : 0x0984e3

      const publicEmbed = new EmbedBuilder()
        .setTitle(`${typeLabel} — ${cardName}`)
        .addFields(
          { name: 'Ποσότητα', value: quantity.toString(), inline: true },
          { name: isSell ? 'Τιμή' : 'Budget', value: priceText, inline: true },
          { name: 'Περιοχή / Παράδοση', value: location || '-', inline: true },
          { name: 'Extra', value: extra || '-' },
        )
        .setColor(color)
        .setFooter({
          text:
            `Από ${interaction.guild!.members.cache.get(requesterId)?.user?.tag || requesterId}`,
        })
        .setTimestamp()

      if (photo1) publicEmbed.setImage(photo1.url)
      if (photo2) publicEmbed.addFields({ name: 'Επιπλέον φωτό', value: photo2.url })

      const targetId = isSell ? env('SELL_CHANNEL_ID') : env('BUY_CHANNEL_ID')
      const targetChannel: any = interaction.guild!.channels.cache.get(targetId!)
      if (!targetId || !targetChannel) {
        console.error('Approve error: target channel missing', { kind, targetId })
        return interaction.followUp({
          content: '⚠️ Δεν βρέθηκε το κανάλι στόχος (SELL/BUY).',
          flags: MessageFlags.Ephemeral,
        })
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
        return interaction.followUp({
          content: '⛔ Το bot δεν έχει δικαιώματα στο BUY/SELL (View/Send/Embed/Attach).',
          flags: MessageFlags.Ephemeral,
        })
      }

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`contact:${pid}`)
          .setLabel('Ενδιαφέρομαι 🙋')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`close:${pid}`)
          .setLabel('Κλείσιμο Αγγελίας 🔒')
          .setStyle(ButtonStyle.Secondary),
      )

      let postMsg: any
      try {
        postMsg = await targetChannel.send({ embeds: [publicEmbed], components: [row] })
      } catch (e) {
        console.error('Approve send error:', e)
        return interaction.followUp({
          content: '❌ Σφάλμα κατά τη δημοσίευση.',
          flags: MessageFlags.Ephemeral,
        })
      }

      pendingApprovals.set(pid, {
        ...payload,
        postedMessageId: postMsg.id,
        postedChannelId: targetChannel.id,
        contacts: new Set<string>(),
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
          const rows = caseMsg.components.map((r: any) => {
            const row = ActionRowBuilder.from(r) as ActionRowBuilder<ButtonBuilder>
            // @ts-expect-error generic loosen
            row.components = row.components.map((b: any) => ButtonBuilder.from(b).setDisabled(true))
            return row
          })
          await caseMsg.edit({ components: rows })

          const modRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`modresolve:${pid}`)
              .setLabel('Mod Resolve 🛡️')
              .setStyle(ButtonStyle.Secondary),
          )
          await caseThread.send({ content: 'Controls (mods only):', components: [modRow] })
          await caseThread.send(
            `✅ Εγκρίθηκε από ${interaction.user}. Δημοσιεύτηκε στο <#${targetId}> (msg: ${postMsg.id}).`,
          )
        }
      } catch {}

      return interaction.followUp({
        content: `✅ Δημοσιεύτηκε στο <#${targetId}>.`,
        flags: MessageFlags.Ephemeral,
      })
    }

    // -------- Reject --------
    if (action === 'reject') {
      if (!modPerm)
        return interaction.followUp({
          content: '⛔ Μόνο mods.',
          flags: MessageFlags.Ephemeral,
        })
      if (!payload)
        return interaction.followUp({
          content: '❌ Δεν βρέθηκαν στοιχεία.',
          flags: MessageFlags.Ephemeral,
        })

      const { caseThreadId, caseMessageId, cardName } = payload
      pendingApprovals.delete(pid)

      try {
        const caseThread: any = interaction.guild!.channels.cache.get(caseThreadId)
        const caseMsg: any = await caseThread?.messages.fetch(caseMessageId).catch(() => null)
        if (caseMsg) {
          const rows = caseMsg.components.map((r: any) => {
            const row = ActionRowBuilder.from(r) as ActionRowBuilder<ButtonBuilder>
            // @ts-expect-error generic loosen
            row.components = row.components.map((b: any) => ButtonBuilder.from(b).setDisabled(true))
            return row
          })
          await caseMsg.edit({ components: rows })
        }
        caseThread?.send(
          `❌ Απορρίφθηκε από ${interaction.user}. (PID: ${pid}, Card: **${cardName}**)`,
        )
      } catch {}

      return interaction.followUp({
        content: '❌ Απορρίφθηκε η αγγελία.',
        flags: MessageFlags.Ephemeral,
      })
    }

    // -------- Contact (open comm thread) --------
    if (action === 'contact') {
      if (!payload)
        return interaction.followUp({
          content: '❌ Δεν βρέθηκε η αγγελία.',
          flags: MessageFlags.Ephemeral,
        })

      if (payload.contacts?.has(interaction.user.id)) {
        return interaction.followUp({
          content: 'ℹ️ Υπάρχει ήδη συζήτηση για σένα σε αυτή την αγγελία.',
          flags: MessageFlags.Ephemeral,
        })
      }

      if (!payload.postedChannelId || !payload.postedMessageId) {
    return interaction.followUp({
        content: '❌ Δεν βρέθηκαν ids δημοσίευσης για την αγγελία.',
        flags: MessageFlags.Ephemeral,
    })
    }
    const channel: any = interaction.guild!.channels.cache.get(payload.postedChannelId!)
    const message = await channel?.messages.fetch(payload.postedMessageId!).catch(() => null)

      if (!message)
        return interaction.followUp({
          content: '❌ Δεν βρέθηκε το μήνυμα αγγελίας.',
          flags: MessageFlags.Ephemeral,
        })

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

      payload.contacts = payload.contacts || new Set<string>()
      payload.contacts.add(interaction.user.id)
      pendingApprovals.set(pid, payload)

      await commThread.send(
        `Γεια σας <@${payload.requesterId}> & <@${interaction.user.id}>!\n` +
        `• **Κάρτα:** ${payload.cardName}\n` +
        `• **Ποσότητα:** ${payload.quantity}\n` +
        (Number.isFinite(payload.price as number)
            ? `• **Τιμή/Budget:** ${payload.price}€\n`
            : '') +
         `• **Περιοχή/Παράδοση:** ${payload.location}\n\n` +
        `Όταν ολοκληρωθεί η συναλλαγή, πατήστε **Ολοκληρώθηκε ✅**.`
        )

      const completeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`complete:${pid}`)
          .setLabel('Ολοκληρώθηκε ✅')
          .setStyle(ButtonStyle.Success),
      )
      const controlsMsg = await commThread.send({ content: 'Controls:', components: [completeRow] })

      // Save deal state + controlsMessageId
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
      })

      if (payload.caseThreadId) {
        const caseThread: any = interaction.guild!.channels.cache.get(payload.caseThreadId)
        caseThread?.send(
          `🙋 Ενδιαφέρον από <@${interaction.user.id}> — άνοιξε thread: ${commThread.toString()}`,
        )
      }

      return interaction.followUp({
        content: '✅ Δημιουργήθηκε thread επικοινωνίας.',
        flags: MessageFlags.Ephemeral,
      })
    }

    // -------- Complete (Ολοκληρώθηκε) --------
    if (action === 'complete') {
      if (!payload)
        return interaction.followUp({
          content: '❌ Δεν βρέθηκε η αγγελία.',
          flags: MessageFlags.Ephemeral,
        })

      const deal = getDeal(pid)
      if (!deal)
        return interaction.followUp({
          content: '❌ Δεν βρέθηκαν στοιχεία συναλλαγής.',
          flags: MessageFlags.Ephemeral,
        })

      // HARD GUARD: μόνο όταν είναι pending
      if (deal.status !== 'pending') {
        return interaction.followUp({
          content: `ℹ️ Το deal είναι ήδη **${deal.status}**.`,
          flags: MessageFlags.Ephemeral,
        })
      }

      const now = Date.now()
      const isSeller = interaction.user.id === deal.sellerId
      const isBuyer = interaction.user.id === deal.buyerId
      if (!isSeller && !isBuyer) {
        return interaction.followUp({
          content: '⛔ Μόνο seller ή buyer.',
          flags: MessageFlags.Ephemeral,
        })
      }

      const commThread: any = interaction.channel?.isThread() ? interaction.channel : null
      const caseThread: any = deal.caseThreadId
        ? interaction.guild!.channels.cache.get(deal.caseThreadId)
        : null

      // First confirm
      if (!deal.firstConfirmAt) {
        upsertDeal(pid, {
          firstConfirmBy: isSeller ? 'seller' : 'buyer',
          firstConfirmAt: new Date(now).toISOString(),
        })

        const who = isSeller ? 'Seller' : 'Buyer'
        const expires = new Date(now + 72 * 60 * 60 * 1000).toLocaleString('el-GR')
        await commThread?.send(
          `✅ ${who} επιβεβαίωσε. Περιμένουμε τον ${isSeller ? 'Buyer' : 'Seller'} μέχρι **${expires}**.`,
        )
        caseThread?.send(
          `🟡 ${who} έκανε confirm. Περιμένουμε τον ${isSeller ? 'Buyer' : 'Seller'}. (λήξη ~72h)`,
        )

        return interaction.followUp({
          content: '✅ Καταγράφηκε η επιβεβαίωσή σου.',
          flags: MessageFlags.Ephemeral,
        })
      }

      // Second confirm
      const firstAt = new Date(deal.firstConfirmAt).getTime()
      const within72h = now - firstAt <= 72 * 60 * 60 * 1000

      // Μην επιτρέπεις στον ίδιο να “ξανα-επιβεβαιώσει”
      if (
        (deal.firstConfirmBy === 'seller' && isSeller) ||
        (deal.firstConfirmBy === 'buyer' && isBuyer)
      ) {
        return interaction.followUp({
          content: 'ℹ️ Έχεις ήδη επιβεβαιώσει. Περιμένουμε τον άλλο χρήστη.',
          flags: MessageFlags.Ephemeral,
        })
      }

      if (!within72h) {
        upsertDeal(pid, { status: 'expired' })
        await commThread?.send('⏰ Έληξε το παράθυρο επιβεβαίωσης (72h). Δεν δίνεται reputation.')
        caseThread?.send('❌ Το παράθυρο επιβεβαίωσης έληξε, δεν δόθηκε rep.')
        await disableControls(interaction, {
          threadId: deal.threadId,
          controlsMessageId: deal.controlsMessageId,
        })
        try {
          await commThread?.setArchived(true)
        } catch {}
        return
      }

      // Success → +1 rep σε seller & buyer
      addReputation(deal.sellerId, 'seller')
      addReputation(deal.buyerId, 'buyer')
      upsertDeal(pid, { status: 'completed', completedAt: new Date(now).toISOString() })

      await commThread?.send(
        `🎉 Επιβεβαιώθηκε από **Seller & Buyer**! Δόθηκε **+1 rep** σε <@${deal.sellerId}> και <@${deal.buyerId}>. Ευχαριστούμε!`,
      )
      caseThread?.send(
        `✅ Deal ολοκληρώθηκε (+1 rep σε <@${deal.sellerId}> & <@${deal.buyerId}>).`,
      )
      await disableControls(interaction, {
        threadId: deal.threadId,
        controlsMessageId: deal.controlsMessageId,
      })
      try {
        await commThread?.setArchived(true)
      } catch {}

      return
    }

    // -------- Mod Resolve (button → modal) --------
    if (action === 'modresolve') {
      if (!modPerm) {
        return interaction.reply({ content: '⛔ Μόνο mods.', flags: MessageFlags.Ephemeral })
      }
      const modal = new ModalBuilder().setCustomId(`modresolve:${pid}`).setTitle('Mod Resolve')
      const outcome = new TextInputBuilder()
        .setCustomId('outcome')
        .setLabel('Outcome (seller|buyer|both|none)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
      const reason = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Αιτιολογία')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(outcome),
        new ActionRowBuilder<TextInputBuilder>().addComponents(reason),
      )
      return interaction.showModal(modal)
    }

    // -------- Close post --------
    if (action === 'close') {
      if (!payload)
        return interaction.followUp({
          content: '❌ Δεν βρέθηκε η αγγελία.',
          flags: MessageFlags.Ephemeral,
        })

      const owner = interaction.user.id === payload.requesterId
      if (!owner && !modPerm) {
        return interaction.followUp({
          content: '⛔ Μόνο ο δημιουργός ή mod.',
          flags: MessageFlags.Ephemeral,
        })
      }

      if (!payload.postedChannelId || !payload.postedMessageId) {
        return interaction.followUp({
        content: '❌ Δεν βρέθηκαν ids δημοσίευσης για την αγγελία.',
        flags: MessageFlags.Ephemeral,
    })
    }
    const channel: any = interaction.guild!.channels.cache.get(payload.postedChannelId!)
    const message = await channel?.messages.fetch(payload.postedMessageId!).catch(() => null)

      if (message) {
        const orig = message.embeds?.[0]
        if (orig) {
          const updated = EmbedBuilder.from(orig).setTitle(`[CLOSED] ${orig.title}`)
          const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`contact:${pid}`)
              .setLabel('Ενδιαφέρομαι 🙋')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`close:${pid}`)
              .setLabel('Κλείσιμο Αγγελίας 🔒')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
          )
          await message.edit({ embeds: [updated], components: [disabledRow] })
        }
      }

      if (payload.caseThreadId) {
        const caseThread: any = interaction.guild!.channels.cache.get(payload.caseThreadId)
        caseThread?.send(`🔒 Κλείσιμο αγγελίας από ${owner ? 'owner' : 'mod'} ${interaction.user}.`)
      }

      return interaction.followUp({
        content: '✅ Η αγγελία έκλεισε.',
        flags: MessageFlags.Ephemeral,
      })
    }
  }

  // ----- Modal submit: Mod Resolve -----
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modresolve:')) {
    const pid = interaction.customId.split(':')[1]
    const member = await interaction.guild!.members.fetch(interaction.user.id)
    if (!isMemberMod(member)) {
      return interaction.reply({ content: '⛔ Μόνο mods.', flags: MessageFlags.Ephemeral })
    }

    const deal = getDeal(pid)
    if (!deal) {
      return interaction.reply({
        content: '❌ Δεν βρέθηκαν στοιχεία συναλλαγής (deal).',
        flags: MessageFlags.Ephemeral,
      })
    }

    const outcome = interaction.fields.getTextInputValue('outcome')?.trim().toLowerCase()
    const reason = interaction.fields.getTextInputValue('reason')?.trim()

    if (!['seller', 'buyer', 'both', 'none'].includes(outcome)) {
      return interaction.reply({
        content: '❌ Άκυρο outcome. Δεκτές τιμές: seller | buyer | both | none.',
        flags: MessageFlags.Ephemeral,
      })
    }

    // Αν δεν είναι pending, μην κάνεις double actions
    if (deal.status && deal.status !== 'pending') {
      return interaction.reply({
        content: `ℹ️ Το deal είναι ήδη **${deal.status}**.`,
        flags: MessageFlags.Ephemeral,
      })
    }

    // Εφάρμοσε απόφαση
    if (outcome === 'seller' || outcome === 'both') addReputation(deal.sellerId, 'seller')
    if (outcome === 'buyer' || outcome === 'both') addReputation(deal.buyerId, 'buyer')

    upsertDeal(pid, {
      status: 'completed_mod',
      modResolution: {
        by: interaction.user.id,
        at: new Date().toISOString(),
        outcome,
        reason,
      },
    })

    const caseThread: any = deal.caseThreadId
      ? interaction.guild!.channels.cache.get(deal.caseThreadId)
      : null
    const commThread: any = deal.threadId
      ? interaction.guild!.channels.cache.get(deal.threadId)
      : null

    caseThread?.send(
      `🛡️ **Mod Resolve** από <@${interaction.user.id}> — outcome: **${outcome}**, reason: _${reason}_.`,
    )
    if (commThread) {
      await commThread.send(
        `🛡️ **Mod Resolve**: Απόφαση **${outcome}** (reason: _${reason}_). Το thread θα αρχειοθετηθεί.`,
      )
      await disableControls(interaction, deal) // απενεργοποίηση κουμπιού Ολοκληρώθηκε
      try {
        await commThread.setArchived(true)
      } catch {}
    }

    return interaction.reply({
      content: '✅ Καταχωρήθηκε το Mod Resolve.',
      flags: MessageFlags.Ephemeral,
    })
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