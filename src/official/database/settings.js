'use strict';

const db = require('./index');
const config = require('../config');

const DEFAULT_SETTINGS = Object.freeze({
  timezone: config.defaultTimezone,
  reset_enabled: false,
  reset_day: 1,
  reset_time: '00:00',
  reset_enabled_at: 0,
  per_page: 10,
  rank_max: 100,
  rank_channel_id: null,
  rank_message_id: null,
  roles_enabled: false,
  roles_clear_on_reset: false,
  bp_enabled: false,
  bp_area: 'Mov. Chat',
  bp_duration_min: 60,
  bp_goal: 10,
  bp_channel_id: null,
  bp_reward: 0,
  bp_cooldown_sec: 0,
  bp_panel_channel_id: null,
  bp_panel_message_id: null,
  bp_in_ranking: false,
  bpv_layout: 'fields',
  bpv_footer: null,
  bpv_dm_on_start: false,
  bpv_dm_on_goal: false,
  bpv_dm_enabled: false,
  ui_color: '#2b2d31',
  ui_status_colors: false,
  ui_timestamp: true,
  log_channel_points: null,
  log_channel_ranking: null,
  log_channel_bateponto: null,
  log_channel_admin: null,
  log_channel_messages: null,
  log_channel_members: null,
});

const cache = new Map();
const selectOne = db.prepare('SELECT value FROM settings WHERE key = ?');
const upsert = db.prepare(
  'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
const remove = db.prepare('DELETE FROM settings WHERE key = ?');

function decode(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function get(key) {
  if (cache.has(key)) return cache.get(key);
  const row = selectOne.get(key);
  const value = row ? decode(row.value) : (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key) ? DEFAULT_SETTINGS[key] : null);
  cache.set(key, value);
  return value;
}

function set(key, value) {
  if (typeof key !== 'string' || !key || key.length > 120) throw new Error('Chave de configuração inválida.');
  if (value === undefined) throw new Error('Valor de configuração indefinido.');
  upsert.run(key, JSON.stringify(value));
  cache.set(key, value);
  return value;
}

function del(key) {
  remove.run(key);
  cache.delete(key);
}

function loadCache() {
  cache.clear();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) cache.set(key, value);
  for (const row of db.prepare('SELECT key, value FROM settings').all()) cache.set(row.key, decode(row.value));
  return true;
}

loadCache();

module.exports = { DEFAULT_SETTINGS, get, set, del, loadCache };
