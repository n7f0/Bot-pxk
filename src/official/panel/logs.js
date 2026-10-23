'use strict';

const { StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const logs = require('../logs');
const settings = require('../database/settings');
const { requirePermission } = require('../permissions');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { SEP, truncate } = require('../utils/format');
const { fmtDateTime } = require('../utils/time');
const { row, button, ButtonStyle } = require('../utils/interaction');
const { menuButton, backButton, adminLog } = require('./util');

const { CATEGORIES } = logs;

function catSelect(customId, placeholder, selected) {
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(Object.entries(CATEGORIES).map(([key, c]) => ({ label: c.label, value: key, emoji: c.emoji, default: key === selected })));
}

function render(cat = 'points') {
  const tz = settings.get('timezone');
  const info = CATEGORIES[cat] || CATEGORIES.points;
  const entries = logs.recent(cat, 12);
  const channelId = settings.get(`log_channel_${cat}`);
  const lines = entries.length
    ? entries.map((l) => `\`#${l.id}\` \`${fmtDateTime(l.created_at, tz)}\` **${l.action}**${l.actor_id ? ` • <@${l.actor_id}>` : ''}${l.target_id ? ` → <@${l.target_id}>` : ''}${l.summary ? `\n└ ${truncate(l.summary, 120)}` : ''}`)
    : ['Nenhum registro ainda.'];
  const embed = baseEmbed({
    title: info.label,
    color: COLORS.brand,
    description: `📍 Canal: ${channelId ? `<#${channelId}>` : '⚠️ *não configurado*'}\n${SEP}\n${lines.join('\n')}`.slice(0, 4000),
  });
  return {
    embeds: [embed],
    components: [row(catSelect('panel:logs:cat', 'Escolha a categoria de logs', cat)), row(catSelect('panel:logs:chpick', '⚙️ Configurar canal de logs…', null)), row(button(`panel:logs:view:${cat}`, 'Atualizar', { emoji: '🔄' }), menuButton())],
  };
}

function renderChannel(cat) {
  const info = CATEGORIES[cat];
  const channelId = settings.get(`log_channel_${cat}`);
  const embed = baseEmbed({
    title: `Logs · Canal de ${info.label}`,
    color: COLORS.warning,
    description: `Canal atual: ${channelId ? `<#${channelId}>` : '*nenhum*'}\n\nSelecione um canal **deste servidor interno**. Logs administrativos nunca são enviados ao servidor externo.`,
  });
  return {
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId(`panel:logs:chset:${cat}`).setPlaceholder('Selecione o canal').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1)),
      row(button(`panel:logs:chclear:${cat}`, 'Remover canal', { emoji: '🗑️', style: ButtonStyle.Danger }), backButton('logs', 'view', cat)),
    ],
  };
}

async function handle(interaction, action, args = []) {
  if (action === 'view') {
    if (!(await requirePermission(interaction, 'view_logs'))) return;
    return interaction.update(render(CATEGORIES[args[0]] ? args[0] : 'points'));
  }
  if (action === 'cat') {
    if (!(await requirePermission(interaction, 'view_logs'))) return;
    return interaction.update(render(interaction.values[0]));
  }

  // Configuração de canais exige "alterar configurações"
  if (!(await requirePermission(interaction, 'change_settings'))) return;
  if (action === 'chpick') return interaction.update(renderChannel(interaction.values[0]));

  const cat = args[0];
  if (!CATEGORIES[cat]) return;
  if (action === 'chset') {
    const channel = interaction.channels.first();
    const old = settings.get(`log_channel_${cat}`);
    settings.set(`log_channel_${cat}`, channel.id);
    await adminLog(interaction, 'config_logs', 'Canal de logs alterado', `${CATEGORIES[cat].emoji} **${CATEGORIES[cat].label}**\n${old ? `<#${old}>` : '—'} → <#${channel.id}>`);
    return interaction.update(renderChannel(cat));
  }
  if (action === 'chclear') {
    settings.set(`log_channel_${cat}`, null);
    await adminLog(interaction, 'config_logs', 'Canal de logs removido', `${CATEGORIES[cat].emoji} **${CATEGORIES[cat].label}**: canal removido`);
    return interaction.update(renderChannel(cat));
  }
}

module.exports = { render, handle };
