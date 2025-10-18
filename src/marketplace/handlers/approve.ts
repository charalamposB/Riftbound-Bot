import { EmbedBuilder, GuildMember, MessageFlags } from 'discord.js';
import { buildPublicPostEmbed } from '../ui/embeds';
import { buildPublicPostRow } from '../ui/components';
import { buildFilesFromPhotos } from '../lib/images';
import { persistApproval } from '../lib/persistence';

export async function handleApprove(
  interaction: any,
  pid: string,
  loadApproval: (pid: string) => any,
  pendingApprovals: Map<string, any>,
  saveApprovedPost: (arg: any) => void,
  refreshCaseSummary: (p: any) => Promise<void>,
  env: (name: string) => string,
  isMod: (m: GuildMember | null | undefined) => boolean,
) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const payload = loadApproval(pid);
    if (!payload) return interaction.editReply('❌ Το CASE δεν βρέθηκε.');

  const member = interaction.member as GuildMember;
  if (!isMod(member)) return interaction.editReply('⛔ Μόνο mods μπορούν να κάνουν approve.');

    const isSell = payload.kind === 'sell';
    const isBuy = payload.kind === 'buy';
    const { kind } = payload;

    const displayTitle = kind === 'trade' ? `${payload.offerTitle ?? '—'} ↔ ${payload.wantTitle ?? '—'}` : payload.cardName ?? '—';

    const publicEmbed = buildPublicPostEmbed({
      approval: {
        pid,
        kind,
        title: displayTitle,
        quantity: payload.quantity ?? undefined,
        price: payload.price ?? undefined,
        offerTitle: payload.offerTitle,
        offerQty: payload.offerQty,
        wantTitle: payload.wantTitle,
        wantQty: payload.wantQty,
        cashDelta: payload.cashDelta,
        location: payload.location ?? undefined,
        extra: payload.extra ?? undefined,
        requesterId: payload.requesterId,
      },
      status: 'open',
    });

    if (payload.photo1) publicEmbed.setImage(payload.photo1.url);
    const files: any[] = buildFilesFromPhotos(pid, { photo1: payload.photo1, photo2: payload.photo2 });

  const targetId = isSell ? env('SELL_CHANNEL_ID') : isBuy ? env('BUY_CHANNEL_ID') : env('TRADE_CHANNEL_ID');
    const targetChannel: any = interaction.guild!.channels.cache.get(targetId!);
    if (!targetId || !targetChannel) return interaction.editReply('⚠️ Δεν βρέθηκε target κανάλι.');

    const row = buildPublicPostRow(true, pid);
    const postMsg = await targetChannel.send({ embeds: [publicEmbed], components: [row], files: files.length ? files : undefined });

    payload.postedMessageId = postMsg.id;
    payload.postedChannelId = targetChannel.id;
    payload.status = 'open';
    pendingApprovals.set(pid, payload);
    try { await persistApproval(payload); } catch {}

    saveApprovedPost({ pid, guildId: interaction.guildId ?? undefined, channelId: targetChannel.id, messageId: postMsg.id });

    await refreshCaseSummary(payload);
    return interaction.editReply(`✅ Δημοσιεύτηκε στο ${targetChannel.toString()}.`);
  } catch (e) {
    console.error('approve error', e);
    return interaction.editReply('❌ Κάτι πήγε στραβά στο approve.');
  }
}

export default {};
