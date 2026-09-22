/**
 * Discord Bot - Live multi-game Roblox status (SQLite) + 24/7 voice presence
 * -------------------------------------------------------------------------
 * Commands:
 *   /addgame name universe_id place_id channel [interval_minutes]  → track a new game
 *   /removegame name                                                → stop tracking a game
 *   /listgames                                                      → list tracked games
 *   /setinterval name interval_minutes                              → change a game's update interval
 *   /joinvoice channel                                              → bot joins & stays in a voice channel 24/7
 *   /leavevoice                                                     → bot leaves the voice channel
 *
 * This file only wires the pieces together. The actual logic lives in:
 *   config.js       — environment-based configuration
 *   db.js           — SQLite storage (games + settings)
 *   utils.js        — small shared helpers (slugify, sleep)
 *   roblox.js       — Roblox API calls (stats, thumbnails) with retry
 *   embeds.js       — Discord embed/button builders
 *   gameUpdater.js  — per-game status updating and timers
 *   voice.js        — 24/7 voice presence, reconnect, watchdog
 *   commands.js     — slash command definitions and registration
 *   interactions.js — slash command execution and autocomplete
 *
 * Dependencies:
 *   npm install discord.js node-fetch@2 better-sqlite3 @discordjs/voice libsodium-wrappers
 *
 * Run:
 *   node index.js
 */

const { Client, GatewayIntentBits } = require('discord.js');
const { CONFIG } = require('./config');
const db = require('./db');
const { registerCommands } = require('./commands');
const { registerInteractionHandler } = require('./interactions');
const { updateAllGamesOnce, startTimer } = require('./gameUpdater');
const { rejoinSavedVoiceChannel, startVoiceWatchdog } = require('./voice');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates, // required to join/stay in voice channels
  ],
});

registerInteractionHandler(client);

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  await updateAllGamesOnce(client);
  // one independent setInterval per game, with its own intervalMinutes
  for (const game of db.getAllGames()) {
    startTimer(client, game);
  }
  // auto-rejoin the voice channel saved from a previous session, if any
  await rejoinSavedVoiceChannel(client);
  startVoiceWatchdog(client);
});

client.login(CONFIG.TOKEN);
