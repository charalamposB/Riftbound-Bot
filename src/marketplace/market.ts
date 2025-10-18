// src/marketplace/market.ts
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
  ButtonBuilder,
  ButtonStyle,
  Message,
  Collection,
} from 'discord.js';

import { buildCaseReviewRow, buildPublicPostRow, buildCommThreadRow } from './ui/components';
import { buildPublicPostEmbed, buildCaseSummaryEmbed } from './ui/embeds';
import type { CaseStatus, Kind } from './types';

import fs from 'fs';
import * as pendingStore from '../lib/pendingStore';
import path from 'path';
import { photosToImages as _photosToImages, extFromUrl as _extFromUrl, uniquePush as _uniquePush, buildFilesFromPhotos } from './lib/images';
import { runWithLock as _runWithLock } from './lib/locks';
import { toStoreApproval as _toStoreApproval, persistApproval as _persistApproval, getApprovalFromStore as _getApprovalFromStore, deleteApproval as _deleteApproval } from './lib/persistence';

/* =========================================================
   Types (τοπικά για το αρχείο)
========================================================= */

type PendingSlash = {
  kind: Kind;
  photo1: any;
  photo2: any;
};

// ✨ Νέο: Pending για panel flow (modal → photo upload)
type PendingPanelPost = {
  userId: string;
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
  // shared
  location: string;
  extra: string;
  createdAt: number;
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

  requesterId: string;
  buyerId?: string;

  contacts: string[];
  status?: CaseStatus;
  firstConfirmBy?: string;
  firstConfirmAt?: number;
  sellerConfirmed?: boolean;
  buyerConfirmed?: boolean;

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

const photosToImages = _photosToImages;
const extFromUrl = _extFromUrl;
const uniquePush = _uniquePush;
const runWithLock = _runWithLock;
const toStoreApproval = _toStoreApproval;
const persistApproval = _persistApproval;
const getApprovalFromStore = _getApprovalFromStore;
const deleteApproval = _deleteApproval;

// Helper for dynamic imports: use .ts in development (ts-node-dev) and .js in production builds
function handlerImportPath(base: string) {
  const dev = process.env.NODE_ENV !== 'production';
  const ext = dev ? '.ts' : '.js';
  return `./handlers/${base}${ext}`;
}

/* ---------- THREAD HELPERS ---------- */

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

    const canManage = thread
      .permissionsFor(thread.client.user!.id)
      ?.has(PermissionsBitField.Flags.ManageThreads);
    if (!canManage) {
      console.error('[market] Missing ManageThreads for', thread.id, 'parent:', thread.parent?.name);
    }

    await thread.edit({ locked: true, archived: true }).catch((e) => {
      console.error('[market] edit(locked+archived) failed for', thread.id, e);
      throw e;
    });

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
   In-memory pending
========================================================= */

const pendingSlashToModal = new Map<string, PendingSlash>();
const pendingApprovals = new Map<string, PendingApproval>();

function loadApproval(pid: string): PendingApproval | undefined {
  const inMem = pendingApprovals.get(pid);
  if (inMem) return inMem;
  const fromStore = getApprovalFromStore(pid);
  if (fromStore) {
    pendingApprovals.set(pid, fromStore);
    return fromStore;
  }
  return undefined;
}

// ✨ Νέο: Pending για panel flow
const pendingPanelPosts = new Map<string, PendingPanelPost>();

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
   Helper: Δημιουργία CASE thread
========================================================= */

async function createCaseThread(params: {
  interaction: any;
  kind: Kind;
  displayTitle: string;
  cardName?: string;
  price?: number | null;
  quantity?: number;
  offerTitle?: string;
  offerQty?: number;
  wantTitle?: string;
  wantQty?: number;
  cashDelta?: number;
  location: string;
  extra: string;
  photo1?: { url: string } | null;
  photo2?: { url: string } | null;
}) {
  const {
    interaction,
    kind,
    displayTitle,
    cardName,
    price,
    quantity,
    offerTitle,
    offerQty,
    wantTitle,
    wantQty,
    cashDelta,
    location,
    extra,
    photo1,
    photo2,
  } = params;

  const LOG_ID = env('MARKET_LOG_CHANNEL_ID');
  const logChannel: any = interaction.guild?.channels.cache.get(LOG_ID);
  if (!logChannel) throw new Error('⚠️ Δεν βρέθηκε MARKET_LOG_CHANNEL_ID στο .env.');

  const stub = await logChannel.send(
    `🧾 Case for **${displayTitle}** από <@${interaction.user.id}> (${kind.toUpperCase()})`,
  );
  const caseThread = await stub.startThread({
    name: `CASE • ${displayTitle} — ${interaction.user.username}`,
    autoArchiveDuration: 10080,
    type: ChannelType.PrivateThread,
  });

  const pid = newId();

  // Build summary embed and attach files so previews don't rely on external/ephemeral URLs
  const summaryEmbed = buildCaseSummaryEmbed({
    approval: {
      pid,
      kind,
      title: displayTitle,
      quantity,
      price,
      offerTitle,
      offerQty,
      wantTitle,
      wantQty,
      cashDelta,
      location: kind === 'trade' ? undefined : location,
      extra: kind === 'trade' ? undefined : extra,
      requesterId: interaction.user.id,
      images: photosToImages(photo1, photo2),
    } as any,
    status: 'pending',
    sellerId: interaction.user.id,
    buyerId: undefined,
    contacts: [],
  });

  const files: any[] = [];
  if (photo1 && photo1.url) {
    const name1 = `case_${pid}_1${extFromUrl(photo1.url)}`;
    files.push({ attachment: photo1.url, name: name1 });
    summaryEmbed.setImage(`attachment://${name1}`);
  }
  if (photo2 && photo2.url) {
    const name2 = `case_${pid}_2${extFromUrl(photo2.url)}`;
    files.push({ attachment: photo2.url, name: name2 });
    // keep a clickable link for the second image as well
    summaryEmbed.addFields({ name: '📷 Επιπλέον φωτό', value: `[Δείτε εδώ](${photo2.url})` });
  }

  const caseMsg = await caseThread.send({
    content: `📝 **Νέα αγγελία προς έγκριση** από <@${interaction.user.id}> (${kind.toUpperCase()})`,
    embeds: [summaryEmbed],
    components: [buildCaseReviewRow(pid)],
    files: files.length ? files : undefined,
  });
  caseMsg.pin().catch(() => void 0);

  const newApproval: PendingApproval = {
    pid,
    kind,
    cardName,
    price: price ?? null,
    quantity: quantity ?? 1,
    offerTitle,
    offerQty,
    wantTitle,
    wantQty,
    cashDelta,
    location: location ?? '',
    extra: extra ?? '',
    photo1,
    photo2,
    caseThreadId: caseThread.id,
    caseMessageId: caseMsg.id,
    contacts: [],
    requesterId: interaction.user.id,
    status: 'pending',
    commThreadIds: [],
  };

  pendingApprovals.set(pid, newApproval);
  try { await persistApproval(newApproval); } catch (e) { console.error('[market] persistApproval failed', e); }

  return { pid, displayTitle };
}

/* =========================================================
   Register interactions
========================================================= */

export function registerMarketInteractions(client: Client) {
  // initialize pendingStore asynchronously
  pendingStore.init().catch((e) => console.error('[market] pendingStore.init failed', e));

  client.on('interactionCreate', async (interaction: Interaction) => {
    // ----- Slash /market post → show modal -----
    if (interaction.isChatInputCommand() && interaction.commandName === 'market') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'post') {
        const kind = interaction.options.getString('kind', true) as Kind;
        const photo1 = interaction.options.getAttachment('photo1');
        const photo2 = interaction.options.getAttachment('photo2');

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

    // ----- Modal submit: SLASH command (marketPost) -----
    if (interaction.isModalSubmit() && interaction.customId === 'marketPost') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const saved = pendingSlashToModal.get(interaction.user.id);
        pendingSlashToModal.delete(interaction.user.id);
        if (!saved)
          return interaction.editReply('❌ Δεν βρέθηκαν τα αρχικά στοιχεία. Ξαναδοκίμασε το `/market post`.');

        const { kind, photo1, photo2 } = saved as { kind: Kind; photo1: any; photo2: any };

        let cardName: string | undefined;
        let quantity: number | undefined;
        let price: number | null | undefined;
        let offerTitle: string | undefined;
        let offerQty: number | undefined;
        let wantTitle: string | undefined;
        let wantQty: number | undefined;
        let cashDelta: number | undefined;
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

        const displayTitle = kind === 'trade'
          ? `${offerTitle} ↔ ${wantTitle}`
          : cardName!;

        const { pid } = await createCaseThread({
          interaction,
          kind,
          displayTitle,
          cardName,
          price,
          quantity,
          offerTitle,
          offerQty,
          wantTitle,
          wantQty,
          cashDelta,
          location,
          extra,
          photo1: photo1 ? { url: photo1.url } : null,
          photo2: photo2 ? { url: photo2.url } : null,
        });

        return interaction.editReply(`📌 Δημιουργήθηκε CASE για **${displayTitle}** (pid=${pid}).`);
      } catch (e) {
        console.error('modal submit error', e);
        return interaction.editReply('❌ Κάτι πήγε στραβά.');
      }
    }

    // ✨ ----- Modal submit: PANEL flow (marketPost-sell/buy/trade) -----
    if (interaction.isModalSubmit() && interaction.customId.startsWith('marketPost-')) {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const kind = interaction.customId.split('-')[1] as Kind;

        let cardName: string | undefined;
        let quantity: number | undefined;
        let price: number | null | undefined;
        let offerTitle: string | undefined;
        let offerQty: number | undefined;
        let wantTitle: string | undefined;
        let wantQty: number | undefined;
        let cashDelta: number | undefined;
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

        // Αποθήκευση pending state
        pendingPanelPosts.set(interaction.user.id, {
          userId: interaction.user.id,
          kind,
          cardName,
          price,
          quantity,
          offerTitle,
          offerQty,
          wantTitle,
          wantQty,
          cashDelta,
          location,
          extra,
          createdAt: Date.now(),
        });

        // ✨ Follow-up: Ζητάει φωτογραφίες (2 επιλογές)
        const uploadEmbed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle('📷 Ανέβασε φωτογραφίες')
          .setDescription(
            `Επίλεξε πώς θέλεις να ανεβάσεις τις φωτογραφίες:\n\n` +
            `📎 **Upload από υπολογιστή** (συνιστάται)\n\n` +
            `**Αγγελία:** ${kind === 'trade' ? `${offerTitle} ↔ ${wantTitle}` : cardName}\n` +
            `**Τύπος:** ${kind.toUpperCase()}`
          )
          .setFooter({ text: 'Έχεις 10 λεπτά να ολοκληρώσεις' });

        const uploadButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`upload-photos:${interaction.user.id}`)
            .setLabel('Upload Αρχεία')
            .setEmoji('📎')
            .setStyle(ButtonStyle.Primary)
        );

        return interaction.editReply({
          embeds: [uploadEmbed],
          components: [uploadButtons],
        });
      } catch (e) {
        console.error('panel modal submit error', e);
        return interaction.editReply('❌ Κάτι πήγε στραβά.');
      }
    }

    // ✨ ----- Button: Upload photos (follow-up) -----
    if (interaction.isButton() && interaction.customId.startsWith('upload-photos:')) {
      try {
        const userId = interaction.customId.split(':')[1];
        
        if (userId !== interaction.user.id) {
          return interaction.reply({
            content: '❌ Αυτό το κουμπί δεν είναι για σένα!',
            flags: MessageFlags.Ephemeral,
          });
        }

        const pending = pendingPanelPosts.get(userId);
        if (!pending) {
          return interaction.reply({
            content: '❌ Η προσωρινή αγγελία έχει λήξει. Δοκίμασε ξανά από την αρχή.',
            flags: MessageFlags.Ephemeral,
          });
        }

        // Type guard: έλεγχος αν το channel υποστηρίζει message collector
        if (!interaction.channel || !('createMessageCollector' in interaction.channel)) {
          return interaction.reply({
            content: '❌ Αυτό το κανάλι δεν υποστηρίζει upload αρχείων. Μετακινήσου σε κανάλι που υποστηρίζει attachments και δοκίμασε ξανά.',
            flags: MessageFlags.Ephemeral,
          });
        }

        // 📸 Ζητάμε να ανεβάσει φωτογραφίες ως attachments
        await interaction.reply({
          content: 
            '📸 **Ανέβασε τις φωτογραφίες σου τώρα!**\n\n' +
            '✅ Στείλε **1 ή 2 φωτογραφίες** (jpg, png, webp)\n' +
            '⏱️ Έχεις **2 λεπτά** να τις ανεβάσεις\n' +
            '📎 Attach τα αρχεία στο επόμενο μήνυμα\n\n' +
            '💡 **Tip:** Μπορείς να στείλεις και τις 2 μαζί!',
          flags: MessageFlags.Ephemeral,
        });

        // 🎯 Message collector για attachments
        const channel = interaction.channel;
        const filter = (m: any) => m.author.id === userId;
        const collector = channel.createMessageCollector({
          filter,
          time: 120_000, // 2 minutes
          max: 1,
        });

        collector.on('collect', async (message: any) => {
          try {
            const attachments = Array.from(message.attachments.values());
            
            // Validation: τουλάχιστον 1 φωτό
            if (attachments.length === 0) {
              await message.reply({
                content: '❌ Δεν βρέθηκαν φωτογραφίες! Δοκίμασε ξανά από την αρχή.',
              });
              pendingPanelPosts.delete(userId);
              return;
            }

            // Validation: μέγιστο 2 φωτό
            if (attachments.length > 2) {
              await message.reply({
                content: '⚠️ Μπορείς να στείλεις **μέχρι 2 φωτογραφίες**. Χρησιμοποιήθηκαν οι πρώτες 2.',
              });
            }

            // Validation: έλεγχος αν είναι images
            const validImages = (attachments as any[]).filter((att: any) => 
              att.contentType?.startsWith('image/')
            ).slice(0, 2);

            if (validImages.length === 0) {
              await message.reply({
                content: '❌ Τα αρχεία δεν είναι έγκυρες φωτογραφίες (jpg/png/webp)!',
              });
              pendingPanelPosts.delete(userId);
              return;
            }

            const photo1 = validImages[0] ? { url: validImages[0].url } : null;
            const photo2 = validImages[1] ? { url: validImages[1].url } : null;

            const displayTitle = pending.kind === 'trade'
              ? `${pending.offerTitle} ↔ ${pending.wantTitle}`
              : pending.cardName!;

            // ✅ Δημιουργία CASE
            const { pid } = await createCaseThread({
              interaction: { 
                ...interaction, 
                user: message.author,
                guild: message.guild,
              } as any,
              kind: pending.kind,
              displayTitle,
              cardName: pending.cardName,
              price: pending.price,
              quantity: pending.quantity,
              offerTitle: pending.offerTitle,
              offerQty: pending.offerQty,
              wantTitle: pending.wantTitle,
              wantQty: pending.wantQty,
              cashDelta: pending.cashDelta,
              location: pending.location,
              extra: pending.extra,
              photo1,
              photo2,
            });

            // Cleanup
            pendingPanelPosts.delete(userId);

            // Διαγραφή του μηνύματος με τις φωτό (για να μην μείνει στο κανάλι)
            await message.delete().catch(() => void 0);

            // Επιβεβαίωση
            await interaction.followUp({
              content: `✅ **Η αγγελία σου δημιουργήθηκε!**\n\n📌 **${displayTitle}**\n🆔 PID: \`${pid}\`\n⏳ Στάλθηκε για έγκριση από moderators`,
              flags: MessageFlags.Ephemeral,
            });

          } catch (e) {
            console.error('photo collector error', e);
            await message.reply({
              content: '❌ Κάτι πήγε στραβά κατά την επεξεργασία των φωτογραφιών.',
            }).catch(() => void 0);
          }
        });

        collector.on('end', (collected: any, reason: string) => {
          if (reason === 'time' && collected.size === 0) {
            // Timeout - cleanup
            pendingPanelPosts.delete(userId);
            interaction.followUp({
              content: '⏱️ Το χρονικό όριο έληξε. Δοκίμασε ξανά από την αρχή.',
              flags: MessageFlags.Ephemeral,
            }).catch(() => void 0);
          }
        });

      } catch (e) {
        console.error('upload-photos button error', e);
      }
    }

    // (Paste-URL flow removed — uploads-only enforced)

    // ----- Button handlers (existing code continues...) -----
    if (!interaction.isButton()) return;
    const [action, pid] = interaction.customId.split(':');

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
            images: photosToImages(p.photo1 ?? null, p.photo2 ?? null),
          } as any,
          status: (p.status ?? 'pending') as CaseStatus,
          sellerId: p.requesterId,
          buyerId: p.buyerId,
          sellerConfirmed: !!p.sellerConfirmed,
          buyerConfirmed: !!p.buyerConfirmed,
          contacts: (p.contacts ?? []).slice(-3),
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
      const { handleApprove } = await import(handlerImportPath('approve'));
      return handleApprove(interaction, pid, loadApproval, pendingApprovals, saveApprovedPost, refreshCaseSummary, env, isMod);
    }

    // --- Reject ---
    if (action === 'reject') {
      const { handleReject } = await import(handlerImportPath('reject'));
      return handleReject(interaction, pid, loadApproval, pendingApprovals, refreshCaseSummary, isMod);
    }

    // --- Contact ("Ενδιαφέρομαι") ---
    if (action === 'contact') {
      const { handleContact } = await import(handlerImportPath('contact'));
      return handleContact(interaction, pid, loadApproval, pendingApprovals, refreshCaseSummary, isMod);
    }

    // --- Close (από mod/owner) ---
    if (action === 'close') {
      const { handleClose } = await import(handlerImportPath('close'));
      return handleClose(interaction, pid, loadApproval, pendingApprovals, refreshCaseSummary, isMod, fetchThreadSafe, lockAndArchiveThread);
    }

    // --- Mod Resolve (placeholder – delegate to handler) ---
    if (action === 'resolve') {
      const { handleResolve } = await import(handlerImportPath('modResolve'));
      return handleResolve(interaction, pid);
    }

    // --- Complete (deal finished in a comm thread) ---
    if (action === 'complete') {
      const { handleComplete } = await import(handlerImportPath('complete'));
      return handleComplete(interaction, pid, loadApproval, pendingApprovals, refreshCaseSummary, fetchThreadSafe, lockAndArchiveThread);
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

// Optional: load persisted approvals into memory (call from index.ts if desired)
export async function loadPersistedApprovals() {
  try {
    await pendingStore.init();
    // load all approvals from pendingStore.mem -- helper not exposed, so read via getApproval keys is limited
    // We can load known files by reading the file directly, but keep it simple: no-op here.
  } catch (e) {
    console.error('[market] loadPersistedApprovals failed', e);
  }
}