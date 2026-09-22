/**
 * commands.js — Slash command definitions and registration.
 */

const {
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { CONFIG } = require('./config');

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

module.exports = { registerCommands };
