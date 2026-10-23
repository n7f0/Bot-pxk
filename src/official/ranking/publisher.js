'use strict';

const ui = require('./ui');
const seasons = require('../seasons/service');
const settings = require('../database/settings');
const config = require('../config');
const ctx = require('../utils/context');

let timer = null;
let debounce = null;
let publishedHash = null;
const tracked = new Map(); // messageId -> { interaction, params, expiresAt, hash }
const TRACK_LIFETIME = 14 * 60 * 1000; // respostas de slash command só podem ser editadas por ~15 min

/** Assinatura do conteúdo ignorando o "Atualizado <t:...:R>" — só edita a mensagem se algo mudou de fato. */
function signature(payload) {
  const json = (payload.embeds || []).map((e) => (typeof e.toJSON === 'function' ? e.toJSON() : e.data));
  const comps = (payload.components || []).map((c) => (typeof c.toJSON === 'function' ? c.toJSON() : c));
  return JSON.stringify([json, comps]).replace(/<t:\d+:R>/g, '');
}

async function buildPayload(client, guildId) {
  return ui.buildRanking(client, { seasonId: seasons.requireCurrent().id, page: 1, ownerId: '0', guildId });
}

/** Publica o ranking fixo (mensagem pública que se atualiza sozinha). Os botões dão a cada pessoa uma cópia própria. */
async function publish(channel) {
  const msg = await channel.send(await buildPayload(channel.client, channel.guildId));
  settings.set('rank_channel_id', channel.id);
  settings.set('rank_message_id', msg.id);
  publishedHash = null;
  return msg;
}

/** Passa a atualizar automaticamente a resposta de um /ranking (enquanto a interação for editável). */
function track(messageId, interaction, params, payload) {
  tracked.set(messageId, { interaction, params, expiresAt: Date.now() + TRACK_LIFETIME, hash: signature(payload) });
}

/** Para de atualizar (ex.: o usuário trocou de página; a mensagem não deve voltar para a página antiga). */
function untrack(messageId) {
  tracked.delete(messageId);
}

async function refreshTracked() {
  const client = ctx.client;
  if (!client) return;
  for (const [id, t] of [...tracked.entries()]) {
    if (Date.now() > t.expiresAt) {
      tracked.delete(id);
      continue;
    }
    try {
      const payload = await ui.buildRanking(client, t.params);
      const sig = signature(payload);
      if (sig === t.hash) continue;
      await t.interaction.editReply(payload);
      t.hash = sig;
    } catch {
      tracked.delete(id);
    }
  }
}

/** Atualiza o ranking publicado (se existir). Só edita quando o conteúdo mudou (ou com force). */
async function refresh({ force = false } = {}) {
  const client = ctx.client;
  const channelId = settings.get('rank_channel_id');
  const messageId = settings.get('rank_message_id');
  if (!client || !channelId || !messageId) return false;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !config.isKnownGuild(channel.guildId)) return false;
    const message = await channel.messages.fetch(messageId);
    const payload = await buildPayload(client, channel.guildId);
    const sig = signature(payload);
    if (!message.flags.has(ui.V2)) {
      // Mensagem antiga (embed): o Discord não converte para o novo layout, então publica de novo e apaga a antiga.
      const fresh = await channel.send(payload);
      settings.set('rank_message_id', fresh.id);
      publishedHash = sig;
      await message.delete().catch(() => {});
      return true;
    }
    if (!force && sig === publishedHash) return true;
    await message.edit(payload);
    publishedHash = sig;
    return true;
  } catch {
    return false;
  }
}

/** Agrupa várias alterações seguidas em uma única edição. */
function scheduleRefresh(delayMs = 5000) {
  if (debounce) return;
  debounce = setTimeout(() => {
    debounce = null;
    refresh().catch(() => {});
    refreshTracked().catch(() => {});
  }, delayMs);
  debounce.unref?.();
}

function start(everyMs = 60 * 1000) {
  if (timer) return;
  refresh().catch(() => {}); // já ao ligar: aplica o layout atual (ex.: sem o botão de atualizar) na mensagem publicada
  timer = setInterval(() => {
    refresh().catch(() => {});
    refreshTracked().catch(() => {});
  }, everyMs);
  timer.unref?.();
}

module.exports = { publish, refresh, track, untrack, scheduleRefresh, start };
