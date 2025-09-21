import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  Client,
  Interaction,
  GuildMember,
  ThreadChannel,
  PermissionsBitField,
} from 'discord.js';

import { buildCaseReviewRow, buildPublicPostRow, buildCommThreadRow } from './ui/components';
import { buildPublicPostEmbed, buildCaseSummaryEmbed } from './ui/embeds';
import type { CaseStatus, Kind } from './types';

import fs from 'fs';
import path from 'path';

/* =========================================================
   Types (τοπικά για το αρχείο)
========================================================= */

type PendingSlash = {
  kind: Kind;
  photo1: any;
  photo2: any;
};

type PendingApproval = {
  pid: string;
  kind: Kind;

  // sell/buy
  cardName?: string;
  price?: number | null;
  quantity?: number;

  // trade
  offerTitle?: string;
  offerQty?: number;
  wantTitle?: string;
  wantQty?: number;
  cashDelta?: number;

  location: string;
  extra: string;
  photo1?: { url: string } | null;
  photo2?: { url: string } | null;

  caseThreadId: string;
  caseMessageId: string;

  postedMessageId?: string;
  postedChannelId?: string;

  requesterId: string; // seller/requester/trader A
  buyerId?: string;    // άλλος trader (ή buyer)

  // για refresh του CASE panel
  contacts: Set<string>;
  status?: CaseStatus;
  firstConfirmBy?: string;
  firstConfirmAt?: number;
  sellerConfirmed?: boolean;
  buyerConfirmed?: boolean;

  // comm threads για να τα κλειδώνουμε όλα
  commThreadIds?: string[];
};

/* =========================================================
   Simple utils
========================================================= */

const DATA_DIR = path.join(process.cwd(), 'data');
const FILES = {
  approvals: path.join(DATA_DIR, 'approvedPosts.json'),
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJson<T>(f: string, fallback: T): T {
  try {
    ensureDataDir();
    if (!fs.existsSync(f)) return fallback;
    const raw = fs.readFileSync(f, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function writeJsonAtomic(f: string, data: any) {
  ensureDataDir();
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}
function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}
function isMod(member: GuildMember | null | undefined): boolean {
  return !!member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}

// ✅ helper: φτιάχνει images[] από photo1/photo2
function photosToImages(
  ...photos: Array<({ url: string } | null | undefined)>
): string[] {
  return photos.map(p => p?.url).filter(Boolean) as string[];
}

/* ---------- THREAD HELPERS (νέο) ---------- */

async function fetchThreadSafe(guild: any, id: string): Promise<ThreadChannel | null> {
  try {
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (!ch) return null;
    if ('isThread' in ch && (ch as ThreadChannel).isThread()) return ch as ThreadChannel;
    return null;
  } catch {
    return null;
  }
}

async function ensureBotInPrivate(thread: ThreadChannel) {
  try {
    const me = await thread.guild.members.fetchMe();
    const members = await thread.members.fetch().catch(() => null);
    if (members && !members.has(me.id)) {
      await thread.members.add(me.id).catch(() => null);
    }
  } catch {}
}

async function lockAndArchiveThread(
  thread: ThreadChannel,
  notifyMsg?: string
): Promise<void> {
  try {
    await ensureBotInPrivate(thread);

    if (notifyMsg) {
      await thread.send(notifyMsg).catch(() => void 0);
    }

    // Permissions sanity check: ManageThreads
    const canManage = thread
      .permissionsFor(thread.client.user!.id)
      ?.has(PermissionsBitField.Flags.ManageThreads);
    if (!canManage) {
      console.error('[market] Missing ManageThreads for', thread.id, 'parent:', thread.parent?.name);
    }

    // One-shot edit για να αποφύγουμε race μεταξύ setLocked/setArchived
    await thread.edit({ locked: true, archived: true }).catch((e) => {
      console.error('[market] edit(locked+archived) failed for', thread.id, e);
      throw e;
    });

    // Προαιρετική επιβεβαίωση
    try {
      const refetched = await fetchThreadSafe(thread.guild, thread.id);
      if (refetched) {
        console.log('[market] archived:', refetched.archived, 'locked:', refetched.locked, 'id:', refetched.id);
      }
    } catch {}
  } catch (e) {
    console.error('[market] lockAndArchiveThread error for', thread.id, e);
  }
}

/* =========================================================
   In-memory pending (slash→modal / approvals)
========================================================= */

const pendingSlashToModal = new Map<string, PendingSlash>();
const pendingApprovals = new Map<string, PendingApproval>();

/* =========================================================
   Slash command
========================================================= */

export function getMarketCommands() {
  const post = new SlashCommandBuilder()
    .setName('market')
    .setDescription('Δημιούργησε αγγελία αγοράς/πώλησης/ανταλλαγής')
    .addSubcommand((s) =>
      s
        .setName('post')
        .setDescription('Νέα αγγελία')
        .addStringOption((o) =>
          o
            .setName('kind')
            .setDescription('Είδος αγγελίας')
            .setRequired(true)
            .addChoices(
              { name: 'Sell',  value: 'sell'  },
              { name: 'Buy',   value: 'buy'   },
              { name: 'Trade', value: 'trade' },
            ),
        )
        .addAttachmentOption((o) =>
          o.setName('photo1').setDescription('Φωτογραφία 1').setRequired(true),
        )
        .addAttachmentOption((o) =>
          o.setName('photo2').setDescription('Φωτογραφία 2').setRequired(false),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

  return [post];
}

/* =========================================================
   Register interactions
========================================================= */

export function registerMarketInteractions(client: Client) {
  client.on('interactionCreate', async (interaction: Interaction) => {
    // ----- Slash /market post → show modal -----
    if (interaction.isChatInputCommand() && interaction.commandName === 'market') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'post') {
        const kind = interaction.options.getString('kind', true) as Kind;
        const photo1 = interaction.options.getAttachment('photo1');
        const photo2 = interaction.options.getAttachment('photo2');

        // κρατάμε προσωρινά μέχρι το modal submit
        pendingSlashToModal.set(interaction.user.id, { kind, photo1, photo2 });

        const modal = new ModalBuilder().setCustomId('marketPost').setTitle('Νέα αγγελία');

        if (kind === 'trade') {
          const offerTitle = new TextInputBuilder()
            .setCustomId('offerTitle').setLabel('Τι προσφέρεις').setStyle(TextInputStyle.Short).setRequired(true);
          const offerQty = new TextInputBuilder()
            .setCustomId('offerQty').setLabel('Ποσότητα (προσφορά)').setStyle(TextInputStyle.Short).setRequired(true);
          const wantTitle = new TextInputBuilder()
            .setCustomId('wantTitle').setLabel('Τι ζητάς').setStyle(TextInputStyle.Short).setRequired(true);
          const wantQty = new TextInputBuilder()
            .setCustomId('wantQty').setLabel('Ποσότητα (ζητούμενο)').setStyle(TextInputStyle.Short).setRequired(true);
          const cashDelta = new TextInputBuilder()
            .setCustomId('cashDelta').setLabel('Διαφορά σε € (+ζητάς, -δίνεις)').setStyle(TextInputStyle.Short).setRequired(false);

          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(offerTitle),
            new ActionRowBuilder<TextInputBuilder>().addComponents(offerQty),
            new ActionRowBuilder<TextInputBuilder>().addComponents(wantTitle),
            new ActionRowBuilder<TextInputBuilder>().addComponents(wantQty),
            new ActionRowBuilder<TextInputBuilder>().addComponents(cashDelta),
          );
        } else {
          const card = new TextInputBuilder()
            .setCustomId('cardName')
            .setLabel('Όνομα Κάρτας')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
          const location = new TextInputBuilder()
            .setCustomId('location')
            .setLabel('Περιοχή')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
          const quantity = new TextInputBuilder()
            .setCustomId('quantity')
            .setLabel('Ποσότητα')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
          const price = new TextInputBuilder()
            .setCustomId('price')
            .setLabel('Τιμή (ή Budget αν BUY)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
          const extra = new TextInputBuilder()
            .setCustomId('extra')
            .setLabel('Extra πληροφορίες (π.χ. Τρόπος Παράδοσης)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(card),
            new ActionRowBuilder<TextInputBuilder>().addComponents(location),
            new ActionRowBuilder<TextInputBuilder>().addComponents(quantity),
            new ActionRowBuilder<TextInputBuilder>().addComponents(price),
            new ActionRowBuilder<TextInputBuilder>().addComponents(extra),
          );
        }

        await interaction.showModal(modal);
      }
      return;
    }

    // ----- Modal submit → CASE thread με summary + κουμπιά -----
    if (interaction.isModalSubmit() && interaction.customId === 'marketPost') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const saved = pendingSlashToModal.get(interaction.user.id);
        pendingSlashToModal.delete(interaction.user.id);
        if (!saved)
          return interaction.editReply('❌ Δεν βρέθηκαν τα αρχικά στοιχεία. Ξαναδοκίμασε το `/market post`.');

        const { kind, photo1, photo2 } = saved as { kind: Kind; photo1: any; photo2: any };

        // κοινά
        const requesterId = interaction.user.id;

        // sell/buy
        let cardName: string | undefined;
        let quantity: number | undefined;
        let price: number | null | undefined;

        // trade
        let offerTitle: string | undefined;
        let offerQty: number | undefined;
        let wantTitle: string | undefined;
        let wantQty: number | undefined;
        let cashDelta: number | undefined;

        // shared extra info
        let location = '';
        let extra = '';

        if (kind === 'trade') {
          offerTitle = interaction.fields.getTextInputValue('offerTitle').trim();
          offerQty   = Number(interaction.fields.getTextInputValue('offerQty'));
          wantTitle  = interaction.fields.getTextInputValue('wantTitle').trim();
          wantQty    = Number(interaction.fields.getTextInputValue('wantQty'));
          const cd   = interaction.fields.getTextInputValue('cashDelta')?.trim();
          cashDelta  = cd ? Number(cd.replace(',', '.')) : undefined;
        } else {
          cardName   = interaction.fields.getTextInputValue('cardName').trim();
          location   = interaction.fields.getTextInputValue('location').trim();
          quantity   = Number(interaction.fields.getTextInputValue('quantity'));
          const priceParsed = interaction.fields.getTextInputValue('price').trim();
          price      = priceParsed ? Number(priceParsed.replace(',', '.')) : null;
          extra      = interaction.fields.getTextInputValue('extra').trim();
        }

        const LOG_ID = env('MARKET_LOG_CHANNEL_ID');
        const logChannel: any = interaction.guild?.channels.cache.get(LOG_ID);
        if (!logChannel) return interaction.editReply('⚠️ Δεν βρέθηκε MARKET_LOG_CHANNEL_ID στο .env.');

        const displayTitle = kind === 'trade'
          ? `${offerTitle} ↔ ${wantTitle}`
          : cardName!;

        const stub = await logChannel.send(
          `🧾 Case for **${displayTitle}** από <@${interaction.user.id}> (${kind.toUpperCase()})`,
        );
        const caseThread = await stub.startThread({
          name: `CASE • ${displayTitle} — ${interaction.user.username}`,
          autoArchiveDuration: 10080,
          type: ChannelType.PrivateThread,
        });

        const pid = newId();

        // CASE summary (PENDING) + pin
        const caseMsg = await caseThread.send({
          content: `📝 **Νέα αγγελία προς έγκριση** από <@${interaction.user.id}> (${kind.toUpperCase()})`,
          embeds: [
            buildCaseSummaryEmbed({
              approval: {
                pid,
                kind,
                title: displayTitle,
                // sell/buy
                quantity: quantity ?? undefined,
                price: price ?? undefined,
                // trade
                offerTitle, offerQty, wantTitle, wantQty, cashDelta,
                // κοινά
                location: kind === 'trade' ? undefined : location,
                extra: kind === 'trade' ? undefined : extra,
                requesterId,
                images: photosToImages(
                  photo1 ? { url: photo1.url } : null,
                  photo2 ? { url: photo2.url } : null
                ),
              } as any,
              status: 'pending',
              sellerId: requesterId,
              buyerId: undefined,
              contacts: [],
            }),
          ],
          components: [buildCaseReviewRow(pid)],
        });
        caseMsg.pin().catch(() => void 0);

        pendingApprovals.set(pid, {
          pid,
          kind,
          // sell/buy
          cardName,
          price: price ?? null,
          quantity: quantity ?? 1,
          // trade
          offerTitle, offerQty, wantTitle, wantQty, cashDelta,
          // κοινά
          location: location ?? '',
          extra: extra ?? '',
          photo1: photo1 ? { url: photo1.url } : null,
          photo2: photo2 ? { url: photo2.url } : null,
          caseThreadId: caseThread.id,
          caseMessageId: caseMsg.id,
          contacts: new Set<string>(),
          requesterId,
          status: 'pending',
          commThreadIds: [],
        });

        return interaction.editReply(`📌 Δημιουργήθηκε CASE για **${displayTitle}** (pid=${pid}).`);
      } catch (e) {
        console.error('modal submit error', e);
        return interaction.editReply('❌ Κάτι πήγε στραβά.');
      }
    }

    // ----- Button handlers -----
    if (!interaction.isButton()) return;
    const [action, pid] = interaction.customId.split(':');

    // helper: φέρνει το CASE μήνυμα & κάνει refresh embed
    async function refreshCaseSummary(p: PendingApproval) {
      try {
        const caseThread: any = interaction.guild!.channels.cache.get(p.caseThreadId);
        const caseMessage = await caseThread?.messages.fetch(p.caseMessageId);
        if (!caseMessage) return;

        const displayTitle =
          p.kind === 'trade'
            ? `${p.offerTitle ?? '—'} ↔ ${p.wantTitle ?? '—'}`
            : p.cardName ?? '—';

        const embed = buildCaseSummaryEmbed({
          approval: {
            pid: p.pid,
            kind: p.kind,
            title: displayTitle,
            // sell/buy
            quantity: p.quantity ?? undefined,
            price: p.price ?? undefined,
            // trade
            offerTitle: p.offerTitle,
            offerQty: p.offerQty,
            wantTitle: p.wantTitle,
            wantQty: p.wantQty,
            cashDelta: p.cashDelta,
            // κοινά
            location: p.location ?? undefined,
            extra: p.extra ?? undefined,
            requesterId: p.requesterId,
            images: photosToImages(p.photo1 ?? null, p.photo2 ?? null),
          } as any,
          status: (p.status ?? 'pending') as CaseStatus,
          sellerId: p.requesterId,
          buyerId: p.buyerId,
          sellerConfirmed: !!p.sellerConfirmed,
          buyerConfirmed: !!p.buyerConfirmed,
          contacts: Array.from(p.contacts ?? []),
        });

        const changedComponents =
          (p.status && p.status !== 'pending')
            ? [buildCaseReviewRow(p.pid, { disableApproveReject: true, modResolveEnabled: true })]
            : [buildCaseReviewRow(p.pid, { disableApproveReject: false, modResolveEnabled: true })];

        await caseMessage.edit({ embeds: [embed], components: changedComponents });
      } catch (e) {
        console.error('refreshCaseSummary error', e);
      }
    }

    // --- Approve ---
    if (action === 'approve') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const payload = pendingApprovals.get(pid);
        if (!payload) return interaction.editReply('❌ Το CASE δεν βρέθηκε.');

        const member = interaction.member as GuildMember;
        if (!isMod(member))
          return interaction.editReply('⛔ Μόνο mods μπορούν να κάνουν approve.');

        const isSell = payload.kind === 'sell';
        const isBuy  = payload.kind === 'buy';
        const { kind } = payload;

        const displayTitle =
          kind === 'trade'
            ? `${payload.offerTitle ?? '—'} ↔ ${payload.wantTitle ?? '—'}`
            : payload.cardName ?? '—';

        const publicEmbed = buildPublicPostEmbed({
          approval: {
            pid,
            kind,
            title: displayTitle,
            // sell/buy
            quantity: payload.quantity ?? undefined,
            price: payload.price ?? undefined,
            // trade
            offerTitle: payload.offerTitle,
            offerQty: payload.offerQty,
            wantTitle: payload.wantTitle,
            wantQty: payload.wantQty,
            cashDelta: payload.cashDelta,
            // κοινά
            location: payload.location ?? undefined,
            extra: payload.extra ?? undefined,
            requesterId: payload.requesterId,
          },
        });

        // Public εικόνες: 1η στο embed, 2η ως link
        if (payload.photo1) publicEmbed.setImage(payload.photo1.url);
        if (payload.photo2) publicEmbed.addFields({ name: 'Επιπλέον φωτό', value: payload.photo2.url });

        const targetId =
          isSell ? env('SELL_CHANNEL_ID') :
          isBuy  ? env('BUY_CHANNEL_ID')  :
                   env('TRADE_CHANNEL_ID');

        const targetChannel: any = interaction.guild!.channels.cache.get(targetId!);
        if (!targetId || !targetChannel) {
          console.error('Approve error: target channel missing', { kind, targetId });
          return interaction.editReply('⚠️ Δεν βρέθηκε target κανάλι.');
        }

        // ✅ Public button ENABLED μετά το approve
        const row = buildPublicPostRow(true, pid);
        const postMsg = await targetChannel.send({ embeds: [publicEmbed], components: [row] });

        // update state
        payload.postedMessageId = postMsg.id;
        payload.postedChannelId = targetChannel.id;
        payload.status = 'open';
        pendingApprovals.set(pid, payload);

        saveApprovedPost({
          pid,
          guildId: interaction.guildId ?? undefined,
          channelId: targetChannel.id,
          messageId: postMsg.id,
        });

        // refresh CASE: disable AR + keep Mod Resolve enabled
        await refreshCaseSummary(payload);

        return interaction.editReply(`✅ Δημοσιεύτηκε στο ${targetChannel.toString()}.`);
      } catch (e) {
        console.error('approve error', e);
        return interaction.editReply('❌ Κάτι πήγε στραβά στο approve.');
      }
    }

    // --- Reject ---
    if (action === 'reject') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const payload = pendingApprovals.get(pid);
        if (!payload) return interaction.editReply('❌ Το CASE δεν βρέθηκε.');

        const member = interaction.member as GuildMember;
        if (!isMod(member))
          return interaction.editReply('⛔ Μόνο mods μπορούν να απορρίψουν.');

        const caseThread: any = interaction.guild!.channels.cache.get(payload.caseThreadId);
        caseThread?.send(`❌ Απορρίφθηκε από ${interaction.user}.`);
        return interaction.editReply('⛔ Απορρίφθηκε.');
      } catch (e) {
        console.error('reject error', e);
        return interaction.editReply('❌ Κάτι πήγε στραβά στο reject.');
      }
    }

    // --- Contact ("Ενδιαφέρομαι") ---
    if (action === 'contact') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const p = pendingApprovals.get(pid);
        if (!p) return interaction.editReply('❌ Η αγγελία δεν βρέθηκε.');

        const member = interaction.member as GuildMember;
        const uid = interaction.user.id;

        // Self-interest block (εκτός αν mod)
        if (uid === p.requesterId && !isMod(member)) {
          return interaction.editReply('🙅 Δεν μπορείς να ενδιαφερθείς στη **δική σου** αγγελία.');
        }

        // Πρέπει να υπάρχει δημοσιευμένο μήνυμα
        if (!p.postedChannelId || !p.postedMessageId) {
          return interaction.editReply('⚠️ Δεν έχει δημοσιευτεί ακόμη το public post.');
        }
        const channel: any = interaction.guild!.channels.cache.get(p.postedChannelId);
        const postMessage = await channel.messages.fetch(p.postedMessageId);

        // ✅ PRIVATE thread (ΟΧΙ message.startThread αν γίνεται)
        let thread: ThreadChannel;
        try {
          thread = await channel.threads.create({
            name: `deal • ${p.kind === 'trade' ? (p.offerTitle ?? '—') : (p.cardName ?? '—')} — ${interaction.user.username}`,
            autoArchiveDuration: 1440,
            type: ChannelType.PrivateThread,
            reason: `Private deal thread for PID ${p.pid}`,
          });
        } catch {
          // Fallback: public thread πάνω στο μήνυμα
          thread = await postMessage.startThread({
            name: `deal • ${p.kind === 'trade' ? (p.offerTitle ?? '—') : (p.cardName ?? '—')} — ${interaction.user.username}`,
            autoArchiveDuration: 1440,
          }) as ThreadChannel;
          await thread.send('⚠️ Δεν ήταν δυνατή η δημιουργία private thread. Δημιουργήθηκε public ως fallback.');
        }

        // πρόσθεσε seller + buyer στο thread
        try { await thread.members.add(p.requesterId); } catch {}
        try { await thread.members.add(uid); } catch {}

        // Controls + link στο original post για context
        const origEmbed = postMessage.embeds?.[0];
        let threadEmbed;
        if (origEmbed) {
          threadEmbed = EmbedBuilder.from(origEmbed);
        } else {
          // Fallback – αν για κάποιο λόγο δεν είχε embed το public post
          threadEmbed = buildPublicPostEmbed({
            approval: {
              pid: p.pid,
              kind: p.kind,
              title: p.kind === 'trade'
                ? `${p.offerTitle ?? '—'} ↔ ${p.wantTitle ?? '—'}`
                : (p.cardName ?? '—'),
              quantity: p.quantity ?? undefined,
              price: p.price ?? undefined,
              offerTitle: p.offerTitle,
              offerQty: p.offerQty,
              wantTitle: p.wantTitle,
              wantQty: p.wantQty,
              cashDelta: p.cashDelta,
              location: p.location ?? undefined,
              extra: p.extra ?? undefined,
              requesterId: p.requesterId,
            },
          });
          if (p.photo1) threadEmbed.setImage(p.photo1.url);
          if (p.photo2) threadEmbed.addFields({ name: 'Επιπλέον φωτό', value: p.photo2.url });
        }

        await thread.send({
          content: `🔔 Thread controls — πατήστε **Ολοκληρώθηκε** όταν τελειώσετε (και οι δύο).
🔗 Σύνδεσμος στο post: ${postMessage.url}`,
          embeds: [threadEmbed],
          components: [buildCommThreadRow(pid)],
        });

        // ενημέρωσε state / CASE
        p.contacts.add(uid);
        p.buyerId = uid;
        p.commThreadIds = Array.from(new Set([...(p.commThreadIds ?? []), thread.id]));
        pendingApprovals.set(pid, p);

        const caseThread: any = interaction.guild!.channels.cache.get(p.caseThreadId);
        caseThread?.send(`📬 New interest by ${interaction.user} — άνοιξε **${thread.type === ChannelType.PrivateThread ? 'private' : 'public'}** thread <#${thread.id}>.`);

        // refresh CASE (μένει OPEN)
        await refreshCaseSummary(p);

        return interaction.editReply('🧵 Δημιουργήθηκε **private** thread επικοινωνίας.');
      } catch (e) {
        console.error('contact error', e);
        return interaction.editReply('❌ Κάτι πήγε στραβά.');
      }
    }

    // --- Complete (στο comm thread) ---
    if (action === 'complete') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const p = pendingApprovals.get(pid);
        if (!p) return interaction.editReply('❌ Η αγγελία δεν βρέθηκε.');

        const member = interaction.member as GuildMember;
        const uid = interaction.user.id;
        const isSeller = uid === p.requesterId;
        const isBuyer = uid === p.buyerId;

        // 1η επιβεβαίωση
        if (!p.firstConfirmBy) {
          p.firstConfirmBy = uid;
          p.firstConfirmAt = Date.now();
          if (isSeller) p.sellerConfirmed = true;
          if (isBuyer) p.buyerConfirmed = true;
          pendingApprovals.set(pid, p);

          const caseThread: any = interaction.guild!.channels.cache.get(p.caseThreadId);
          caseThread?.send(`🕒 1η επιβεβαίωση από ${interaction.user} — περιμένουμε τον άλλο χρήστη (72h).`);

          // 🔊 Δημοσίευση στο private comm thread (τρέχον κανάλι)
          const commThread = interaction.channel;
          if (commThread && 'isThread' in commThread && commThread.isThread()) {
            const thread = commThread as ThreadChannel;
            await ensureBotInPrivate(thread);
            await thread.send(`✅ 1η επιβεβαίωση καταγράφηκε από ${interaction.user}. Περιμένουμε την άλλη πλευρά (72h).`);
          }

          await refreshCaseSummary(p);
          try { await interaction.deleteReply(); } catch {}
          return;
        }

        // 2η επιβεβαίωση — πρέπει να είναι άλλος, εκτός αν είναι mod
        if (p.firstConfirmBy === uid && !isMod(member)) {
          return interaction.editReply('ℹ️ Έχεις ήδη επιβεβαιώσει. Περιμένουμε την άλλη πλευρά (ή mod).');
        }

        // Συμπλήρωση ποιος είναι buyer/seller για το embed του public
        let sellerId: string;
        let buyerId: string;

        if (p.kind === 'sell') {
          sellerId = p.requesterId;
          const other = uid === p.requesterId ? p.firstConfirmBy! : uid;
          buyerId = other;
        } else if (p.kind === 'buy') {
          buyerId = p.requesterId;
          const other = uid === p.requesterId ? p.firstConfirmBy! : uid;
          sellerId = other;
        } else {
          // trade: δύο traders, απλώς ορίζουμε A/B για εμφάνιση
          sellerId = p.requesterId;
          const other = uid === p.requesterId ? p.firstConfirmBy! : uid;
          buyerId = other;
        }
        p.buyerId = buyerId;
        p.sellerConfirmed = p.sellerConfirmed || sellerId === p.firstConfirmBy || sellerId === uid;
        p.buyerConfirmed = p.buyerConfirmed || buyerId === p.firstConfirmBy || buyerId === uid;

        p.status = 'completed';
        pendingApprovals.set(pid, p);

        // Edit public post → [SOLD]/[BOUGHT]/[TRADED] + disable row
        if (p.postedChannelId && p.postedMessageId) {
          const channel: any = interaction.guild!.channels.cache.get(p.postedChannelId);
          const message = await channel.messages.fetch(p.postedMessageId);
          const updated = buildPublicPostEmbed({
            approval: {
              pid: p.pid,
              kind: p.kind,
              title: p.kind === 'trade'
                ? `${p.offerTitle ?? '—'} ↔ ${p.wantTitle ?? '—'}`
                : (p.cardName ?? '—'),
              quantity: p.quantity ?? undefined,
              price: p.price ?? undefined,
              offerTitle: p.offerTitle,
              offerQty: p.offerQty,
              wantTitle: p.wantTitle,
              wantQty: p.wantQty,
              cashDelta: p.cashDelta,
              location: p.location ?? undefined,
              extra: p.extra ?? undefined,
              requesterId: p.requesterId,
            },
            statusTag: p.kind === 'sell' ? 'sold' : p.kind === 'buy' ? 'bought' : 'traded',
            dealBetween: { sellerId, buyerId },
          });
          await message.edit({ embeds: [updated], components: [buildPublicPostRow(false, pid)] });
        }

        // Κλείδωμα/αρχειοθέτηση όλων των comm threads (fetch + one-shot edit)
        const currentThreadId = (interaction.channel as ThreadChannel | null)?.id;
        for (const tid of p.commThreadIds ?? []) {
          try {
            const th = await fetchThreadSafe(interaction.guild!, tid);
            if (!th) {
              console.warn('[market] comm thread not found on complete:', tid);
              continue;
            }
            const note = tid !== currentThreadId
              ? `ℹ️ Η αγγελία ολοκληρώθηκε με <@${sellerId}> ↔ <@${buyerId}>. Το thread κλειδώνει & αρχειοθετείται.`
              : '🏁 Το deal ολοκληρώθηκε. Το thread κλειδώνει & αρχειοθετείται.';
            await lockAndArchiveThread(th, note);
          } catch (e) {
            console.error('[market] complete: lock/archive failed for', tid, e);
          }
        }

        const caseThread: any = interaction.guild!.channels.cache.get(p.caseThreadId);
        caseThread?.send(`🏁 Completed — <@${sellerId}> ↔ <@${buyerId}>.`);

        await refreshCaseSummary(p);
        try { await interaction.deleteReply(); } catch {}
        return;
      } catch (e) {
        console.error('complete error', e);
        return interaction.editReply('❌ Κάτι πήγε στραβά στο complete.');
      }
    }

    // --- Close (από mod/owner) ---
    if (action === 'close') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const p = pendingApprovals.get(pid);
        if (!p) return interaction.editReply('❌ Η αγγελία δεν βρέθηκε/ή δεν έχει CASE.');

        const member = interaction.member as GuildMember;
        const isOwner = interaction.user.id === p.requesterId;
        if (!isOwner && !isMod(member)) {
          return interaction.editReply('⛔ Μόνο owner ή mod μπορεί να κλείσει την αγγελία.');
        }

        // edit public post → [CLOSED] + disable row
        const channel: any = interaction.guild!.channels.cache.get(p.postedChannelId!);
        if (channel && p.postedMessageId) {
          const message = await channel.messages.fetch(p.postedMessageId);
          const orig = message.embeds?.[0];
          if (orig) {
            const updated = EmbedBuilder.from(orig).setTitle(`[CLOSED] ${orig.title}`);
            const disabledRow = buildPublicPostRow(false, pid);
            await message.edit({ embeds: [updated], components: [disabledRow] });
          }
        }

        // κλείδωσε/αρχειοθέτησε όλα τα comm threads (fetch + one-shot edit)
        for (const tid of p.commThreadIds ?? []) {
          try {
            const th = await fetchThreadSafe(interaction.guild!, tid);
            if (!th) {
              console.warn('[market] comm thread not found on close:', tid);
              continue;
            }
            await lockAndArchiveThread(th, '🔒 Η αγγελία έκλεισε. Το thread κλειδώνει & αρχειοθετείται.');
          } catch (e) {
            console.error('[market] close: lock/archive failed for', tid, e);
          }
        }

        // refresh CASE status
        p.status = 'closed';
        pendingApprovals.set(pid, p);
        await refreshCaseSummary(p);

        // log στο CASE
        if (p.caseThreadId) {
          const caseThread: any = interaction.guild!.channels.cache.get(p.caseThreadId);
          caseThread?.send(`🔒 Κλείσιμο αγγελίας από ${isOwner ? 'owner' : 'mod'} ${interaction.user}.`);
        }

        return interaction.editReply('🔒 Η αγγελία έκλεισε.');
      } catch (e) {
        console.error('close error', e);
        return interaction.editReply('❌ Κάτι πήγε στραβά στο close.');
      }
    }

    // --- Mod Resolve (placeholder – μόνο log) ---
    if (action === 'resolve') {
      if (!interaction.isButton()) return;
      await interaction.reply({ content: '🛡️ Mod Resolve (placeholder)', flags: MessageFlags.Ephemeral });
      return;
    }
  });
}

/* =========================================================
   Helpers to persist approved posts
========================================================= */

type Approved = {
  pid: string;
  guildId?: string;
  channelId?: string;
  messageId?: string;
};

function saveApprovedPost(entry: Approved) {
  const data = readJson<Approved[]>(FILES.approvals, []);
  const idx = data.findIndex((x) => x.pid === entry.pid);
  if (idx >= 0) data[idx] = entry;
  else data.push(entry);
  writeJsonAtomic(FILES.approvals, data);
}