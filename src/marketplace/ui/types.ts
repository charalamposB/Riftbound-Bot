// src/marketplace/ui/types.ts
// ΜΟΝΟ UI-specific types. Κανένα Kind/CaseStatus/PendingApprovalLike εδώ.
export type UiSize = 'compact' | 'full';
import type { PendingApprovalLike, CaseStatus, Kind } from '../types';

export interface UiOptions {
  size?: UiSize;
}
