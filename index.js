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
 * Each game has its own message AND its own update interval,
 * managed independently (one setInterval per game). Games are stored in
 * a SQLite database (games.db) via db.js, more robust than a raw JSON file.
 *
 * Dependencies:
 *   npm install discord.js node-fetch@2 better-sqlite3 @discordjs/voice libsodium-wrappers
 *
 * Run:
 *   node index.js
 */

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const fetch = require('node-fetch'); // v2 (CommonJS)
const db = require('./db');

// ================= CONFIG =================
const CONFIG = {
  TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID, // instant command registration on this server
  DEFAULT_INTERVAL_MINUTES: 5, // used if /addgame doesn't specify an interval
  MIN_INTERVAL_MINUTES: 1, // to avoid hammering the Roblox API / Discord rate limits
};

const VOICE_CHANNEL_SETTING_KEY = 'voiceChannelId';
// ============================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates, // required to join/stay in voice channels
  ],
});

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// --------- Per-game timers ---------
const timers = new Map(); // key: game.key → NodeJS.Timeout

function stopTimer(key) {
  const t = timers.get(key);
  if (t) {
    clearInterval(t);
    timers.delete(key);
  }
}

function startTimer(game) {
  stopTimer(game.key); // avoid duplicates if restarted
  const ms =
    Math.max(game.intervalMinutes, CONFIG.MIN_INTERVAL_MINUTES) * 60 * 1000;
  const timer = setInterval(() => {
    // always re-read the freshest version of the game (up-to-date messageId, etc.)
    const fresh = db.getGame(game.key);
    if (fresh) updateGame(fresh);
    else stopTimer(game.key); // the game was removed in the meantime
  }, ms);
  timers.set(game.key, timer);
}

// --------- 24/7 voice channel presence ---------
let currentVoiceConnection = null;

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
      console.warn('Voice connection lost, attempting to rejoin...');
      connection.destroy();
      await sleep(5000);
      await rejoinSavedVoiceChannel();
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    console.log(`Joined voice channel: ${channel.name}`);
  } catch (err) {
    console.error('Failed to join voice channel:', err.message);
    connection.destroy();
    currentVoiceConnection = null;
  }

  return connection;
}

async function rejoinSavedVoiceChannel() {
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

// --------- Slash commands ---------
const commands = [
  new SlashCommandBuilder()
    .setName('addgame')
    .setDescription('Track a new Roblox game')
    .addStringOption((o) =>
      o.setName('name').setDescription('Display name for the game').setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('universe_id')
        .setDescription("The game's Roblox Universe ID")
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('place_id')
        .setDescription('Roblox Place ID (for the Join button)')
        .setRequired(true)
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription("Channel to post this game's status in")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName('interval_minutes')
        .setDescription('Update frequency in minutes (default: 5)')
        .setMinValue(1)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('setinterval')
    .setDescription('Change the update interval for an already-tracked game')
    .addStringOption((o) =>
      o
        .setName('name')
        .setDescription('Name of the game to update')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addIntegerOption((o) =>
      o
        .setName('interval_minutes')
        .setDescription('New update frequency in minutes')
        .setMinValue(1)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('removegame')
    .setDescription('Stop tracking a game')
    .addStringOption((o) =>
      o
        .setName('name')
        .setDescription('Name of the game to remove')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('listgames')
    .setDescription('List all currently tracked games')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('joinvoice')
    .setDescription('Bot joins and stays in a voice channel 24/7')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Voice channel to join')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),

  new SlashCommandBuilder()
    .setName('leavevoice')
    .setDescription('Bot leaves the voice channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
  try {
    if (CONFIG.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
        { body: commands }
      );
      console.log('Commands registered on the server (instant).');
    } else {
      await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), {
        body: commands,
      });
      console.log('Commands registered globally (up to 1h delay to show up).');
    }
  } catch (err) {
    console.error('Error registering commands:', err);
  }
}

// --------- Roblox API ---------
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 2000, // 2s, then 4s, then 8s (exponential backoff)
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

function buildEmbed(game, stats) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`🎮 ${game.name} — Live Status`)
    .addFields(
      {
        name: '🟢 Players Online',
        value: `${stats.playing.toLocaleString('en-US')} active`,
        inline: true,
      },
      {
        name: '🏛️ Total Visits',
        value: `${stats.visits.toLocaleString('en-US')} visits`,
        inline: true,
      },
      {
        name: '⭐ Community',
        value: `${stats.favoritedCount.toLocaleString('en-US')} favorites`,
        inline: true,
      }
    )
    .setFooter({ text: 'Last updated' })
    .setTimestamp(new Date());

  if (game.thumbnailUrl) {
    embed.setThumbnail(game.thumbnailUrl);
  }

  return embed;
}

function buildJoinButton(game) {
  const url = `https://www.roblox.com/games/${game.placeId}`;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🚀 Join Game')
      .setStyle(ButtonStyle.Link)
      .setURL(url)
  );
}

// --------- Update a single game ---------
async function updateGame(game) {
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

async function updateAllGamesOnce() {
  // Used only on startup, for an immediate first status for every game
  for (const game of db.getAllGames()) {
    await updateGame(game);
    // small delay to avoid hammering the Roblox API if there are many games
    await new Promise((r) => setTimeout(r, 500));
  }
}

// --------- Interaction handling ---------
client.on('interactionCreate', async (interaction) => {
  // Autocomplete for /removegame and /setinterval
  if (interaction.isAutocomplete()) {
    if (
      interaction.commandName === 'removegame' ||
      interaction.commandName === 'setinterval'
    ) {
      const focused = interaction.options.getFocused().toLowerCase();
      const choices = db
        .getAllGames()
        .filter((g) => g.name.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((g) => ({ name: g.name, value: g.key }));
      await interaction.respond(choices);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'addgame') {
    const name = interaction.options.getString('name');
    const universeId = interaction.options.getString('universe_id');
    const placeId = interaction.options.getString('place_id');
    const channel = interaction.options.getChannel('channel');
    const intervalMinutes =
      interaction.options.getInteger('interval_minutes') ||
      CONFIG.DEFAULT_INTERVAL_MINUTES;
    const key = slugify(name);

    if (db.gameExists(key)) {
      await interaction.reply({
        content: `⚠️ A game named **${name}** is already tracked. Remove it first with \`/removegame\` if you want to replace it.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true }); // thumbnail fetch adds a bit of latency

    const thumbnailUrl = await fetchGameThumbnail(universeId);

    const newGame = db.addGame({
      key,
      name,
      universeId,
      placeId,
      channelId: channel.id,
      intervalMinutes,
      thumbnailUrl,
    });

    await interaction.editReply({
      content: `✅ **${name}** is now tracked in ${channel}, updated every ${intervalMinutes} min.`,
    });

    await updateGame(newGame);
    startTimer(newGame);
  }

  if (interaction.commandName === 'setinterval') {
    const key = interaction.options.getString('name');
    const intervalMinutes = interaction.options.getInteger('interval_minutes');
    const resolvedKey = db.gameExists(key) ? key : slugify(key);
    const game = db.getGame(resolvedKey);

    if (!game) {
      await interaction.reply({
        content: `❌ No game found for "${key}". Use \`/listgames\` to see the list.`,
        ephemeral: true,
      });
      return;
    }

    db.setInterval(game.key, intervalMinutes);
    const updated = db.getGame(game.key);
    startTimer(updated); // restart the timer with the new interval

    await interaction.reply({
      content: `⏱️ **${game.name}** will now be updated every ${intervalMinutes} min.`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'removegame') {
    const key = interaction.options.getString('name');
    const resolvedKey = db.gameExists(key) ? key : slugify(key);
    const removed = db.removeGame(resolvedKey);

    if (!removed) {
      await interaction.reply({
        content: `❌ No game found for "${key}". Use \`/listgames\` to see the list.`,
        ephemeral: true,
      });
      return;
    }

    stopTimer(removed.key);

    await interaction.reply({
      content: `🗑️ **${removed.name}** is no longer tracked.`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'listgames') {
    const games = db.getAllGames();

    if (games.length === 0) {
      await interaction.reply({
        content: 'No games tracked yet. Use `/addgame` to add one.',
        ephemeral: true,
      });
      return;
    }

    const lines = games.map(
      (g) =>
        `• **${g.name}** — <#${g.channelId}> (universeId: ${g.universeId}, updates every ${g.intervalMinutes} min)`
    );

    await interaction.reply({
      content: `📋 Tracked games:\n${lines.join('\n')}`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === 'joinvoice') {
    const channel = interaction.options.getChannel('channel');

    await interaction.deferReply({ ephemeral: true });

    try {
      await connectToVoice(channel);
      db.setSetting(VOICE_CHANNEL_SETTING_KEY, channel.id);
      await interaction.editReply({
        content: `🔊 Joined **${channel.name}** and will stay connected 24/7 (auto-reconnects if disconnected, and auto-rejoins after a bot restart).`,
      });
    } catch (err) {
      await interaction.editReply({
        content: `❌ Failed to join the voice channel: ${err.message}`,
      });
    }
  }

  if (interaction.commandName === 'leavevoice') {
    if (!currentVoiceConnection) {
      await interaction.reply({
        content: "❌ I'm not currently in a voice channel.",
        ephemeral: true,
      });
      return;
    }

    leaveVoice();

    await interaction.reply({
      content: '👋 Left the voice channel.',
      ephemeral: true,
    });
  }
});

// --------- Startup ---------
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  await updateAllGamesOnce();
  // one independent setInterval per game, with its own intervalMinutes
  for (const game of db.getAllGames()) {
    startTimer(game);
  }
  // auto-rejoin the voice channel saved from a previous session, if any
  await rejoinSavedVoiceChannel();
});

client.login(CONFIG.TOKEN);
