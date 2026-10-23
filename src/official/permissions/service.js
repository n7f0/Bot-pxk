'use strict';

const db = require('../database');

/** Todas as permissões configuráveis. Para criar uma nova, basta adicionar aqui. */
const PERMISSIONS = {
  manage_points: { label: 'Gerenciar pontos', emoji: '⭐' },
  remove_points: { label: 'Remover pontos', emoji: '➖' },
  set_points: { label: 'Definir pontos', emoji: '🎯' },
  manage_ranking: { label: 'Gerenciar ranking', emoji: '🏆' },
  reset_ranking: { label: 'Resetar ranking', emoji: '🔄' },
  manage_seasons: { label: 'Gerenciar temporadas', emoji: '🏅' },
  manage_bateponto: { label: 'Gerenciar bate-ponto', emoji: '⏱️' },
  view_logs: { label: 'Visualizar logs', emoji: '📝' },
  open_panel: { label: 'Abrir painel administrativo', emoji: '⚙️' },
  change_settings: { label: 'Alterar configurações', emoji: '🔧' },
};

const isValid = (perm) => Object.prototype.hasOwnProperty.call(PERMISSIONS, perm);

function listRoles(permission) {
  return db.prepare('SELECT guild_id, role_id FROM role_permissions WHERE permission = ?').all(permission);
}

function listAll() {
  const out = {};
  for (const key of Object.keys(PERMISSIONS)) out[key] = [];
  for (const r of db.prepare('SELECT guild_id, role_id, permission FROM role_permissions').all()) {
    if (out[r.permission]) out[r.permission].push({ guild_id: r.guild_id, role_id: r.role_id });
  }
  return out;
}

/** Substitui os cargos de uma permissão (apenas os do servidor informado). Retorna {added, removed}. */
const setRoles = db.transaction((permission, guildId, roleIds) => {
  if (!isValid(permission)) throw new Error('Permissão inválida.');
  const before = db
    .prepare('SELECT role_id FROM role_permissions WHERE permission = ? AND guild_id = ?')
    .all(permission, guildId)
    .map((r) => r.role_id);
  db.prepare('DELETE FROM role_permissions WHERE permission = ? AND guild_id = ?').run(permission, guildId);
  const ins = db.prepare('INSERT OR IGNORE INTO role_permissions(guild_id, role_id, permission) VALUES (?, ?, ?)');
  for (const id of roleIds) ins.run(guildId, id, permission);
  return {
    added: roleIds.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !roleIds.includes(id)),
  };
});

const grantAll = db.transaction((guildId, roleIds) => {
  const ins = db.prepare('INSERT OR IGNORE INTO role_permissions(guild_id, role_id, permission) VALUES (?, ?, ?)');
  for (const id of roleIds) for (const perm of Object.keys(PERMISSIONS)) ins.run(guildId, id, perm);
});

const revokeAll = db.transaction((roleIds) => {
  const del = db.prepare('DELETE FROM role_permissions WHERE role_id = ?');
  for (const id of roleIds) del.run(id);
});

/** Verifica se algum dos cargos informados possui a permissão. */
function anyRoleHas(roleIds, permission) {
  if (!roleIds.length) return false;
  const marks = roleIds.map(() => '?').join(',');
  const row = db
    .prepare(`SELECT 1 FROM role_permissions WHERE permission = ? AND role_id IN (${marks}) LIMIT 1`)
    .get(permission, ...roleIds);
  return Boolean(row);
}

module.exports = { PERMISSIONS, isValid, listRoles, listAll, setRoles, grantAll, revokeAll, anyRoleHas };
