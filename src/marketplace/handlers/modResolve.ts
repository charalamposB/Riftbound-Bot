import { MessageFlags } from 'discord.js';

export async function handleResolve(
  interaction: any,
  pid: string,
) {
  if (!interaction.isButton()) return;
  await interaction.reply({ content: '🛡️ Mod Resolve (placeholder)', flags: MessageFlags.Ephemeral });
  return;
}

export default {};
