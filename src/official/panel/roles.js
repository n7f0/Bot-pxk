'use strict';

const rolesService = require('../roles/service');
const pointsDb = require('../database');
const settings = require('../database/settings');
const config = require('../config');
const { requirePermission } = require('../permissions');
const { baseEmbed, errorEmbed, successEmbed, COLORS } = require('../utils/embeds');
const { SEP, num, parseIntStrict } = require('../utils/format');
const { row, button, buildModal, updateOrReply, ButtonStyle } = require('../utils/interaction');
const { menuButton, onOff, adminLog } = require('./util');

const guildName = (id) => (id === config.externalGuildId ? 'externo' : 'interno');

function render() {
  const rules = rolesService.listRules();
  const lines = rules.length
    ? rules.map((r) => `**${num(r.points)} pts** → <@&${r.role_id}> • ${r.remove_previous ? 'remove o anterior' : 'acumula'} • servidor ${guildName(r.guild_id)}`)
    : ['Nenhuma regra cadastrada. Use **➕ Adicionar**.'];
  const embed = baseEmbed({
    title: 'Cargos por pontuação',
    color: COLORS.gold,
    description: [
      `🔘 **Sistema:** ${onOff(settings.get('roles_enabled'))}`,
      `🧹 **Limpar cargos no reset de temporada:** ${onOff(settings.get('roles_clear_on_reset'))}`,
      SEP,
      lines.join('\n'),
      SEP,
      '⚠️ O cargo do bot precisa estar **acima** dos cargos por pontuação e ter **Gerenciar Cargos**.',
    ].join('\n'),
  });
  const on = settings.get('roles_enabled');
  return {
    embeds: [embed],
    components: [
      row(
        button('panel:roles:add', 'Adicionar', { emoji: '➕', style: ButtonStyle.Success }),
        button('panel:roles:remove', 'Remover', { emoji: '🗑️', style: ButtonStyle.Danger }),
        button('panel:roles:toggle', on ? 'Desativar' : 'Ativar', { emoji: on ? '⏹️' : '▶️' }),
        button('panel:roles:clear', settings.get('roles_clear_on_reset') ? 'Não limpar no reset' : 'Limpar no reset', { emoji: '🧹' }),
        button('panel:roles:sync', 'Sincronizar todos', { emoji: '🔁', style: ButtonStyle.Primary })
      ),
      row(menuButton()),
    ],
  };
}

async function findRole(client, roleId) {
  for (const guildId of [config.externalGuildId, config.internalGuildId]) {
    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    const role = guild ? guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null)) : null;
    if (role) return { role, guildId };
  }
  return null;
}

async function handle(interaction, action) {
  if (!(await requirePermission(interaction, 'change_settings'))) return;

  if (action === 'view') return interaction.update(render());

  if (action === 'add') {
    return interaction.showModal(
      buildModal('panel:roles:addsub', 'Adicionar cargo por pontuação', [
        { id: 'points', label: 'Pontos necessários', placeholder: 'Ex.: 100', max: 8 },
        { id: 'role', label: 'ID do cargo (servidor externo ou interno)', placeholder: '123456789012345678', max: 30 },
        { id: 'prev', label: 'Remover cargo anterior? (sim/não)', value: 'sim', max: 3 },
      ])
    );
  }

  if (action === 'addsub') {
    const points = parseIntStrict(interaction.fields.getTextInputValue('points'));
    const roleId = (interaction.fields.getTextInputValue('role').match(/\d{17,20}/) || [])[0];
    const prev = /^s/i.test(interaction.fields.getTextInputValue('prev').trim());
    const fail = (m) => updateOrReply(interaction, { embeds: [errorEmbed(m)], components: render().components });
    if (points === null || points < 1 || points > config.limits.maxPoints) return fail('Pontuação inválida.');
    if (!roleId) return fail('ID do cargo inválido.');
    const found = await findRole(interaction.client, roleId);
    if (!found) return fail('Cargo não encontrado em nenhum dos dois servidores.');
    rolesService.addRule({ guildId: found.guildId, roleId, points, removePrevious: prev });
    await adminLog(interaction, 'config_roles', 'Cargo por pontuação configurado', `🏅 **${num(points)} pts** → <@&${roleId}> (servidor ${guildName(found.guildId)}) • ${prev ? 'remove o anterior' : 'acumula'}`);
    return updateOrReply(interaction, render());
  }

  if (action === 'remove') {
    return interaction.showModal(buildModal('panel:roles:rmsub', 'Remover regra', [{ id: 'points', label: 'Pontos da regra a remover', max: 8 }]));
  }

  if (action === 'rmsub') {
    const points = parseIntStrict(interaction.fields.getTextInputValue('points'));
    const ok = points !== null && rolesService.removeRule(points);
    if (!ok) return updateOrReply(interaction, { embeds: [errorEmbed('Nenhuma regra com essa pontuação.')], components: render().components });
    await adminLog(interaction, 'config_roles', 'Cargo por pontuação removido', `🗑️ Regra de **${num(points)} pts** removida.`);
    return updateOrReply(interaction, render());
  }

  if (action === 'toggle') {
    const next = !settings.get('roles_enabled');
    settings.set('roles_enabled', next);
    await adminLog(interaction, 'config_roles', 'Cargos por pontuação ' + (next ? 'ativados' : 'desativados'), `🔘 Sistema: **${next ? 'ATIVADO' : 'DESATIVADO'}**`);
    return interaction.update(render());
  }

  if (action === 'clear') {
    const next = !settings.get('roles_clear_on_reset');
    settings.set('roles_clear_on_reset', next);
    await adminLog(interaction, 'config_roles', 'Limpeza de cargos no reset alterada', `🧹 Limpar cargos no reset: **${next ? 'SIM' : 'NÃO'}**`);
    return interaction.update(render());
  }

  if (action === 'sync') {
    const users = pointsDb
      .prepare('SELECT user_id, points FROM season_scores WHERE season_id = (SELECT id FROM seasons WHERE status = ? LIMIT 1)')
      .all('active');
    await interaction.update({ embeds: [successEmbed(`Sincronizando **${users.length}** usuário(s) em segundo plano…`, 'Sincronização iniciada')], components: render().components });
    (async () => {
      for (const u of users) {
        await rolesService.syncMember(u.user_id, u.points, { silent: false }).catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
      }
      await adminLog(interaction, 'roles_sync', 'Sincronização de cargos concluída', `🔁 ${users.length} usuário(s) processados.`);
    })();
    return;
  }
}

module.exports = { render, handle };
