// src/config.ts

import 'dotenv/config'
import { requireEnv, optionalEnv, parseBoolean, parseLogLevel, LogLevel } from '../lib/helpers'

export interface AppConfig {
  // Discord core
  TOKEN: string            // Bot token
  CLIENT_ID: string        // Application (client) ID
  GUILD_ID?: string        // Optional: for guild-only command registration in dev

  // Marketplace
  SELL_CHANNEL_ID: string
  BUY_CHANNEL_ID: string
  MOD_CHANNEL_ID: string
  MARKET_LOG_CHANNEL_ID: string
  MOD_ROLE_ID: string

  // TikTok
  TIKTOK_USERNAME: string
  TIKTOK_CHANNEL_ID: string
  TIKTOK_PING_EVERYONE: boolean
  TIKTOK_COOKIE: string

  // Misc
  LOG_LEVEL: LogLevel
}

export const config: AppConfig = {
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
}

// Optional: quick self-check log (remove if you want)
// console.log('[config] Loaded with LOG_LEVEL=', config.LOG_LEVEL)
