/**
 * db.js — SQLite access layer for tracked games + bot settings
 * -----------------------------------------------------------------
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
    thumbnailUrl     TEXT,
    createdAt        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT
  );
`);

// Soft migration: add thumbnailUrl if the DB predates this column.
const existingCols = db.prepare('PRAGMA table_info(games)').all().map((c) => c.name);
if (!existingCols.includes('thumbnailUrl')) {
  db.exec('ALTER TABLE games ADD COLUMN thumbnailUrl TEXT');
}

// --------- Prepared statements (reused, so fast) ---------
const stmts = {
  getAll: db.prepare('SELECT * FROM games ORDER BY createdAt ASC'),
  getByKey: db.prepare('SELECT * FROM games WHERE key = ?'),
  insert: db.prepare(`
    INSERT INTO games (key, name, universeId, placeId, channelId, messageId, intervalMinutes, thumbnailUrl)
    VALUES (@key, @name, @universeId, @placeId, @channelId, @messageId, @intervalMinutes, @thumbnailUrl)
  `),
  updateMessageId: db.prepare('UPDATE games SET messageId = ? WHERE key = ?'),
  updateInterval: db.prepare('UPDATE games SET intervalMinutes = ? WHERE key = ?'),
  updateThumbnail: db.prepare('UPDATE games SET thumbnailUrl = ? WHERE key = ?'),
  remove: db.prepare('DELETE FROM games WHERE key = ?'),

  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare(`
    INSERT INTO settings (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = @value
  `),
  deleteSetting: db.prepare('DELETE FROM settings WHERE key = ?'),
};

// --------- Games API ---------
function getAllGames() {
  return stmts.getAll.all();
}

function getGame(key) {
  return stmts.getByKey.get(key);
}

function gameExists(key) {
  return !!stmts.getByKey.get(key);
}

function addGame({
  key,
  name,
  universeId,
  placeId,
  channelId,
  intervalMinutes,
  thumbnailUrl = null,
}) {
  stmts.insert.run({
    key,
    name,
    universeId,
    placeId,
    channelId,
    messageId: null,
    intervalMinutes,
    thumbnailUrl,
  });
  return getGame(key);
}

function setMessageId(key, messageId) {
  stmts.updateMessageId.run(messageId, key);
}

function setInterval_(key, intervalMinutes) {
  stmts.updateInterval.run(intervalMinutes, key);
}

function setThumbnailUrl(key, thumbnailUrl) {
  stmts.updateThumbnail.run(thumbnailUrl, key);
}

function removeGame(key) {
  const game = getGame(key);
  stmts.remove.run(key);
  return game; // returns the removed game (or undefined if it didn't exist)
}

// --------- Settings API (key/value, used for the voice channel to auto-rejoin) ---------
function getSetting(key) {
  const row = stmts.getSetting.get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  stmts.setSetting.run({ key, value });
}

function deleteSetting(key) {
  stmts.deleteSetting.run(key);
}

module.exports = {
  getAllGames,
  getGame,
  gameExists,
  addGame,
  setMessageId,
  setInterval: setInterval_,
  setThumbnailUrl,
  removeGame,
  getSetting,
  setSetting,
  deleteSetting,
};
