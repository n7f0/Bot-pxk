'use strict';

const { FeaturePointRole } = require('../../models');
const { state } = require('../database/store');
const settings = require('../database/settings');
const config = require('../config');
const ctx = require('../utils/context');
const logs = require('../logs');
const { baseEmbed, COLORS } = require('../utils/embeds');

function listRules() {
  return [...state.pointRoles.values()].sort((a, b) => Number(a.points) - Number(b.points));
}

async function addRule({ guildId, roleId, points, removePrevious }) {
  const doc = {
    _id: Number(points), points: Number(points), guild_id: String(guildId),
    role_id: String(roleId), remove_previous: removePrevious ? 1 : 0,
  };
  await FeaturePointRole.updateOne({ _id: Number(points) }, { $set: doc }, { upsert: true }).exec();
  state.pointRoles.set(Number(points), doc);
}

async function removeRule(points) {
  const result = await FeaturePointRole.deleteOne({ _id: Number(points) }).exec();
  state.pointRoles.delete(Number(points));
  return result.deletedCount > 0;
}

async function syncMember(userId, points, { silent = false } = {}) {
  if (!settings.get('roles_enabled')) return { added: [], removed: [] };
  const client = ctx.client;
  const rules = listRules();
  if (!client || !rules.length) return { added: [], removed: [] };

  const result = { added: [], removed: [] };
  for (const guildId of [config.externalGuildId, config.internalGuildId]) {
    const gRules = rules.filter((r) => r.guild_id === guildId);
    if (!gRules.length) continue;
    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    if (!member) continue;

    const earned = gRules.filter((r) => points >= Number(r.points));
    const top = earned[earned.length - 1];
    const keep = new Set(earned.map((r) => r.role_id));
    if (top?.remove_previous) {
      keep.clear();
      keep.add(top.role_id);
    }

    for (const rule of gRules) {
      const has = member.roles.cache.has(rule.role_id);
      try {
        if (keep.has(rule.role_id) && !has) {
          await member.roles.add(rule.role_id, `Cargo por pontuação (${points} pts)`);
          result.added.push(rule.role_id);
        } else if (!keep.has(rule.role_id) && has) {
          await member.roles.remove(rule.role_id, `Cargo por pontuação (${points} pts)`);
          result.removed.push(rule.role_id);
        }
      } catch (err) {
        console.error(`[roles] não foi possível ajustar o cargo ${rule.role_id}:`, err.message);
        if (!silent) await logs.logEvent({
          category: 'ranking', action: 'role_auto_error', targetId: userId,
          title: 'Falha ao ajustar cargo por pontuação',
          description: `Não foi possível ajustar <@&${rule.role_id}> de <@${userId}>.\nVerifique se o cargo do bot está acima do cargo alvo e se ele possui **Gerenciar Cargos**.`,
          color: COLORS.warning,
        });
      }
    }
  }

  if (!silent && (result.added.length || result.removed.length)) {
    const lines = [
      ...result.added.map((id) => `➕ <@&${id}>`),
      ...result.removed.map((id) => `➖ <@&${id}>`),
    ];
    await logs.logEvent({
      category: 'ranking', action: 'role_auto', targetId: userId,
      summary: `Cargos por pontuação ajustados (${points} pts)`,
      embed: baseEmbed({
        title: 'CARGO POR PONTUAÇÃO',
        description: `👤 <@${userId}>\n🏆 Pontos: **${points}**\n\n${lines.join('\n')}`,
        color: COLORS.gold, footer: logs.LOG_FOOTER,
      }),
    });
  }
  return result;
}

async function clearMembers(userIds) {
  for (const id of userIds) {
    await syncMember(id, 0, { silent: true }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
  }
}

module.exports = { listRules, addRule, removeRule, syncMember, clearMembers };
