import { COLORS } from './constants';
import type { CaseStatus } from '../types';

export function caseColor(status: CaseStatus): number {
  const map: Record<CaseStatus, number> = {
    pending:   COLORS.pending,
    open:      COLORS.open,
    closed:    COLORS.closed,
    completed: COLORS.completed ?? COLORS.closed,
    resolved:  COLORS.resolved  ?? COLORS.closed,
  };
  return map[status] ?? COLORS.closed; // fallback χωρίς COLORS.default
}
