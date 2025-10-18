import { ThreadChannel, ChannelType, MessageFlags, GuildMember, EmbedBuilder } from 'discord.js';
import { buildPublicPostEmbed } from '../ui/embeds';
import { buildCommThreadRow } from '../ui/components';
import { extFromUrl, uniquePush, buildFilesFromPhotos } from '../lib/images';
import { persistApproval } from '../lib/persistence';

export async function handleContact(
	interaction: any,
	pid: string,
	loadApproval: (pid: string) => any,
	pendingApprovals: Map<string, any>,
	refreshCaseSummary: (p: any) => Promise<void>,
	isMod: (m: GuildMember | null | undefined) => boolean,
) {
	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const p = loadApproval(pid);
		if (!p) return interaction.editReply('❌ Η αγγελία δεν βρέθηκε.');

		const member = interaction.member as GuildMember;
		const uid = interaction.user.id;

		if (uid === p.requesterId && !isMod(member)) {
			return interaction.editReply('🙅 Δεν μπορείς να ενδιαφερθείς στη **δική σου** αγγελία.');
		}

		if (!p.postedChannelId || !p.postedMessageId) {
			return interaction.editReply('⚠️ Δεν έχει δημοσιευτεί ακόμη το public post.');
		}
		const channel: any = interaction.guild!.channels.cache.get(p.postedChannelId);
		const postMessage = await channel.messages.fetch(p.postedMessageId);

		let thread: ThreadChannel;
		try {
			thread = await channel.threads.create({
				name: `deal • ${p.kind === 'trade' ? (p.offerTitle ?? '—') : (p.cardName ?? '—')} — ${interaction.user.username}`,
				autoArchiveDuration: 1440,
				type: ChannelType.PrivateThread,
				reason: `Private deal thread for PID ${p.pid}`,
			});
		} catch {
			thread = await postMessage.startThread({
				name: `deal • ${p.kind === 'trade' ? (p.offerTitle ?? '—') : (p.cardName ?? '—')} — ${interaction.user.username}`,
				autoArchiveDuration: 1440,
			}) as ThreadChannel;
			await thread.send('⚠️ Δεν ήταν δυνατή η δημιουργία private thread. Δημιουργήθηκε public ως fallback.');
		}

		try { await thread.members.add(p.requesterId); } catch {}
		try { await thread.members.add(uid); } catch {}

		const origEmbed = postMessage.embeds?.[0];
		let threadEmbed;
		const threadFiles: any[] = [];
		if (origEmbed) {
			threadEmbed = EmbedBuilder.from(origEmbed);
		} else {
			threadEmbed = buildPublicPostEmbed({
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
				status: p.status ?? 'open',
			});
			if (p.photo1) {
				const name1 = `deal_${p.pid}_1${extFromUrl(p.photo1.url)}`;
				threadFiles.push({ attachment: p.photo1.url, name: name1 });
				threadEmbed.setImage(`attachment://${name1}`);
			}
			if (p.photo2) {
				const name2 = `deal_${p.pid}_2${extFromUrl(p.photo2.url)}`;
				threadFiles.push({ attachment: p.photo2.url, name: name2 });
				threadEmbed.addFields({ name: '📷 Επιπλέον φωτό', value: `[Δείτε εδώ](${p.photo2.url})` });
			}
		}

		await thread.send({
			content: `🔔 Thread controls — πατήστε **Ολοκληρώθηκε** όταν τελειώσετε (και οι δύο).\n🔗 Σύνδεσμος στο post: ${postMessage.url}`,
			embeds: [threadEmbed],
			components: [buildCommThreadRow(pid)],
			files: threadFiles.length ? threadFiles : undefined,
		});

		uniquePush(p.contacts, uid);
		p.buyerId = uid;
		p.commThreadIds = Array.from(new Set([...(p.commThreadIds ?? []), thread.id]));
		pendingApprovals.set(pid, p);
		try { await persistApproval(p); } catch (e) { console.error('[market] persist after contact failed', e); }

		const caseThread: any = interaction.guild!.channels.cache.get(p.caseThreadId);
		caseThread?.send(`📬 New interest by ${interaction.user} — άνοιξε **${thread.type === ChannelType.PrivateThread ? 'private' : 'public'}** thread <#${thread.id}>.`);

		await refreshCaseSummary(p);

		return interaction.editReply('🧵 Δημιουργήθηκε **private** thread επικοινωνίας.');
	} catch (e) {
		console.error('contact error', e);
		return interaction.editReply('❌ Κάτι πήγε στραβά.');
	}
}

export default {};
