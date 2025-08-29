"use strict";
// src/config.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
require("dotenv/config");
const helpers_1 = require("../lib/helpers");
exports.config = {
    // Discord
    TOKEN: (0, helpers_1.requireEnv)('TOKEN'),
    CLIENT_ID: (0, helpers_1.requireEnv)('CLIENT_ID'),
    GUILD_ID: (0, helpers_1.optionalEnv)('GUILD_ID'),
    // Marketplace
    SELL_CHANNEL_ID: (0, helpers_1.requireEnv)('SELL_CHANNEL_ID'),
    BUY_CHANNEL_ID: (0, helpers_1.requireEnv)('BUY_CHANNEL_ID'),
    MOD_CHANNEL_ID: (0, helpers_1.requireEnv)('MOD_CHANNEL_ID'),
    MARKET_LOG_CHANNEL_ID: (0, helpers_1.requireEnv)('MARKET_LOG_CHANNEL_ID'),
    MOD_ROLE_ID: (0, helpers_1.requireEnv)('MOD_ROLE_ID'),
    // TikTok
    TIKTOK_USERNAME: (0, helpers_1.requireEnv)('TIKTOK_USERNAME'),
    TIKTOK_CHANNEL_ID: (0, helpers_1.requireEnv)('TIKTOK_CHANNEL_ID'),
    TIKTOK_PING_EVERYONE: (0, helpers_1.parseBoolean)('TIKTOK_PING_EVERYONE', false),
    TIKTOK_COOKIE: (0, helpers_1.requireEnv)('TIKTOK_COOKIE'),
    // Misc
    LOG_LEVEL: (0, helpers_1.parseLogLevel)('LOG_LEVEL', 'info'),
};
// Optional: quick self-check log (remove if you want)
// console.log('[config] Loaded with LOG_LEVEL=', config.LOG_LEVEL)
