'use strict';

const db = require('../database');
const settings = require('../database/settings');
const config = require('../config');
const ctx = require('../utils/context');
const logs = require('../logs');
const { baseEmbed, COLORS } = require('../utils/embeds');

function listRules() {
  return db.prepare('SELECT * FROM point_roles ORDER BY points ASC').all();
}

function addRule({ guildId, roleId, points, removePrevious }) {
  db.prepare(
    `INSERT INTO point_roles(guild_id, role_id, points, remove_previous) VALUES (?, ?, ?, ?)
     ON CONFLICT(points) DO UPDATE SET guild_id = excluded.guild_id, role_id = excluded.role_id, remove_previous = excluded.remove_previous`
  ).run(guildId, roleId, points, removePrevious ? 1 : 0);
}

function removeRule(points) {
  return db.prepare('DELETE FROM point_roles WHERE points = ?').run(points).changes > 0;
}

/**
 * Sincroniza os cargos por pontuação de um membro (idempotente):
 * - concede os cargos conquistados (pontos >= requisito)
 * - remove cargos não conquistados
 * - remove cargos anteriores quando a regra do cargo mais alto estiver com "remover anterior"
 */
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

    const earned = gRules.filter((r) => points >= r.points);
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
        if (!silent) {
          await logs.logEvent({
            category: 'ranking',
            action: 'role_auto_error',
            targetId: userId,
            title: 'Falha ao ajustar cargo por pontuação',
            description: `Não foi possível ajustar <@&${rule.role_id}> de <@${userId}>.\nVerifique se o cargo do bot está acima do cargo alvo e se ele possui **Gerenciar Cargos**.`,
            color: COLORS.warning,
          });
        }
      }
    }
  }

  if (!silent && (result.added.length || result.removed.length)) {
    const lines = [
      ...result.added.map((id) => `➕ <@&${id}>`),
      ...result.removed.map((id) => `➖ <@&${id}>`),
    ];
    await logs.logEvent({
      category: 'ranking',
      action: 'role_auto',
      targetId: userId,
      summary: `Cargos por pontuação ajustados (${points} pts)`,
      embed: baseEmbed({
        title: 'CARGO POR PONTUAÇÃO',
        description: `👤 <@${userId}>\n🏆 Pontos: **${points}**\n\n${lines.join('\n')}`,
        color: COLORS.gold,
        footer: logs.LOG_FOOTER,
      }),
    });
  }
  return result;
}

/** Remove todos os cargos por pontuação de uma lista de usuários (usado no reset de temporada). */
async function clearMembers(userIds) {
  for (const id of userIds) {
    await syncMember(id, 0, { silent: true }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
  }
}

module.exports = { listRules, addRule, removeRule, syncMember, clearMembers };
