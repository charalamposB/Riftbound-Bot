// src/marketplace/ui/components.ts
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'
import { EMOJI } from './constants'

/**
 * Κουμπιά για approve/reject/mod resolve
 */
export function buildCaseReviewRow(
  pid: string,
  opts?: { disableApproveReject?: boolean; modResolveEnabled?: boolean }
) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve:${pid}`)
      .setLabel('Approve')
      .setEmoji(EMOJI.check) // ✅
      .setStyle(ButtonStyle.Success)
      .setDisabled(!!opts?.disableApproveReject),

    new ButtonBuilder()
      .setCustomId(`reject:${pid}`)
      .setLabel('Reject')
      .setEmoji('❌') // ❌
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!!opts?.disableApproveReject),

    new ButtonBuilder()
      .setCustomId(`resolve:${pid}`)
      .setLabel('Mod Resolve')
      .setEmoji('🛡️') // 🛡️
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(opts?.modResolveEnabled === false),
  )
}

/**
 * Κουμπιά για public post (ενδιαφέρομαι / κλείσιμο)
 */
export function buildPublicPostRow(enabled: boolean, pid: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`contact:${pid}`)
      .setLabel('Ενδιαφέρομαι')
      .setEmoji('🙋') // 🙋
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!enabled),

    new ButtonBuilder()
      .setCustomId(`close:${pid}`)
      .setLabel('Κλείσιμο Αγγελίας')
      .setEmoji('🔒') // 🔒
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!enabled),
  )
}

/**
 * Κουμπιά για deal thread (complete)
 */
export function buildCommThreadRow(pid: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`complete:${pid}`)
      .setLabel('Ολοκληρώθηκε')
      .setEmoji('✅') // ✅
      .setStyle(ButtonStyle.Success),
  )
}