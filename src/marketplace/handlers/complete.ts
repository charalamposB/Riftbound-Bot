import { ThreadChannel, ChannelType, MessageFlags } from 'discord.js';
import { buildPublicPostEmbed } from '../ui/embeds';
import { buildPublicPostRow } from '../ui/components';
import { persistApproval } from '../lib/persistence';

export async function handleComplete(
  interaction: any,
  pid: string,
  loadApproval: (pid: string) => any,
  pendingApprovals: Map<string, any>,
  refreshCaseSummary: (p: any) => Promise<void>,
  fetchThreadSafe: (guild: any, id: string) => Promise<any>,
  lockAndArchiveThread: (thread: any, msg?: string) => Promise<void>,
) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const p = loadApproval(pid);
    if (!p) return interaction.editReply('❌ Η αγγελία δεν βρέθηκε.');

    // Minimal safe completion: mark completed, persist, update public post and archive comm threads
    p.status = 'completed';
    pendingApprovals.set(pid, p);
    try { await persistApproval(p); } catch (e) { console.error('[market] persist after complete failed', e); }

    if (p.postedChannelId && p.postedMessageId) {
      try {
        const channel: any = interaction.guild!.channels.cache.get(p.postedChannelId);
        const message = await channel.messages.fetch(p.postedMessageId);
        const updated = buildPublicPostEmbed({
          approval: {
            pid: p.pid,
            kind: p.kind,
            title: p.kind === 'trade' ? `${p.offerTitle ?? '—'} ↔ ${p.wantTitle ?? '—'}` : (p.cardName ?? '—'),
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
          status: p.status,
          statusTag: p.kind === 'sell' ? 'sold' : p.kind === 'buy' ? 'bought' : 'traded',
        });
        await message.edit({ embeds: [updated], components: [buildPublicPostRow(false, pid)] });
      } catch (e) {
        console.error('[market] complete: update public post failed', e);
      }
    }

    const currentThreadId = (interaction.channel as ThreadChannel | null)?.id;
    for (const tid of p.commThreadIds ?? []) {
      try {
        const th = await fetchThreadSafe(interaction.guild!, tid);
        if (!th) {
          console.warn('[market] comm thread not found on complete:', tid);
          continue;
        }
        const note = tid !== currentThreadId
          ? `ℹ️ Η αγγελία ολοκληρώθηκε. Το thread κλειδώνει & αρχειοθετείται.`
          : '🏁 Το deal ολοκληρώθηκε. Το thread κλειδώνει & αρχειοθετείται.';
        await lockAndArchiveThread(th, note);
      } catch (e) {
        console.error('[market] complete: lock/archive failed for', tid, e);
      }
    }

    const caseThread: any = interaction.guild!.channels.cache.get(p.caseThreadId);
    caseThread?.send(`🏁 Completed — ${interaction.user}.`);

    await refreshCaseSummary(p);
    try { await interaction.deleteReply(); } catch {}
    return;
  } catch (e) {
    console.error('complete error', e);
    return interaction.editReply('❌ Κάτι πήγε στραβά στο complete.');
  }
}

export default {};
