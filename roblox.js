/**
 * roblox.js — Calls to Roblox's public APIs (game stats, game icon).
 */

const fetch = require('node-fetch'); // v2 (CommonJS)
const { sleep } = require('./utils');

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 2000, // 2s, then 4s, then 8s (exponential backoff)
};

async function fetchGameStatsOnce(universeId) {
  const res = await fetch(
    `https://games.roblox.com/v1/games?universeIds=${universeId}`
  );

  if (!res.ok) {
    const err = new Error(`Roblox API error: ${res.status}`);
    // Per Roblox's own guidance: on a 429, prefer the Retry-After header
    // over guessing a backoff delay, when the header is present.
    const retryAfter = res.headers.get('retry-after');
    if (res.status === 429 && retryAfter) {
      err.retryAfterMs = parseFloat(retryAfter) * 1000;
    }
    throw err;
  }

  const data = await res.json();
  if (!data.data || data.data.length === 0) {
    throw new Error('Game not found for this universeId');
  }
  return data.data[0]; // { playing, visits, favoritedCount, name, ... }
}

// Retries with exponential backoff. A 429 (rate limit) also respects the
// Retry-After header when Roblox sends one, instead of guessing the delay
// (this is Roblox's own documented recommendation for handling 429s).
async function fetchGameStats(universeId, gameName = universeId) {
  let lastErr;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await fetchGameStatsOnce(universeId);
    } catch (err) {
      lastErr = err;

      if (attempt === RETRY_CONFIG.maxRetries) break; // no more retries left

      const delay = err.retryAfterMs || RETRY_CONFIG.baseDelayMs * 2 ** attempt;
      console.warn(
        `[${gameName}] Attempt ${attempt + 1} failed (${err.message}), retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }

  throw lastErr; // all retries exhausted → let the caller handle/log the final failure
}

// Fetches the game's icon from Roblox's thumbnails API. Called once per
// game (on /addgame) and cached in the DB — icons rarely change, so there's
// no need to re-fetch this on every status update.
async function fetchGameThumbnail(universeId) {
  try {
    const res = await fetch(
      `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png&isCircular=false`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data.data && data.data[0];
    if (entry && entry.state === 'Completed') return entry.imageUrl;
    return null;
  } catch (err) {
    console.warn('Could not fetch game thumbnail:', err.message);
    return null;
  }
}

module.exports = { fetchGameStats, fetchGameThumbnail };
