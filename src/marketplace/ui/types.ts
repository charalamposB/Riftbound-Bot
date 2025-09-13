// ΜΟΝΟ UI-specific types. Κανένα Kind/CaseStatus/PendingApprovalLike εδώ.

export type UiSize = 'compact' | 'full';

export interface UiOptions {
  size?: UiSize;
}