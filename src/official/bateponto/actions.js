'use strict';

const service = require('./service');
const ui = require('./ui');
const visual = require('./visual');
const live = require('./live');
const logs = require('../logs');
const settings = require('../database/settings');
const config = require('../config');
const pointsActions = require('../points/actions');

/** Finaliza uma sessão vencida: resultado, pontos, ranking, log interno e aviso ao usuário. */
async function finalizeSession(client, sessionId) {
  const res = service.finalize(sessionId, { actorId: client.user?.id || null });
  if (!res) return null;
  const { session, entry } = res;

  if (entry) await pointsActions.afterChange(entry, config.externalGuildId);

  await logs.logEvent({
    category: 'bateponto',
    action: session.status,
    guildId: session.guild_id,
    targetId: session.user_id,
    summary: `${session.status} • ${session.messages}/${session.goal} msgs • +${session.points_awarded} pts`,
    details: session,
    embed: ui.buildLogEmbed(session),
  });

  await notifyUser(client, session);
  return session;
}

/** Envia uma mensagem privada ao usuário. Se a DM estiver fechada, registra no log interno (nada vai para canal público). */
async function sendDm(client, session, { textKey, embed, event }) {
  const vars = visual.vars({ ...service.getConfig(), area: session.area }, { pontos: session.points_awarded, mensagens: session.messages });
  try {
    const user = await client.users.fetch(session.user_id);
    await user.send({ content: visual.text(textKey, vars).slice(0, 2000), embeds: embed ? [embed] : [] });
    return true;
  } catch (err) {
    logs.record({
      category: 'bateponto',
      action: 'dm_failed',
      guildId: session.guild_id,
      targetId: session.user_id,
      summary: `Não foi possível enviar a mensagem privada (${event}) • DM fechada? • ${err.message}`,
    });
    return false;
  }
}

/** DM ao INICIAR o bate-ponto. */
async function dmStarted(client, session) {
  if (!settings.get('bpv_dm_on_start')) return false;
  return sendDm(client, session, { textKey: 'bpv_dm_started', event: 'início' });
}

/** DM ao ATINGIR A META (o bate-ponto continua ativo até o fim do tempo). */
async function dmGoalReached(client, session) {
  if (!settings.get('bpv_dm_on_goal')) return false;
  return sendDm(client, session, { textKey: 'bpv_dm_goal_reached', embed: ui.buildGoalNotice(session), event: 'meta' });
}

/**
 * Avisa o usuário quando o bate-ponto termina (aprovado, reprovado ou cancelado pela administração):
 * atualiza o painel ao vivo (se ainda estiver aberto) e envia uma mensagem no privado com o resultado.
 */
async function notifyUser(client, session) {
  const embed = ui.buildResult(session);
  await live.push(session.id, { embeds: [embed], components: [] });
  live.drop(session.id);
  if (!settings.get('bpv_dm_enabled')) return false;
  const textKey = { approved: 'bpv_dm_approved', rejected: 'bpv_dm_rejected' }[session.status] || 'bpv_dm_cancelled';
  return sendDm(client, session, { textKey, embed, event: 'resultado' });
}

/** Varre as sessões vencidas (também recupera as que venceram com o bot offline). */
async function sweep(client) {
  for (const s of service.listDue()) {
    try {
      await finalizeSession(client, s.id);
    } catch (err) {
      console.error(`[bateponto] erro ao finalizar sessão ${s.id}:`, err);
    }
  }
}

async function cancelSession(client, sessionId, { actorId, note, notify = true }) {
  const s = service.cancel(sessionId, note);
  if (!s) return null;
  if (notify) await notifyUser(client, s);
  else live.drop(s.id);
  await logs.logEvent({
    category: 'bateponto',
    action: 'cancelled',
    actorId,
    targetId: s.user_id,
    summary: `cancelado • ${note || ''}`,
    details: s,
    embed: ui.buildLogEmbed(s),
    mirror: actorId && actorId !== s.user_id ? ['admin'] : [],
  });
  return s;
}

/** Edita o painel público (se já publicado) para refletir a configuração atual. */
async function refreshPublicPanel(client) {
  const channelId = settings.get('bp_panel_channel_id');
  const messageId = settings.get('bp_panel_message_id');
  if (!channelId || !messageId) return false;
  try {
    const channel = await client.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    await message.edit(ui.buildPublicPanel());
    return true;
  } catch {
    return false;
  }
}

/** Publica o painel público de bate-ponto em um canal (normalmente do servidor interno, junto do ranking). */
async function publishPanel(channel) {
  const msg = await channel.send(ui.buildPublicPanel());
  settings.set('bp_panel_channel_id', channel.id);
  settings.set('bp_panel_message_id', msg.id);
  return msg;
}

module.exports = { finalizeSession, notifyUser, dmStarted, dmGoalReached, sweep, cancelSession, refreshPublicPanel, publishPanel };
