'use strict';

const { MessageFlags } = require('discord.js');
const service = require('./service');
const ui = require('./ui');

/**
 * Painéis individuais (ephemeral) podem ser editados por ~15 min após a interação.
 * Mantemos em memória as interações para atualizar o tempo/mensagens em "tempo real".
 * Depois disso, o botão "Meu bate-ponto"/"Atualizar" gera um painel novo.
 * Nada disso é crítico para a contagem, que vive 100% no banco.
 */
const views = new Map(); // sessionId -> { interaction, expiresAt }
const LIFETIME = 14 * 60 * 1000;

// CORREÇÃO: sem cleanup periódico, o Map cresce indefinidamente
// (interações expiram mas nunca são removidas se o usuário não clicar mais).
setInterval(() => {
  const now = Date.now();
  for (const [id, v] of views) {
    if (now > v.expiresAt) views.delete(id);
  }
}, 60_000).unref();

function register(sessionId, interaction) {
  views.set(sessionId, { interaction, expiresAt: Date.now() + LIFETIME });
}

async function push(sessionId, payload) {
  const v = views.get(sessionId);
  if (!v) return false;
  if (Date.now() > v.expiresAt) {
    views.delete(sessionId);
    return false;
  }
  try {
    await v.interaction.editReply(payload);
    return true;
  } catch {
    views.delete(sessionId);
    return false;
  }
}

async function notify(sessionId, payload) {
  const v = views.get(sessionId);
  if (!v) return false;
  if (Date.now() > v.expiresAt) {
    views.delete(sessionId);
    return false;
  }
  try {
    await v.interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    return true;
  } catch {
    views.delete(sessionId);
    return false;
  }
}

async function refresh(sessionId) {
  const s = service.getById(sessionId);
  if (!s) return views.delete(sessionId);
  if (s.status !== 'active') return views.delete(sessionId);
  return push(sessionId, ui.buildActivePanel(s));
}

async function tick() {
  for (const id of [...views.keys()]) await refresh(id);
}

function drop(sessionId) {
  views.delete(sessionId);
}

module.exports = { register, push, notify, refresh, tick, drop };