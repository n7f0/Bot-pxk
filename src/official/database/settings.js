'use strict';

const db = require('./index');
const config = require('../config');
const { UI_DEFAULTS, BPV_TEXT } = require('../theme/defaults');

/** Valores padrão de todas as configurações. Tudo é editável pelo /painel. */
const DEFAULTS = {
  // Geral
  timezone: config.defaultTimezone,
  per_page: 10,
  rank_max: 100, // máximo de membros exibidos no ranking (Mov. Chat)

  // Aparência do ranking público
  ap_ranking_emojis: null, // regras "posição = emoji" (null = padrão: medalhas no pódio)
  ap_ranking_title: null,
  ap_ranking_footer: null,
  ap_ranking_color: null,
  ap_ranking_banner: null,
  rank_channel_id: null,
  rank_message_id: null,

  // Reset semanal
  reset_enabled: false,
  reset_day: 0, // 0 = domingo
  reset_time: '23:59',
  reset_enabled_at: 0,

  // Bate-ponto
  bp_enabled: true,
  bp_area: 'Mov. Chat',
  bp_duration_min: 120,
  bp_goal: 100,
  bp_channel_id: null,
  bp_reward: 15,
  bp_cooldown_sec: 3,
  bp_panel_channel_id: null,
  bp_panel_message_id: null,

  // Tema global (cor neutra, linha fina, rodapé, barra) e visual do bate-ponto
  ...UI_DEFAULTS,
  bpv_dm_enabled: true, // DM ao terminar (aprovado/reprovado/cancelado)
  bpv_dm_on_start: true, // DM ao iniciar
  bpv_dm_on_goal: true, // DM ao atingir a meta
  bp_in_ranking: true, // botões do bate-ponto junto do ranking publicado
  bpv_layout: 'fields', // 'fields' (colunas) | 'list' (lista)
  ...Object.fromEntries(Object.keys(BPV_TEXT).map((k) => [k, null])), // null = usa o padrão de theme/defaults.js

  // Cargos por pontuação
  roles_enabled: true,
  roles_clear_on_reset: true,

  // Canais de log (servidor interno)
  log_channel_points: null,
  log_channel_ranking: null,
  log_channel_bateponto: null,
  log_channel_admin: null,
  log_channel_messages: null,
  log_channel_members: null,
};

const cache = new Map();

function get(key) {
  if (cache.has(key)) return cache.get(key);
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  let value = DEFAULTS[key];
  if (row) {
    try {
      value = JSON.parse(row.value);
    } catch {
      value = DEFAULTS[key];
    }
  }
  cache.set(key, value);
  return value;
}

function set(key, value) {
  if (!(key in DEFAULTS)) throw new Error(`Configuração desconhecida: ${key}`);
  db.prepare(
    `INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), Date.now());
  cache.set(key, value);
  return value;
}

function getAll() {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = get(key);
  return out;
}

module.exports = { DEFAULTS, get, set, getAll };
