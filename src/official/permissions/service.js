'use strict';

const { FeatureRolePermission } = require('../../models');
const { state, permissionId } = require('../database/store');

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
  return [...state.rolePermissions.values()]
    .filter((r) => r.permission === permission)
    .map((r) => ({ guild_id: r.guild_id, role_id: r.role_id }));
}

function listAll() {
  const out = {};
  for (const key of Object.keys(PERMISSIONS)) out[key] = [];
  for (const r of state.rolePermissions.values()) {
    if (out[r.permission]) out[r.permission].push({ guild_id: r.guild_id, role_id: r.role_id });
  }
  return out;
}

async function setRoles(permission, guildId, roleIds) {
  if (!isValid(permission)) throw new Error('Permissão inválida.');
  const before = [...state.rolePermissions.values()]
    .filter((r) => r.permission === permission && r.guild_id === String(guildId))
    .map((r) => r.role_id);
  const ids = [...new Set(roleIds.map(String))];
  const docs = ids.map((roleId) => ({
    _id: permissionId(guildId, roleId, permission),
    guild_id: String(guildId), role_id: roleId, permission,
  }));
  if (docs.length) {
    await FeatureRolePermission.bulkWrite(docs.map((doc) => ({
      updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true },
    })), { ordered: false });
  }
  await FeatureRolePermission.deleteMany({
    permission, guild_id: String(guildId),
    role_id: { $nin: ids },
  }).exec();
  for (const [id, row] of state.rolePermissions) {
    if (row.permission === permission && row.guild_id === String(guildId)) state.rolePermissions.delete(id);
  }
  for (const doc of docs) state.rolePermissions.set(String(doc._id), doc);
  return {
    added: ids.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !ids.includes(id)),
  };
}

async function grantAll(guildId, roleIds) {
  const docs = [];
  for (const roleId of [...new Set(roleIds.map(String))]) {
    for (const permission of Object.keys(PERMISSIONS)) {
      docs.push({
        _id: permissionId(guildId, roleId, permission),
        guild_id: String(guildId), role_id: roleId, permission,
      });
    }
  }
  if (docs.length) {
    await FeatureRolePermission.bulkWrite(docs.map((doc) => ({
      updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true },
    })), { ordered: false });
    for (const doc of docs) state.rolePermissions.set(String(doc._id), doc);
  }
}

async function revokeAll(roleIds) {
  const ids = [...new Set(roleIds.map(String))];
  await FeatureRolePermission.deleteMany({ role_id: { $in: ids } }).exec();
  for (const [id, row] of state.rolePermissions) {
    if (ids.includes(row.role_id)) state.rolePermissions.delete(id);
  }
}

function anyRoleHas(roleIds, permission) {
  if (!roleIds.length) return false;
  const roles = new Set(roleIds.map(String));
  return [...state.rolePermissions.values()].some((r) => r.permission === permission && roles.has(r.role_id));
}

module.exports = { PERMISSIONS, isValid, listRoles, listAll, setRoles, grantAll, revokeAll, anyRoleHas };
