/**
 * voice.js — 24/7 voice channel presence: join, auto-reconnect with
 * exponential backoff, and a watchdog that catches drops events might miss.
 */

const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const db = require('./db');
const { VOICE_CHANNEL_SETTING_KEY } = require('./config');
const { sleep } = require('./utils');

let currentVoiceConnection = null;
let voiceRejoinInProgress = false; // prevents overlapping rejoin attempts

async function connectToVoice(channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true, // doesn't need to hear anything, saves bandwidth
    selfMute: true, // never plays or sends audio
  });

  currentVoiceConnection = connection;

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    // Discord sometimes disconnects briefly during moves/reconnects; try to
    // recover in place first before treating it as a real disconnect.
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
      // it's reconnecting on its own, nothing to do
    } catch {
      console.warn('Voice connection lost (Disconnected event), attempting to rejoin...');
      connection.destroy();
      currentVoiceConnection = null;
      await rejoinSavedVoiceChannelWithRetry(channel.client);
    }
  });

  connection.on('error', (err) => {
    console.error('Voice connection error:', err.message);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    console.log(`Joined voice channel: ${channel.name}`);
  } catch (err) {
    console.error('Failed to join voice channel:', err.message);
    connection.destroy();
    currentVoiceConnection = null;
    throw err;
  }

  return connection;
}

// Retries rejoining with exponential backoff, capped, and keeps retrying
// indefinitely (a single failed attempt used to give up permanently — this
// no longer does). Guarded so multiple triggers don't stack retries.
async function rejoinSavedVoiceChannelWithRetry(client) {
  if (voiceRejoinInProgress) return;
  voiceRejoinInProgress = true;

  const channelId = db.getSetting(VOICE_CHANNEL_SETTING_KEY);
  if (!channelId) {
    voiceRejoinInProgress = false;
    return;
  }

  const maxDelayMs = 60_000; // never wait more than 1 minute between attempts
  let attempt = 0;

  while (!currentVoiceConnection) {
    if (db.getSetting(VOICE_CHANNEL_SETTING_KEY) !== channelId) break;

    attempt++;
    const delay = Math.min(5000 * 2 ** (attempt - 1), maxDelayMs);

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel) throw new Error('Voice channel not found');
      await connectToVoice(channel);
      console.log(`Voice reconnect succeeded on attempt ${attempt}.`);
      break;
    } catch (err) {
      console.warn(
        `Voice reconnect attempt ${attempt} failed (${err.message}), retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }

  voiceRejoinInProgress = false;
}

async function rejoinSavedVoiceChannel(client) {
  const channelId = db.getSetting(VOICE_CHANNEL_SETTING_KEY);
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) await connectToVoice(channel);
  } catch (err) {
    console.error('Could not rejoin saved voice channel:', err.message);
  }
}

function leaveVoice() {
  if (currentVoiceConnection) {
    currentVoiceConnection.destroy();
    currentVoiceConnection = null;
  }
  db.deleteSetting(VOICE_CHANNEL_SETTING_KEY);
}

function isConnected() {
  return Boolean(currentVoiceConnection);
}

// Safety net: every 60s, verify the voice connection is actually healthy.
// This catches disconnects that events alone might miss.
const VOICE_WATCHDOG_INTERVAL_MS = 60_000;

function startVoiceWatchdog(client) {
  setInterval(() => {
    const savedChannelId = db.getSetting(VOICE_CHANNEL_SETTING_KEY);
    if (!savedChannelId) return; // no voice channel is supposed to be joined

    const isHealthy =
      currentVoiceConnection &&
      currentVoiceConnection.state.status === VoiceConnectionStatus.Ready;

    if (!isHealthy && !voiceRejoinInProgress) {
      console.warn('Voice watchdog: connection unhealthy, triggering rejoin...');
      rejoinSavedVoiceChannelWithRetry(client);
    }
  }, VOICE_WATCHDOG_INTERVAL_MS);
}

module.exports = {
  connectToVoice,
  rejoinSavedVoiceChannel,
  leaveVoice,
  isConnected,
  startVoiceWatchdog,
};
