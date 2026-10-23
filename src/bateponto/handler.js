'use strict';

const service = require('./service');
const ui = require('./ui');
const live = require('./live');
const actions = require('./actions');
const logs = require('../logs');
const config = require('../config');
const visual = require('./visual');
const { errorEmbed, warnEmbed } = require('../utils/embeds');
const { EPHEMERAL, row, button, ButtonStyle } = require('../utils/interaction');

/** customIds: bp:start | bp:view | bp:refresh:<id> | bp:cancel:<id> | bp:cancelok:<id> */
async function handleComponent(interaction) {
  const [, action, idStr] = interaction.customId.split(':');
  const userId = interaction.user.id;

  if (action === 'start') {
    if (interaction.guildId !== config.internalGuildId) {
      return interaction.reply({ embeds: [errorEmbed('O bate-ponto é iniciado pelo **servidor interno**. Use o painel de lá.')], flags: EPHEMERAL });
    }
    const roleName = interaction.member?.roles?.highest?.name;
    const res = service.start({ userId, guildId: interaction.guildId, roleName: roleName && roleName !== '@everyone' ? roleName : null });
    if (res.error) {
      if (res.existing) {
        const panel = ui.buildActivePanel(res.existing);
        await interaction.reply({ ...panel, content: `⚠️ ${res.error}`, flags: EPHEMERAL });
        live.register(res.existing.id, interaction);
        return;
      }
      return interaction.reply({ embeds: [errorEmbed(res.error)], flags: EPHEMERAL });
    }
    logs.record({
      category: 'bateponto',
      action: 'started',
      guildId: interaction.guildId,
      targetId: userId,
      summary: `Início • ${res.session.area} • ${res.session.duration_ms / 60000} min • meta ${res.session.goal}`,
      details: res.session,
    });
    await interaction.reply({ ...ui.buildStartedNotice(res.session), flags: EPHEMERAL });
    live.register(res.session.id, interaction);
    actions.dmStarted(interaction.client, res.session);
    return;
  }

  if (action === 'view') {
    const s = service.getActiveByUser(userId);
    if (!s) {
      const last = service.getLastByUser(userId);
      if (last) {
        return interaction.reply({ embeds: [ui.buildResult(last)], content: '📌 Você não tem bate-ponto ativo. Este foi o seu último:', flags: EPHEMERAL });
      }
      return interaction.reply({ embeds: [warnEmbed(`Você não possui nenhum bate-ponto ativo. Clique em **${visual.text('bpv_btn_start_label')}** para começar.`, 'Bate-ponto')], flags: EPHEMERAL });
    }
    await interaction.reply({ ...ui.buildActivePanel(s), flags: EPHEMERAL });
    live.register(s.id, interaction);
    return;
  }

  const session = service.getById(Number(idStr));
  if (!session || session.user_id !== userId) {
    return interaction.reply({ embeds: [errorEmbed('Este bate-ponto não pertence a você ou não existe mais.')], flags: EPHEMERAL });
  }

  if (action === 'refresh') {
    if (session.status !== 'active') return interaction.update({ embeds: [ui.buildResult(session)], components: [] });
    await interaction.update(ui.buildActivePanel(session));
    live.register(session.id, interaction);
    return;
  }

  if (action === 'cancel') {
    if (session.status !== 'active') return interaction.update({ embeds: [ui.buildResult(session)], components: [] });
    return interaction.update({
      embeds: [warnEmbed('Cancelar o bate-ponto **encerra a contagem e nenhum ponto será concedido**. Deseja continuar?', 'Cancelar bate-ponto?')],
      components: [row(button(`bp:cancelok:${session.id}`, 'Sim, cancelar', { style: ButtonStyle.Danger, emoji: '🛑' }), button(`bp:refresh:${session.id}`, 'Voltar', { emoji: '↩️' }))],
    });
  }

  if (action === 'cancelok') {
    live.drop(session.id);
    const done = await actions.cancelSession(interaction.client, session.id, { actorId: userId, note: 'Cancelado pelo próprio usuário', notify: false });
    const final = done || service.getById(session.id);
    return interaction.update({ embeds: [ui.buildResult(final)], components: [] });
  }
}

module.exports = { handleComponent };
