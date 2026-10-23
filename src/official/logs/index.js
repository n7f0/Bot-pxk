'use strict';

const db = require('../database');
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

function record({ category, action, guildId = null, actorId = null, targetId = null, summary = null, details = null }) {
  const info = db
    .prepare(
      `INSERT INTO logs(category, action, guild_id, actor_id, target_id, summary, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(category, action, guildId, actorId, targetId, summary, details ? JSON.stringify(details) : null, Date.now());
  return info.lastInsertRowid;
}

/** Envia o embed para os canais de log configurados. SEMPRE restrito ao servidor interno. */
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

/**
 * Registra no banco e envia ao canal do servidor interno.
 * - mirror: categorias extras que também devem receber o embed (ex.: pontos também em "admin")
 * - embed: pode ser fornecido pronto; senão é montado com title/description/fields
 */
async function logEvent({
  category,
  action,
  guildId,
  actorId,
  targetId,
  summary,
  details,
  title,
  description,
  fields,
  color = COLORS.brand,
  embed,
  mirror = [],
}) {
  try {
    record({ category, action, guildId, actorId, targetId, summary: summary || title || action, details });
    const e = embed || baseEmbed({ title, description, color, footer: LOG_FOOTER });
    if (!embed && fields?.length) e.addFields(fields);
    await sendToChannels([category, ...mirror], e);
  } catch (err) {
    console.error('[logs] erro ao registrar log:', err);
  }
}

function recent(category, limit = 10) {
  return db.prepare('SELECT * FROM logs WHERE category = ? ORDER BY id DESC LIMIT ?').all(category, limit);
}

module.exports = { CATEGORIES, LOG_FOOTER, record, logEvent, sendToChannels, recent };

/** true se o canal é um canal de logs configurado (evita logar mensagens do próprio canal de logs). */
function isLogChannel(channelId) {
  return Object.keys(CATEGORIES).some((c) => settings.get(`log_channel_${c}`) === channelId);
}

module.exports.isLogChannel = isLogChannel;
