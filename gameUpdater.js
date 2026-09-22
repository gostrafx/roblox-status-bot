/**
 * gameUpdater.js — Fetches stats and edits/sends each game's status message,
 * on its own independent per-game timer.
 */

const db = require('./db');
const { CONFIG } = require('./config');
const { fetchGameStats } = require('./roblox');
const { buildEmbed, buildJoinButton } = require('./embeds');

const timers = new Map(); // key: game.key → NodeJS.Timeout

function stopTimer(key) {
  const t = timers.get(key);
  if (t) {
    clearInterval(t);
    timers.delete(key);
  }
}

function startTimer(client, game) {
  stopTimer(game.key); // avoid duplicates if restarted
  const ms =
    Math.max(game.intervalMinutes, CONFIG.MIN_INTERVAL_MINUTES) * 60 * 1000;
  const timer = setInterval(() => {
    // always re-read the freshest version of the game (up-to-date messageId, etc.)
    const fresh = db.getGame(game.key);
    if (fresh) updateGame(client, fresh);
    else stopTimer(game.key); // the game was removed in the meantime
  }, ms);
  timers.set(game.key, timer);
}

async function updateGame(client, game) {
  try {
    const stats = await fetchGameStats(game.universeId, game.name);
    const embed = buildEmbed(game, stats);
    const row = buildJoinButton(game);
    const channel = await client.channels.fetch(game.channelId);

    if (game.messageId) {
      try {
        const existing = await channel.messages.fetch(game.messageId);
        await existing.edit({ embeds: [embed], components: [row] });
        console.log(`[${game.name}] Status edited.`);
        return;
      } catch {
        // message was deleted → create a new one
      }
    }

    const sent = await channel.send({ embeds: [embed], components: [row] });
    db.setMessageId(game.key, sent.id);
    console.log(`[${game.name}] New status message created.`);
  } catch (err) {
    console.error(`[${game.name}] Update error:`, err.message);
  }
}

async function updateAllGamesOnce(client) {
  // Used only on startup, for an immediate first status for every game
  for (const game of db.getAllGames()) {
    await updateGame(client, game);
    // small delay to avoid hammering the Roblox API if there are many games
    await new Promise((r) => setTimeout(r, 500));
  }
}

module.exports = { updateGame, updateAllGamesOnce, startTimer, stopTimer };
