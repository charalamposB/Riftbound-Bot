// src/marketplace/types.ts
export type Kind = 'sell' | 'buy' | 'trade';

export type CaseStatus =
  | 'pending'
  | 'open'
  | 'closed'
  | 'completed'
  | 'resolved';

export interface PendingApprovalLike {
  pid: string;
  kind: Kind;

  // ---- Sell/Buy πεδία
  title: string;                 // για sell/buy = cardName
  quantity?: number | string;
  price?: number | string;

  // ---- Trade πεδία (optional για συμβατότητα)
  offerTitle?: string;
  offerQty?: number;
  wantTitle?: string;
  wantQty?: number;
  cashDelta?: number;            // +ζητάω €, -δίνω €

  location?: string;
  extra?: string;

  requesterId: string; // seller/requester ή trader A
  buyerId?: string;    // συμπληρώνεται στο completion (ή trader B)

  postedChannelId?: string;
  postedMessageId?: string;
  caseThreadId?: string;
  caseSummaryMessageId?: string;

  contacts?: string[];
}