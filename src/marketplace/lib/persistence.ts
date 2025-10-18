// src/marketplace/lib/persistence.ts
import * as pendingStore from '../../lib/pendingStore';

export function toStoreApproval(p: any): pendingStore.PendingApproval {
  return {
    pid: p.pid,
    guildId: p.guildId ?? '',
    requesterId: p.requesterId,
    kind: p.kind as any,
    cardName: p.cardName ?? (p.offerTitle ?? ''),
    quantity: p.quantity ?? 1,
    price: p.price ?? null,
    location: p.location ?? '',
    extra: p.extra ?? null,
    photo1: p.photo1 ? { id: p.photo1.id ?? '', url: p.photo1.url, name: p.photo1.name ?? '' } : undefined,
    photo2: p.photo2 ? { id: p.photo2.id ?? '', url: p.photo2.url, name: p.photo2.name ?? '' } : undefined,
    caseThreadId: p.caseThreadId,
    caseMessageId: p.caseMessageId,
    postedChannelId: p.postedChannelId,
    postedMessageId: p.postedMessageId,
    contacts: p.contacts ?? [],
    createdAt: Date.now(),
  } as pendingStore.PendingApproval;
}

export async function persistApproval(p: any) {
  return pendingStore.setApproval(toStoreApproval(p));
}

export function getApprovalFromStore(pid: string): any | undefined {
  const s = pendingStore.getApproval(pid);
  if (!s) return undefined;
  return {
    pid: s.pid,
    kind: s.kind,
    cardName: s.cardName,
    quantity: s.quantity,
    price: s.price ?? null,
    location: s.location,
    extra: s.extra ?? '',
    photo1: s.photo1 ? { url: s.photo1.url } : undefined,
    photo2: s.photo2 ? { url: s.photo2.url } : undefined,
    caseThreadId: s.caseThreadId,
    caseMessageId: s.caseMessageId,
    postedChannelId: s.postedChannelId,
    postedMessageId: s.postedMessageId,
    requesterId: s.requesterId,
    contacts: s.contacts ?? [],
    status: 'pending',
    commThreadIds: [],
  };
}

export function deleteApproval(pid: string) {
  return pendingStore.deleteApproval(pid);
}

export default {};
