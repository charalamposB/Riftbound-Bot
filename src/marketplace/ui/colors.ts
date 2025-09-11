// src/marketplace/ui/colors.ts
import { COLORS } from './constants';
import type { CaseStatus } from '../types';

export function caseColor(status: CaseStatus): number {
  switch (status) {
    case 'pending':   return COLORS.pending;
    case 'open':      return COLORS.open;
    case 'closed':    return COLORS.closed;
    case 'completed': return COLORS.completed ?? COLORS.closed;
    case 'resolved':  return COLORS.resolved  ?? COLORS.closed;
    default:          return COLORS.default;
  }
}
