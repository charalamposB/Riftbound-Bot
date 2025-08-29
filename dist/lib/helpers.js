"use strict";
// src/lib/helpers.ts
/**
 * Περιέχει helpers για ανάγνωση env μεταβλητών και parsing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireEnv = requireEnv;
exports.optionalEnv = optionalEnv;
exports.parseBoolean = parseBoolean;
exports.parseLogLevel = parseLogLevel;
/**
 * Ρίχνει σφάλμα αν δεν υπάρχει η env μεταβλητή ή είναι κενή.
 */
function requireEnv(name) {
    const v = process.env[name];
    if (!v || v.trim() === '') {
        throw new Error(`Missing required env var: ${name}`);
    }
    return v.trim();
}
/**
 * Επιστρέφει env μεταβλητή ή fallback αν δεν υπάρχει/είναι κενή.
 */
function optionalEnv(name, fallback) {
    const v = process.env[name];
    return v && v.trim() !== '' ? v.trim() : fallback;
}
/**
 * Μετατρέπει env boolean string σε boolean (π.χ. 'true', '1', 'yes').
 */
function parseBoolean(name, fallback = false) {
    const v = process.env[name];
    if (v == null)
        return fallback;
    const normalized = v.trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}
/**
 * Επιστρέφει το log level από env ή default.
 */
function parseLogLevel(name, fallback = 'info') {
    const v = (process.env[name] || '').trim().toLowerCase();
    const allowed = ['debug', 'info', 'warn', 'error'];
    return (allowed.includes(v) ? v : fallback);
}
