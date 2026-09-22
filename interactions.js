/**
 * interactions.js — Handles slash command execution and autocomplete.
 */

const db = require('./db');
const { CONFIG, VOICE_CHANNEL_SETTING_KEY } = require('./config');
const { slugify } = require('./utils');
const { fetchGameThumbnail } = require('./roblox');
const { updateGame, startTimer, stopTimer } = require('./gameUpdater');
const voice = require('./voice');

async function handleAutocomplete(interaction) {
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
}

async function handleAddGame(client, interaction) {
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

  await updateGame(client, newGame);
  startTimer(client, newGame);
}

async function handleSetInterval(interaction) {
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
  startTimer(interaction.client, updated); // restart the timer with the new interval

  await interaction.reply({
    content: `⏱️ **${game.name}** will now be updated every ${intervalMinutes} min.`,
    ephemeral: true,
  });
}

async function handleRemoveGame(interaction) {
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

async function handleListGames(interaction) {
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

async function handleJoinVoice(interaction) {
  const channel = interaction.options.getChannel('channel');

  await interaction.deferReply({ ephemeral: true });

  try {
    await voice.connectToVoice(channel);
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

async function handleLeaveVoice(interaction) {
  if (!voice.isConnected()) {
    await interaction.reply({
      content: "❌ I'm not currently in a voice channel.",
      ephemeral: true,
    });
    return;
  }

  voice.leaveVoice();

  await interaction.reply({
    content: '👋 Left the voice channel.',
    ephemeral: true,
  });
}

const HANDLERS = {
  addgame: (client, interaction) => handleAddGame(client, interaction),
  setinterval: (client, interaction) => handleSetInterval(interaction),
  removegame: (client, interaction) => handleRemoveGame(interaction),
  listgames: (client, interaction) => handleListGames(interaction),
  joinvoice: (client, interaction) => handleJoinVoice(interaction),
  leavevoice: (client, interaction) => handleLeaveVoice(interaction),
};

function registerInteractionHandler(client) {
  client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const handler = HANDLERS[interaction.commandName];
    if (handler) await handler(client, interaction);
  });
}

module.exports = { registerInteractionHandler };
