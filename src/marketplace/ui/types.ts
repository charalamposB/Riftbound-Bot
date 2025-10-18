// ΜΟΝΟ UI-specific types. Κανένα Kind/CaseStatus/PendingApprovalLike εδώ.
// src/marketplace/ui/types.ts
export type UiSize = 'compact' | 'full';

export interface UiOptions {
  size?: UiSize;
}