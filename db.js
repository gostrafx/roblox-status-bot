/**
 * db.js — SQLite access layer for tracked games
 * -------------------------------------------------
 * Uses better-sqlite3 (synchronous, fast, no separate server to manage).
 * The .db file is created automatically on first launch.
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_FILE_PATH || path.join(__dirname, 'games.db');

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL'); // better write concurrency

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    key              TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    universeId       TEXT NOT NULL,
    placeId          TEXT NOT NULL,
    channelId        TEXT NOT NULL,
    messageId        TEXT,
    intervalMinutes  INTEGER NOT NULL DEFAULT 5,
    createdAt        TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// --------- Prepared statements (reused, so fast) ---------
const stmts = {
  getAll: db.prepare('SELECT * FROM games ORDER BY createdAt ASC'),
  getByKey: db.prepare('SELECT * FROM games WHERE key = ?'),
  insert: db.prepare(`
    INSERT INTO games (key, name, universeId, placeId, channelId, messageId, intervalMinutes)
    VALUES (@key, @name, @universeId, @placeId, @channelId, @messageId, @intervalMinutes)
  `),
  updateMessageId: db.prepare('UPDATE games SET messageId = ? WHERE key = ?'),
  updateInterval: db.prepare('UPDATE games SET intervalMinutes = ? WHERE key = ?'),
  remove: db.prepare('DELETE FROM games WHERE key = ?'),
};

// --------- Public API ---------
function getAllGames() {
  return stmts.getAll.all();
}

function getGame(key) {
  return stmts.getByKey.get(key);
}

function gameExists(key) {
  return !!stmts.getByKey.get(key);
}

function addGame({ key, name, universeId, placeId, channelId, intervalMinutes }) {
  stmts.insert.run({
    key,
    name,
    universeId,
    placeId,
    channelId,
    messageId: null,
    intervalMinutes,
  });
  return getGame(key);
}

function setMessageId(key, messageId) {
  stmts.updateMessageId.run(messageId, key);
}

function setInterval_(key, intervalMinutes) {
  stmts.updateInterval.run(intervalMinutes, key);
}

function removeGame(key) {
  const game = getGame(key);
  stmts.remove.run(key);
  return game; // returns the removed game (or undefined if it didn't exist)
}

module.exports = {
  getAllGames,
  getGame,
  gameExists,
  addGame,
  setMessageId,
  setInterval: setInterval_,
  removeGame,
};
