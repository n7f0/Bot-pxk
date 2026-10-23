'use strict';

const { AuditLogEvent } = require('discord.js');
const config = require('../config');
const logs = require('./index');
const settings = require('../database/settings');
const { baseEmbed } = require('../utils/embeds');
const { fmtDateTime } = require('../utils/time');

const serverLabel = (guildId) => (config.isInternal(guildId) ? 'Servidor interno' : 'Servidor externo');

/** Procura (best-effort) quem executou uma ação recente via audit log. Exige "Ver registro de auditoria". */
async function findExecutor(guild, type, targetId) {
  try {
    await new Promise((r) => setTimeout(r, 1200)); // o audit log pode demorar a propagar
    const entries = await guild.fetchAuditLogs({ type, limit: 6 });
    const hit = entries.entries.find((e) => e.target?.id === targetId && Date.now() - e.createdTimestamp < 15_000);
    return hit ? { executor: hit.executor, reason: hit.reason } : null;
  } catch {
    return null;
  }
}

function memberLog({ guild, action, title, color, userId, lines, actorId, summary }) {
  return logs.logEvent({
    category: 'members',
    action,
    guildId: guild.id,
    actorId,
    targetId: userId,
    summary,
    embed: baseEmbed({
      title,
      color,
      footer: logs.LOG_FOOTER,
      description: [`👤 **Membro:** <@${userId}>`, `🌐 **Servidor:** ${serverLabel(guild.id)}`, ...lines, `🕐 **Data:** ${fmtDateTime(Date.now(), settings.get('timezone'))}`].join('\n'),
    }),
  });
}

module.exports = { findExecutor, memberLog, AuditLogEvent };
