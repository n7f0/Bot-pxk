'use strict';

const { FeatureLog } = require('../../models');
const { state, nextId } = require('../database/store');
const settings = require('../database/settings');
const config = require('../config');
const ctx = require('../utils/context');
const { baseEmbed, COLORS } = require('../utils/embeds');

const CATEGORIES = {
  points: { label: 'Logs de pontos', emoji: '⭐' },
  ranking: { label: 'Logs de ranking', emoji: '🏆' },
  bateponto: { label: 'Logs de bate-ponto', emoji: '⏱️' },
  admin: { label: 'Logs administrativos', emoji: '🛡️' },
  messages: { label: 'Logs de mensagens', emoji: '💬' },
  members: { label: 'Logs de membros', emoji: '👥' },
};

const LOG_FOOTER = 'Log interno • Não compartilhar';

async function record({ category, action, guildId = null, actorId = null, targetId = null, summary = null, details = null }) {
  const id = await nextId('feature_logs');
  const doc = {
    _id: id, id, category: category || 'system', action: action || 'event',
    guild_id: guildId || null, actor_id: actorId || null, target_id: targetId || null,
    summary: summary || null, details: details == null ? null : details,
    created_at: Date.now(),
  };
  await FeatureLog.create(doc);
  state.logs.unshift(doc);
  if (state.logs.length > 10000) state.logs.length = 10000;
  return id;
}

async function sendToChannels(categories, embed) {
  const client = ctx.client;
  if (!client) return;
  const sent = new Set();
  for (const cat of categories) {
    const channelId = settings.get(`log_channel_${cat}`);
    if (!channelId || sent.has(channelId)) continue;
    sent.add(channelId);
    try {
      const channel = client.channels.cache.get(channelId) || (await client.channels.fetch(channelId));
      if (!channel || channel.guildId !== config.internalGuildId || !channel.isTextBased()) continue;
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (err) {
      console.error(`[logs] falha ao enviar log (${cat}):`, err.message);
    }
  }
}

async function logEvent({
  category, action, guildId, actorId, targetId, summary, details,
  title, description, fields, color = COLORS.brand, embed, mirror = [],
}) {
  try {
    await record({ category, action, guildId, actorId, targetId, summary: summary || title || action, details });
    const e = embed || baseEmbed({ title, description, color, footer: LOG_FOOTER });
    if (!embed && fields?.length) e.addFields(fields);
    await sendToChannels([category, ...mirror], e);
  } catch (err) {
    console.error('[logs] erro ao registrar log:', err);
  }
}

function recent(category, limit = 10) {
  return state.logs.filter((row) => row.category === category).slice(0, Math.max(0, limit));
}

module.exports = { CATEGORIES, LOG_FOOTER, record, logEvent, sendToChannels, recent };

function isLogChannel(channelId) {
  return Object.keys(CATEGORIES).some((c) => settings.get(`log_channel_${c}`) === channelId);
}
module.exports.isLogChannel = isLogChannel;
