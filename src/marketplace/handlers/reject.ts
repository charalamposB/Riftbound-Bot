import { GuildMember, MessageFlags } from 'discord.js';

export async function handleReject(
  interaction: any,
  pid: string,
  loadApproval: (pid: string) => any,
  pendingApprovals: Map<string, any>,
  refreshCaseSummary: (p: any) => Promise<void>,
  isMod: (m: GuildMember | null | undefined) => boolean,
) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const payload = loadApproval(pid);
    if (!payload) return interaction.editReply('❌ Το CASE δεν βρέθηκε.');

    const member = interaction.member as GuildMember;
    if (!isMod(member)) return interaction.editReply('⛔ Μόνο mods μπορούν να απορρίψουν.');

    const caseThread: any = interaction.guild!.channels.cache.get(payload.caseThreadId);
    caseThread?.send(`❌ Απορρίφθηκε από ${interaction.user}.`);
    return interaction.editReply('⛔ Απορρίφθηκε.');
  } catch (e) {
    console.error('reject error', e);
    return interaction.editReply('❌ Κάτι πήγε στραβά στο reject.');
  }
}

export default {};
