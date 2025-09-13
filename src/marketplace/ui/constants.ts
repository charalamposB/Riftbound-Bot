// Χρώματα & σταθερές που θα ξαναχρησιμοποιούμε παντού.

export const COLORS = {
  pending: 0xF1C40F,   // κίτρινο
  open: 0x3498DB,      // μπλε
  closed: 0x95A5A6,    // γκρι
  completed: 0x2ECC71, // πράσινο
  resolved: 0xE67E22,  // πορτοκαλί
  default: 0x2f3136,   // default embed bg
} as const;

export const EMOJI = {
  check: '✅',
  hourglass: '🕒',
  interest: '📬',
  lock: '🔒',
  flag: '🏁',
} as const;

export const CONFIRM_DEADLINE_HOURS = 72;

export const LABELS = {
  sold: '[SOLD]',
  bought: '[BOUGHT]',
  closed: '[CLOSED]',
  traded: '[TRADED]',   // <-- για trade
} as const;