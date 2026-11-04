'use strict';

const { FeatureSetting } = require('../../models');
const { state, assertLoaded } = require('./store');

const DEFAULT_SETTINGS = Object.freeze({
  timezone: 'America/Sao_Paulo',
  reset_enabled: false, reset_day: 1, reset_time: '00:00', reset_enabled_at: 0,
  per_page: 10, rank_max: 100, rank_channel_id: null, rank_message_id: null,
  roles_enabled: false, roles_clear_on_reset: false,
  bp_enabled: false, bp_area: 'Mov. Chat', bp_duration_min: 60, bp_goal: 10,
  bp_channel_id: null, bp_reward: 0, bp_cooldown_sec: 0,
  bp_panel_channel_id: null, bp_panel_message_id: null, bp_in_ranking: false,
  bpv_layout: 'fields', bpv_footer: null, bpv_dm_on_start: false,
  bpv_dm_on_goal: false, bpv_dm_enabled: false,
  ui_color: '#2b2d31', ui_status_colors: false, ui_timestamp: true,
  log_channel_points: null, log_channel_ranking: null, log_channel_bateponto: null,
  log_channel_admin: null, log_channel_messages: null, log_channel_members: null,
});

function get(key) {
  assertLoaded();
  return state.settings.has(key) ? state.settings.get(key) :
    (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key) ? DEFAULT_SETTINGS[key] : null);
}

async function set(key, value) {
  assertLoaded();
  if (typeof key !== 'string' || !key || key.length > 120) throw new Error('Chave de configuração inválida.');
  if (value === undefined) throw new Error('Valor de configuração indefinido.');
  await FeatureSetting.updateOne({ _id: key }, { $set: { value } }, { upsert: true }).exec();
  state.settings.set(key, value);
  return value;
}

async function del(key) {
  assertLoaded();
  await FeatureSetting.deleteOne({ _id: key }).exec();
  state.settings.delete(key);
}

async function loadCache() {
  assertLoaded();
  return state.settings.size;
}

module.exports = { DEFAULT_SETTINGS, DEFAULTS: DEFAULT_SETTINGS, get, set, del, loadCache };
