'use strict';

const db = require('../database');
const settings = require('../database/settings');
const pointsService = require('../points/service');

function getConfig() {
  return {
    enabled: Boolean(settings.get('bp_enabled')),
    area: settings.get('bp_area'),
    durationMin: Number(settings.get('bp_duration_min')),
    goal: Number(settings.get('bp_goal')),
    channelId: settings.get('bp_channel_id'),
    reward: Number(settings.get('bp_reward')),
    cooldownSec: Number(settings.get('bp_cooldown_sec')),
  };
}

const getById = (id) => db.prepare('SELECT * FROM bateponto_sessions WHERE id = ?').get(id);
const getActiveByUser = (userId) =>
  db.prepare("SELECT * FROM bateponto_sessions WHERE user_id = ? AND status = 'active'").get(userId);
const getLastByUser = (userId) =>
  db.prepare("SELECT * FROM bateponto_sessions WHERE user_id = ? AND status != 'active' ORDER BY id DESC LIMIT 1").get(userId);
const listActive = () => db.prepare("SELECT * FROM bateponto_sessions WHERE status = 'active' ORDER BY started_at ASC").all();
const listRecent = (limit = 10) =>
  db.prepare("SELECT * FROM bateponto_sessions WHERE status != 'active' ORDER BY id DESC LIMIT ?").all(limit);
const listDue = (now = Date.now()) =>
  db.prepare("SELECT * FROM bateponto_sessions WHERE status = 'active' AND ends_at <= ?").all(now);

/**
 * Inicia um bate-ponto. O usuário NÃO escolhe o tempo: tudo vem da configuração do painel.
 * O índice único parcial do banco impede dois bate-pontos ativos para o mesmo usuário.
 */
function start({ userId, guildId, roleName }) {
  const cfg = getConfig();
  if (!cfg.enabled) return { error: 'O bate-ponto está **desativado** no momento.' };
  if (!cfg.channelId) return { error: 'O bate-ponto ainda não foi configurado (canal de contagem ausente). Avise a administração.' };
  if (!(cfg.durationMin > 0) || !(cfg.goal >= 0)) return { error: 'Configuração de bate-ponto inválida. Avise a administração.' };

  const now = Date.now();
  const duration = cfg.durationMin * 60000;
  try {
    pointsService.ensureUser(userId);
    const info = db
      .prepare(
        `INSERT INTO bateponto_sessions(user_id, guild_id, area, role_name, status, started_at, ends_at, duration_ms, goal, reward, channel_id)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, guildId, cfg.area, roleName || null, now, now + duration, duration, cfg.goal, cfg.reward, cfg.channelId);
    return { session: getById(info.lastInsertRowid) };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return { error: 'Você já possui um bate-ponto **ativo**.', existing: getActiveByUser(userId) };
    throw err;
  }
}

/**
 * Conta uma mensagem do usuário que está em bate-ponto.
 * Regras: só o próprio usuário, só no canal da sessão, só antes do fim, com anti-flood e sem duplicar a mesma mensagem.
 * Retorna { counted, session, goalJustReached }.
 */
const countMessage = db.transaction(({ userId, channelId, messageId, at = Date.now(), hasContent = true }) => {
  if (!hasContent) return { counted: false };
  const session = getActiveByUser(userId);
  if (!session || session.channel_id !== channelId) return { counted: false };
  if (at >= session.ends_at || at < session.started_at) return { counted: false };

  const cooldown = Number(settings.get('bp_cooldown_sec')) * 1000;
  if (session.last_counted_at && at - session.last_counted_at < cooldown && at >= session.last_counted_at) {
    return { counted: false, session };
  }

  const ins = db
    .prepare('INSERT OR IGNORE INTO bateponto_messages(session_id, user_id, channel_id, message_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(session.id, userId, channelId, messageId, at);
  if (ins.changes === 0) return { counted: false, session };

  const messages = session.messages + 1;
  const reached = !session.goal_reached_at && messages >= session.goal;
  db.prepare('UPDATE bateponto_sessions SET messages = ?, last_counted_at = ?, goal_reached_at = COALESCE(goal_reached_at, ?) WHERE id = ?').run(
    messages,
    Math.max(at, session.last_counted_at || 0),
    reached ? at : null,
    session.id
  );
  return { counted: true, session: { ...session, messages }, goalJustReached: reached };
});

/** Mensagem apagada: deixa de contar (evita fraude de "enviar e apagar"). */
const uncountMessage = db.transaction((messageId) => {
  const row = db.prepare('SELECT * FROM bateponto_messages WHERE message_id = ?').get(messageId);
  if (!row) return false;
  const session = getById(row.session_id);
  if (!session || session.status !== 'active') return false;
  db.prepare('DELETE FROM bateponto_messages WHERE id = ?').run(row.id);
  db.prepare('UPDATE bateponto_sessions SET messages = MAX(0, messages - 1) WHERE id = ?').run(session.id);
  return true;
});

/**
 * Finaliza uma sessão cujo tempo acabou. Atômico e idempotente:
 * a sessão é "reivindicada" (status active -> approved/rejected) e os pontos entram na MESMA transação.
 * Retorna { session, entry } ou null se outra execução já finalizou.
 */
const finalize = db.transaction((sessionId, { actorId = null } = {}) => {
  const s = getById(sessionId);
  if (!s || s.status !== 'active') return null;
  const goalMet = s.messages >= s.goal;
  const now = Date.now();
  const status = goalMet ? 'approved' : 'rejected';
  const claimed = db
    .prepare("UPDATE bateponto_sessions SET status = ?, ended_at = ?, result_note = ? WHERE id = ? AND status = 'active'")
    .run(status, now, goalMet ? 'Tempo e meta cumpridos' : 'Meta de mensagens não atingida', s.id);
  if (claimed.changes === 0) return null;

  let entry = null;
  if (goalMet && s.reward > 0) {
    entry = pointsService.applyChange({
      userId: s.user_id,
      actorId,
      mode: 'add',
      amount: s.reward,
      type: 'bate-ponto',
      reason: `Bate-ponto aprovado (${s.area})`,
    });
    db.prepare('UPDATE bateponto_sessions SET points_awarded = ? WHERE id = ?').run(entry.delta, s.id);
  }
  return { session: getById(s.id), entry };
});

/** Cancelamento (pelo próprio usuário ou por um administrador). Nenhum ponto é concedido. */
const cancel = db.transaction((sessionId, note) => {
  const r = db
    .prepare("UPDATE bateponto_sessions SET status = 'cancelled', ended_at = ?, result_note = ? WHERE id = ? AND status = 'active'")
    .run(Date.now(), note || 'Cancelado', sessionId);
  return r.changes > 0 ? getById(sessionId) : null;
});

/** Estado calculado de uma sessão (para exibir nos painéis). */
function snapshot(s, now = Date.now()) {
  const elapsed = Math.min(Math.max(0, now - s.started_at), s.duration_ms);
  return {
    elapsed,
    remaining: Math.max(0, s.ends_at - now),
    goalMet: s.messages >= s.goal,
    timeDone: now >= s.ends_at,
  };
}

module.exports = { getConfig, getById, getActiveByUser, getLastByUser, listActive, listRecent, listDue, start, countMessage, uncountMessage, finalize, cancel, snapshot };
