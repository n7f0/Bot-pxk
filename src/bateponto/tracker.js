'use strict';

const { SnowflakeUtil } = require('discord.js');
const service = require('./service');
const ui = require('./ui');
const live = require('./live');
const actions = require('./actions');
const logs = require('../logs');
const config = require('../config');

/** Chamado a cada mensagem criada nos servidores configurados; só conta no canal de contagem da sessão. */
async function onMessage(message) {
  if (message.author.bot || message.system || !message.guild) return;
  if (!config.isKnownGuild(message.guildId)) return; // o canal de contagem (normalmente do servidor externo) é validado pela sessão

  // Filtro barato: só interessa quem tem bate-ponto ativo naquele canal.
  const active = service.getActiveByUser(message.author.id);
  if (!active || active.channel_id !== message.channelId) return;

  const hasContent =
    (message.content && message.content.trim().length > 0) || message.attachments.size > 0 || (message.stickers?.size ?? 0) > 0;

  const result = service.countMessage({
    userId: message.author.id,
    channelId: message.channelId,
    messageId: message.id,
    at: message.createdTimestamp,
    hasContent,
  });
  if (!result.counted) return;

  live.refresh(result.session.id).catch(() => {});

  if (result.goalJustReached) {
    const fresh = service.getById(result.session.id);
    // Aviso PRIVADO: só quem iniciou o bate-ponto vê (mensagem ephemeral; se expirou, DM). Nada é postado no canal.
    live.push(fresh.id, ui.buildActivePanel(fresh)).catch(() => {});
    await live.notify(fresh.id, { embeds: [ui.buildGoalNotice(fresh)] });
    actions.dmGoalReached(message.client, fresh);
    await logs.logEvent({
      category: 'bateponto',
      action: 'goal_reached',
      guildId: message.guildId,
      targetId: message.author.id,
      summary: `Meta atingida • ${fresh.messages}/${fresh.goal} msgs`,
      details: fresh,
      embed: ui.buildGoalLog(fresh),
    });
  }
}

function onMessageDelete(messageId) {
  const removed = service.uncountMessage(messageId);
  return removed;
}

/**
 * Recuperação após reinício: recontabiliza mensagens que o usuário enviou no canal
 * enquanto o bot estava offline (sem duplicar: message_id é único).
 */
async function backfillSession(client, session) {
  const channel = await client.channels.fetch(session.channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return 0;
  const since = session.last_counted_at || session.started_at;
  let after = String(SnowflakeUtil.generate({ timestamp: since }));
  const until = Math.min(Date.now(), session.ends_at);
  let counted = 0;

  for (let page = 0; page < 30; page++) {
    const batch = await channel.messages.fetch({ limit: 100, after }).catch(() => null);
    if (!batch || batch.size === 0) break;
    const msgs = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const m of msgs) {
      if (m.author.id !== session.user_id || m.createdTimestamp >= session.ends_at) continue;
      const hasContent = (m.content && m.content.trim().length > 0) || m.attachments.size > 0;
      const r = service.countMessage({
        userId: session.user_id,
        channelId: session.channel_id,
        messageId: m.id,
        at: m.createdTimestamp,
        hasContent,
      });
      if (r.counted) counted++;
    }
    after = msgs[msgs.length - 1].id;
    if (msgs[msgs.length - 1].createdTimestamp >= until) break;
  }
  return counted;
}

async function recoverActive(client) {
  const sessions = service.listActive();
  let recovered = 0;
  for (const s of sessions) {
    try {
      recovered += await backfillSession(client, s);
    } catch (err) {
      console.error(`[bateponto] recuperação da sessão ${s.id} falhou:`, err.message);
    }
  }
  console.log(`[bateponto] ${sessions.length} bate-ponto(s) ativo(s) recuperado(s); ${recovered} mensagem(ns) recontabilizada(s).`);
  return sessions.length;
}

module.exports = { onMessage, onMessageDelete, backfillSession, recoverActive };
