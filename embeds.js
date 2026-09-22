/**
 * embeds.js — Builds the Discord embed and button for a game's status message.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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

module.exports = { buildEmbed, buildJoinButton };
