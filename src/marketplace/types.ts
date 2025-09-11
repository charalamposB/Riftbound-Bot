// src/marketplace/types.ts
export type Kind = 'sell' | 'buy';

export type CaseStatus =
  | 'pending'
  | 'open'
  | 'closed'
  | 'completed'
  | 'resolved';

export interface PendingApprovalLike {
  pid: string;
  kind: Kind;
  title: string;

  quantity?: number | string;
  price?: number | string;
  location?: string;
  extra?: string;

  requesterId: string; // seller/requester
  buyerId?: string;    // συμπληρώνεται στο completion

  postedChannelId?: string;
  postedMessageId?: string;
  caseThreadId?: string;
  caseSummaryMessageId?: string;

  contacts?: string[]; // για counter + last 3 στο CASE
}
