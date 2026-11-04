'use strict';

const { state } = require('../database/store');
const settings = require('../database/settings');

const RANK_MAX_LIMIT = 500;

function maxMembers() {
  return Math.max(1, Math.min(RANK_MAX_LIMIT, Number(settings.get('rank_max')) || 100));
}

function rankedRows(seasonId) {
  return [...state.scores.values()]
    .filter((s) => Number(s.season_id) === Number(seasonId) && Number(s.points) > 0)
    .sort((a, b) =>
      Number(b.points) - Number(a.points) ||
      (Number(a.last_change_at) || 0) - (Number(b.last_change_at) || 0) ||
      String(a.user_id).localeCompare(String(b.user_id))
    );
}

function countRanked(seasonId) {
  return Math.min(rankedRows(seasonId).length, maxMembers());
}

function getPage(seasonId, page, perPage) {
  const offset = Math.max(0, (page - 1) * perPage);
  const limit = Math.max(0, Math.min(perPage, maxMembers() - offset));
  return rankedRows(seasonId).slice(offset, offset + limit)
    .map((r, i) => ({ ...r, position: offset + i + 1 }));
}

function getPosition(seasonId, userId) {
  const rows = rankedRows(seasonId);
  const index = rows.findIndex((r) => String(r.user_id) === String(userId));
  return index < 0 || index >= maxMembers() ? index < 0 ? null : index + 1 : index + 1;
}

function getMessageTotals(userIds, season) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  const out = new Map();
  for (const id of ids) out.set(id, { user_id: id, messages: 0, approved: 0 });
  const from = Number(season.started_at) || 0;
  const to = Number(season.ended_at) || Date.now();
  for (const s of state.sessions.values()) {
    if (!ids.includes(String(s.user_id)) || s.status === 'cancelled') continue;
    const started = Number(s.started_at) || 0;
    if (started < from || started > to) continue;
    const row = out.get(String(s.user_id));
    row.messages += Number(s.messages) || 0;
    if (s.status === 'approved') row.approved += 1;
  }
  return out;
}

const pageOfPosition = (position, perPage) => Math.max(1, Math.ceil(position / perPage));

module.exports = { RANK_MAX_LIMIT, maxMembers, getMessageTotals, countRanked, getPage, getPosition, pageOfPosition };
