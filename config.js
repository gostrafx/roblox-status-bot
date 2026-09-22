/**
 * config.js — Environment-based configuration, shared across modules.
 */

const CONFIG = {
  TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID, // instant command registration on this server
  DEFAULT_INTERVAL_MINUTES: 5, // used if /addgame doesn't specify an interval
  MIN_INTERVAL_MINUTES: 1, // to avoid hammering the Roblox API / Discord rate limits
};

const VOICE_CHANNEL_SETTING_KEY = 'voiceChannelId';

module.exports = { CONFIG, VOICE_CHANNEL_SETTING_KEY };
