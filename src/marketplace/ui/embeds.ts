import { EmbedBuilder, userMention } from 'discord.js';
import { caseColor } from './colors';
import { COLORS, LABELS } from './constants';
import type { PendingApprovalLike, CaseStatus } from '../types';

// ---- Price formatting (€) ----
const EURO_FMT = new Intl.NumberFormat('el-GR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
});
function formatEuro(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!isFinite(n)) return '—';
  return EURO_FMT.format(n); // π.χ. 15,00 €
}

const kindLabel = (k: string) =>
  k === 'sell'  ? '🟢 Πώληση / Sell' :
  k === 'buy'   ? '🔵 Αγορά / Buy'   :
                  '🟣 Ανταλλαγή / Trade';

// Helper: βρες εικόνες (υποστηρίζει είτε array είτε single imageUrl)
function getImages(approval: any): string[] {
  if (Array.isArray(approval.images)) return approval.images.filter(Boolean);
  if (typeof approval.imageUrl === 'string' && approval.imageUrl.length > 0) return [approval.imageUrl];
  return [];
}

/**
 * Case summary embed
 */
export function buildCaseSummaryEmbed(input: {
  status: CaseStatus;
  approval: PendingApprovalLike;
  sellerId?: string;
  buyerId?: string;
  contacts?: string[];
  sellerConfirmed?: boolean;
  buyerConfirmed?: boolean;
}): EmbedBuilder {
  const {
    status,
    approval,
    sellerId,
    buyerId,
    contacts,
    sellerConfirmed,
    buyerConfirmed,
  } = input;

  const yesNo = (v?: boolean) => (typeof v === 'boolean' ? (v ? '✅' : '❌') : '—');

  const displayTitle =
    approval.kind === 'trade'
      ? `${approval.offerTitle ?? '—'} ↔ ${approval.wantTitle ?? '—'}`
      : approval.title;

  const embed = new EmbedBuilder()
    .setColor(caseColor(status))
    .setTitle(`${kindLabel(approval.kind)} — ${displayTitle}`)
    .addFields(
      { name: '📌 Κατάσταση', value: `**${status}**`, inline: true },
      { name: '🏷️ Τύπος', value: approval.kind, inline: true },
    );

  // 🔁 Deal/Trade section στο CASE
  if (sellerId || buyerId) {
    if (approval.kind === 'trade') {
      const a = sellerId ? userMention(sellerId) : '—';
      const b = buyerId ? userMention(buyerId) : '—';
      embed.addFields({ name: '🤝 Trade', value: `${a} ↔ ${b}` });
    } else {
      const lines: string[] = [];
      if (sellerId) lines.push(`**Seller:** ${userMention(sellerId)}`);
      if (buyerId)  lines.push(`**Buyer:** ${userMention(buyerId)}`);
      embed.addFields({ name: '🤝 Deal', value: lines.join('\n') || '—' });
    }
  }

  if (typeof sellerConfirmed === 'boolean' || typeof buyerConfirmed === 'boolean') {
    embed.addFields({
      name: '✅ Επιβεβαιώσεις',
      value: `Seller: ${yesNo(sellerConfirmed)} • Buyer: ${yesNo(buyerConfirmed)}`,
    });
  }

  if (contacts && contacts.length) {
    embed.addFields({
      name: '📞 Contacts',
      value: contacts.slice(-3).join(', '),
    });
  }

  // --- Λεπτομέρειες ---
  const details: string[] = [];

  if (approval.kind === 'trade') {
    if (approval.offerTitle) details.push(`🎁 **Offer:** ${approval.offerTitle}${approval.offerQty ? ` (x${approval.offerQty})` : ''}`);
    if (approval.wantTitle)  details.push(`🎯 **Want:** ${approval.wantTitle}${approval.wantQty ? ` (x${approval.wantQty})` : ''}`);
    if (typeof approval.cashDelta === 'number')
      details.push(`💶 **Cash Diff:** ${
        approval.cashDelta > 0
          ? `+${formatEuro(approval.cashDelta)}`
          : approval.cashDelta < 0
            ? `-${formatEuro(Math.abs(approval.cashDelta))}`
            : '—'
      }`);
  } else {
    if (approval.price !== undefined && approval.price !== null) details.push(`💰 **Τιμή:** ${formatEuro(approval.price)}`);
    if (approval.quantity) details.push(`🔢 **Ποσότητα:** ${approval.quantity}`);
  }

  if (approval.location) details.push(`📍 **Περιοχή:** ${approval.location}`);
  if (approval.extra) details.push(`ℹ️ ${approval.extra}`);

  if (details.length) {
    embed.addFields({
      name: '📦 Λεπτομέρειες',
      value: details.join('\n'),
    });
  }

  // --- Εικόνες ---
  const imgs = getImages(approval);
  if (imgs[0]) embed.setImage(imgs[0]);
  if (imgs[1]) {
    embed.addFields({ name: '📷 Extra photo', value: `[Δείτε εδώ](${imgs[1]})` });
  }

  return embed;
}

/**
 * Public post embed
 */
export function buildPublicPostEmbed(input: {
  approval: PendingApprovalLike;
  status?: CaseStatus;
  statusTag?: 'closed' | 'sold' | 'bought' | 'traded' | '';
  dealBetween?: { sellerId: string; buyerId: string } | null;
  sellerId?: string;
  buyerId?: string;
}): EmbedBuilder {
  const {
    approval,
    status,
    statusTag = '',
    dealBetween,
    sellerId,
    buyerId,
  } = input;

  const tag =
    statusTag === 'closed' ? LABELS.closed :
    statusTag === 'sold'   ? LABELS.sold   :
    statusTag === 'bought' ? LABELS.bought :
    statusTag === 'traded' ? LABELS.traded : '';

  const titlePrefix = tag ? `${tag} ` : '';
  const color = status ? caseColor(status) : COLORS.open;

  const displayTitle =
    approval.kind === 'trade'
      ? `${approval.offerTitle ?? '—'} ↔ ${approval.wantTitle ?? '—'}`
      : approval.title;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${titlePrefix}${kindLabel(approval.kind)} — ${displayTitle}`);

  // Seller/Buyer (μόνο για sell/buy πριν το deal)
  if ((approval.kind === 'sell' || approval.kind === 'buy') && approval.requesterId) {
    if (approval.kind === 'sell') {
      embed.addFields({ name: '👤 Seller', value: userMention(approval.requesterId) });
    } else {
      embed.addFields({ name: '🙋 Buyer', value: userMention(approval.requesterId) });
    }
  }

  // Deal ή Trader ανάλογα με κατάσταση & kind
  const between = dealBetween ?? (sellerId && buyerId ? { sellerId, buyerId } : null);

  if (approval.kind === 'trade') {
    if (statusTag === 'traded' && between) {
      // ✅ Ολοκληρωμένο trade → δείξε δύο άτομα με ↔
      embed.addFields({
        name: '🤝 Trade',
        value: `${userMention(between.sellerId)} ↔ ${userMention(between.buyerId)}`,
      });
    } else {
      // ⏳ Ανοιχτό trade → δείξε (αν υπάρχει) τον υποψήφιο trader
      const traderId = between?.buyerId ?? approval.buyerId;
      embed.addFields({
        name: '👥 Trader',
        value: traderId ? userMention(traderId) : '— *(σε αναμονή επιβεβαίωσης)*',
      });
    }
  } else {
    // sell/buy: Deal μόνο όταν έχει ολοκληρωθεί/κλείσει, με labels Seller/Buyer
    if (between && (statusTag === 'sold' || statusTag === 'bought' || statusTag === 'closed')) {
      embed.addFields({
        name: '🤝 Deal',
        value: `Seller: ${userMention(between.sellerId)}\nBuyer: ${userMention(between.buyerId)}`,
      });
    }
  }

  // --- Λεπτομέρειες ---
  const details: string[] = [];

  if (approval.kind === 'trade') {
    if (approval.offerTitle) details.push(`🎁 **Offer:** ${approval.offerTitle}${approval.offerQty ? ` (x${approval.offerQty})` : ''}`);
    if (approval.wantTitle)  details.push(`🎯 **Want:** ${approval.wantTitle}${approval.wantQty ? ` (x${approval.wantQty})` : ''}`);
    if (typeof approval.cashDelta === 'number')
      details.push(`💶 **Cash Diff:** ${
        approval.cashDelta > 0
          ? `+${formatEuro(approval.cashDelta)}`
          : approval.cashDelta < 0
            ? `-${formatEuro(Math.abs(approval.cashDelta))}`
            : '—'
      }`);
  } else {
    if (approval.price !== undefined && approval.price !== null) details.push(`💰 **Τιμή:** ${formatEuro(approval.price)}`);
    if (approval.quantity) details.push(`🔢 **Ποσότητα:** ${approval.quantity}`);
  }

  if (approval.location) details.push(`📍 **Περιοχή:** ${approval.location}`);
  if (approval.extra) details.push(`ℹ️ ${approval.extra}`);

  if (details.length) {
    embed.addFields({ name: '📦 Λεπτομέρειες', value: details.join('\n') });
  }

  // --- Εικόνες ---
  const imgs = getImages(approval);
  if (imgs[0]) embed.setImage(imgs[0]);
  if (imgs[1]) embed.addFields({ name: '📷 Extra photo', value: `[Δείτε εδώ](${imgs[1]})` });

  return embed;
}