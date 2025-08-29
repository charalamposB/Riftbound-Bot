// src/lib/helpers.ts
/**
 * Περιέχει helpers για ανάγνωση env μεταβλητών και parsing.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Ρίχνει σφάλμα αν δεν υπάρχει η env μεταβλητή ή είναι κενή.
 */
export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`)
  }
  return v.trim()
}

/**
 * Επιστρέφει env μεταβλητή ή fallback αν δεν υπάρχει/είναι κενή.
 */
export function optionalEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() !== '' ? v.trim() : fallback
}

/**
 * Μετατρέπει env boolean string σε boolean (π.χ. 'true', '1', 'yes').
 */
export function parseBoolean(name: string, fallback = false): boolean {
  const v = process.env[name]
  if (v == null) return fallback
  const normalized = v.trim().toLowerCase()
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized)
}

/**
 * Επιστρέφει το log level από env ή default.
 */
export function parseLogLevel(name: string, fallback: LogLevel = 'info'): LogLevel {
  const v = (process.env[name] || '').trim().toLowerCase()
  const allowed: LogLevel[] = ['debug', 'info', 'warn', 'error']
  return (allowed.includes(v as LogLevel) ? (v as LogLevel) : fallback)
}
