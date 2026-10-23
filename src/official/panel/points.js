'use strict';

const actions = require('../points/actions');
const pointsService = require('../points/service');
const pointsUi = require('../points/ui');
const config = require('../config');
const { requirePermission } = require('../permissions');
const { baseEmbed, errorEmbed, COLORS } = require('../utils/embeds');
const { parseUserId, parseIntStrict, SEP } = require('../utils/format');
const { row, button, buildModal, updateOrReply, ButtonStyle } = require('../utils/interaction');
const { menuButton } = require('./util');

function render() {
  const embed = baseEmbed({
    title: 'Pontos · Gerenciamento',
    color: COLORS.gold,
    description: [
      'Gerencie a pontuação da **temporada atual**. Toda alteração é registrada no histórico e nos logs.',
      SEP,
      '➕ **Adicionar** — soma pontos',
      '➖ **Remover** — subtrai pontos (nunca fica negativo)',
      '🎯 **Definir** — define o valor exato',
      '📜 **Histórico** — alterações de um usuário',
      '',
      'Informe o usuário por **ID** ou **@menção**.',
    ].join('\n'),
  });
  return {
    embeds: [embed],
    components: [
      row(
        button('panel:points:add', 'Adicionar', { emoji: '➕', style: ButtonStyle.Success }),
        button('panel:points:remove', 'Remover', { emoji: '➖', style: ButtonStyle.Danger }),
        button('panel:points:set', 'Definir', { emoji: '🎯', style: ButtonStyle.Primary }),
        button('panel:points:hist', 'Histórico', { emoji: '📜' })
      ),
      row(menuButton()),
    ],
  };
}

const MODES = {
  add: { mode: 'add', type: 'adicionar', perm: 'manage_points', title: 'Adicionar pontos', min: 1 },
  remove: { mode: 'remove', type: 'remover', perm: 'remove_points', title: 'Remover pontos', min: 1 },
  set: { mode: 'set', type: 'definir', perm: 'set_points', title: 'Definir pontos', min: 0 },
};

async function handle(interaction, action, args = []) {
  if (action === 'view') return interaction.update(render());

  if (MODES[action]) {
    const m = MODES[action];
    if (!(await requirePermission(interaction, m.perm))) return;
    return interaction.showModal(
      buildModal(`panel:points:sub:${action}`, m.title, [
        { id: 'user', label: 'Usuário (ID ou @menção)', placeholder: '123456789012345678', max: 40 },
        { id: 'amount', label: 'Pontos', placeholder: action === 'set' ? 'Ex.: 100' : 'Ex.: 50', max: 8 },
        { id: 'reason', label: 'Motivo', required: false, long: true, max: 300, placeholder: 'Ex.: Recrutamento concluído' },
      ])
    );
  }

  if (action === 'hist') {
    if (!(await requirePermission(interaction, 'manage_points'))) return;
    return interaction.showModal(
      buildModal('panel:points:subhist', 'Histórico de pontos', [{ id: 'user', label: 'Usuário (ID ou @menção)', max: 40 }])
    );
  }

  if (action === 'sub') {
    const key = args[0];
    const m = MODES[key];
    if (!m) return;
    if (!(await requirePermission(interaction, m.perm))) return;
    const userId = parseUserId(interaction.fields.getTextInputValue('user'));
    const amount = parseIntStrict(interaction.fields.getTextInputValue('amount'));
    const reason = interaction.fields.getTextInputValue('reason')?.trim() || null;
    const fail = (msg) => updateOrReply(interaction, { embeds: [errorEmbed(msg)], components: render().components });

    if (!userId) return fail('Usuário inválido. Informe um ID ou @menção.');
    if (amount === null || amount < m.min || amount > config.limits.maxPoints) {
      return fail(`Pontuação inválida. Informe um número inteiro entre **${m.min}** e **${config.limits.maxPoints}**.`);
    }
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user) return fail('Não encontrei esse usuário no Discord.');
    if (user.bot) return fail('Bots não participam do sistema de pontos.');

    try {
      const entry = await actions.changePoints({
        userId,
        actorId: interaction.user.id,
        mode: m.mode,
        amount,
        reason,
        type: m.type,
        guildId: interaction.guildId,
      });
      return updateOrReply(interaction, { embeds: [pointsUi.buildChangeEmbed(entry)], components: render().components });
    } catch (err) {
      return fail(err.message);
    }
  }

  if (action === 'subhist') {
    if (!(await requirePermission(interaction, 'manage_points'))) return;
    const userId = parseUserId(interaction.fields.getTextInputValue('user'));
    if (!userId) return updateOrReply(interaction, { embeds: [errorEmbed('Usuário inválido.')], components: render().components });
    const payload = pointsUi.buildHistoryPage(pointsService, { userId, page: 1, ownerId: interaction.user.id, withMenu: true });
    return updateOrReply(interaction, payload);
  }
}

module.exports = { render, handle };
