import { GuildMember, EmbedBuilder } from 'discord.js';
import { buildPublicPostRow } from '../ui/components';
import { persistApproval } from '../lib/persistence';

export async function handleClose(
  interaction: any,
  pid: string,
  loadApproval: (pid: string) => any,
  pendingApprovals: Map<string, any>,
  refreshCaseSummary: (p: any) => Promise<void>,
  isMod: (m: GuildMember | null | undefined) => boolean,
  fetchThreadSafe: (guild: any, id: string) => Promise<any>,
  lockAndArchiveThread: (thread: any, msg?: string) => Promise<void>,
) {
  try {
    await interaction.deferReply({ flags: (interaction as any).MessageFlags?.Ephemeral ?? 64 });

    const p = loadApproval(pid);
    if (!p) return interaction.editReply('❌ Η αγγελία δεν βρέθηκε/ή δεν έχει CASE.');

    const member = interaction.member as GuildMember;
    const isOwner = interaction.user.id === p.requesterId;
    if (!isOwner && !isMod(member)) {
      return interaction.editReply('⛔ Μόνο owner ή mod μπορεί να κλείσει την αγγελία.');
    }

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

    p.status = 'closed';
    pendingApprovals.set(pid, p);
    try { await persistApproval(p); } catch (e) { console.error('[market] persist after close failed', e); }
    await refreshCaseSummary(p);

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

export default {};
