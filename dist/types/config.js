"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
// src/config.ts
require("dotenv/config");
function requireEnv(name) {
    const v = process.env[name];
    if (!v || v.trim() === '') {
        throw new Error(`Missing required env var: ${name}`);
    }
    return v.trim();
}
function optionalEnv(name, fallback) {
    const v = process.env[name];
    return v && v.trim() !== '' ? v.trim() : fallback;
}
function parseBoolean(name, fallback = false) {
    const v = process.env[name];
    if (v == null)
        return fallback;
    const normalized = v.trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}
function parseLogLevel(name, fallback = 'info') {
    const v = (process.env[name] || '').trim().toLowerCase();
    const allowed = ['debug', 'info', 'warn', 'error'];
    return (allowed.includes(v) ? v : fallback);
}
exports.config = {
    // Discord
    TOKEN: requireEnv('TOKEN'),
    CLIENT_ID: requireEnv('CLIENT_ID'),
    GUILD_ID: optionalEnv('GUILD_ID'),
    // Marketplace
    SELL_CHANNEL_ID: requireEnv('SELL_CHANNEL_ID'),
    BUY_CHANNEL_ID: requireEnv('BUY_CHANNEL_ID'),
    MOD_CHANNEL_ID: requireEnv('MOD_CHANNEL_ID'),
    MARKET_LOG_CHANNEL_ID: requireEnv('MARKET_LOG_CHANNEL_ID'),
    MOD_ROLE_ID: requireEnv('MOD_ROLE_ID'),
    // TikTok
    TIKTOK_USERNAME: requireEnv('TIKTOK_USERNAME'),
    TIKTOK_CHANNEL_ID: requireEnv('TIKTOK_CHANNEL_ID'),
    TIKTOK_PING_EVERYONE: parseBoolean('TIKTOK_PING_EVERYONE', false),
    TIKTOK_COOKIE: requireEnv('TIKTOK_COOKIE'),
    // Misc
    LOG_LEVEL: parseLogLevel('LOG_LEVEL', 'info'),
};
// Optional: quick self-check log (remove if you want)
// console.log('[config] Loaded with LOG_LEVEL=', config.LOG_LEVEL)
