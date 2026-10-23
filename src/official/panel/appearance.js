'use strict';

const seasons = require('../seasons/service');
const publisher = require('../ranking/publisher');
const rankingUi = require('../ranking/ui');
const rankingEmojis = require('../ranking/emojis');
const settings = require('../database/settings');
const config = require('../config');
const { requirePermission } = require('../permissions');
const { baseEmbed, successEmbed, errorEmbed, COLORS } = require('../utils/embeds');
const { row, button, buildModal, updateOrReply, EPHEMERAL, ButtonStyle } = require('../utils/interaction');
const { menuButton, backButton, parseChannelId, adminLog } = require('./util');
const { LINE } = require('./main');

function emojiSummary() {
  const { map, rest } = rankingEmojis.parse(rankingEmojis.currentText());
  const shown = [...map.entries()].slice(0, 6).map(([pos, e]) => `${pos}º ${e}`);
  const more = map.size > 6 ? ` … (+${map.size - 6})` : '';
  const demais = rest ? ` • demais ${rest}` : '';
  return shown.length || rest ? `${shown.join('  ')}${more}${demais}` : '*só números*';
}

function render() {
  const area = settings.get('bp_area') || 'Mov. Chat';
  const channelId = settings.get('rank_channel_id');
  const embed = baseEmbed({
    title: 'Aparência do ranking',
    color: COLORS.brand,
    timestamp: false,
    description: [
      'Personalize o **ranking público** e publique-o em um canal (a mensagem se atualiza sozinha).',
      LINE,
      `📝 **Título:** ${settings.get('ap_ranking_title') || `*padrão* (Ranking de ${area})`}`,
      `🔻 **Rodapé extra:** ${settings.get('ap_ranking_footer') || '*nenhum*'}`,
      `🏅 **Emojis das posições:** ${emojiSummary()}`,
      `🖼️ **Banner:** ${settings.get('ap_ranking_banner') ? '[link configurado](' + settings.get('ap_ranking_banner') + ')' : '*nenhum*'}`,
      `📏 **Membros exibidos:** até ${settings.get('rank_max')} • ${settings.get('per_page')} por página`,
      LINE,
      `📢 **Ranking publicado:** ${channelId ? `<#${channelId}>` : '*ainda não publicado*'}`,
    ].join('\n'),
  });
  return {
    embeds: [embed],
    components: [
      row(
        button('panel:appearance:edit', 'Editar aparência', { emoji: '✏️', style: ButtonStyle.Primary }),
        button('panel:appearance:preview', 'Pré-visualizar', { emoji: '👁️' }),
        button('panel:appearance:pub', 'Publicar ranking', { emoji: '📢', style: ButtonStyle.Success }),
        button('panel:appearance:refresh', 'Atualizar publicado', { emoji: '🔄' }),
        button('panel:appearance:reset', 'Restaurar padrão', { emoji: '🧹', style: ButtonStyle.Danger })
      ),
      row(button('panel:appearance:emojis', 'Emojis das posições', { emoji: '🏅', style: ButtonStyle.Primary }), menuButton()),
    ],
  };
}

async function handle(interaction, action) {
  if (!(await requirePermission(interaction, 'manage_ranking'))) return;

  if (action === 'view') return interaction.update(render());

  if (action === 'preview') {
    const preview = await rankingUi.buildRanking(interaction.client, { seasonId: seasons.requireCurrent().id, page: 1, viewerId: interaction.user.id, ownerId: interaction.user.id });
    // O ranking agora é um cartão (Components V2), que não pode substituir a mensagem do painel: vai em uma resposta só sua.
    return interaction.reply({ ...preview, flags: EPHEMERAL | preview.flags });
  }

  if (action === 'edit') {
    return interaction.showModal(
      buildModal('panel:appearance:editsub', 'Aparência do ranking', [
        { id: 'title', label: 'Título (vazio = padrão)', value: settings.get('ap_ranking_title'), required: false, max: 60, placeholder: 'Ranking de Mov. Chat' },
        { id: 'footer', label: 'Texto extra do rodapé', value: settings.get('ap_ranking_footer'), required: false, max: 120 },
        { id: 'banner', label: 'Banner (link https de imagem)', value: settings.get('ap_ranking_banner'), required: false, max: 400, placeholder: 'https://...' },
      ])
    );
  }

  if (action === 'editsub') {
    const f = (id) => interaction.fields.getTextInputValue(id).trim();
    const banner = f('banner');
    const fail = (m) => updateOrReply(interaction, { embeds: [errorEmbed(m)], components: render().components });
    if (banner && !/^https:\/\/\S+$/i.test(banner)) return fail('O banner precisa ser um link **https** de imagem.');
    settings.set('ap_ranking_title', f('title') || null);
    settings.set('ap_ranking_footer', f('footer') || null);
    settings.set('ap_ranking_banner', banner || null);
    await adminLog(interaction, 'config_appearance', 'Aparência do ranking alterada', '🎨 Título, rodapé ou banner do ranking foram atualizados.');
    publisher.refresh({ force: true }).catch(() => {});
    return updateOrReply(interaction, render());
  }

  if (action === 'emojis') {
    return interaction.showModal(
      buildModal('panel:appearance:emojissub', 'Emojis das posições', [
        {
          id: 'rules',
          label: 'Uma regra por linha: posição = emoji',
          value: rankingEmojis.currentText(),
          long: true,
          required: false,
          max: 4000,
          placeholder: '1 = 🥇\n2 = 🥈\n3 = 🥉\n4-10 = 🔹\n11-100 = ▫️\ndemais = ▪️',
        },
      ])
    );
  }

  if (action === 'emojissub') {
    const rules = interaction.fields.getTextInputValue('rules').trim();
    const { errors } = rankingEmojis.parse(rules);
    if (errors.length) {
      const list = errors.slice(0, 8).join('\n');
      return updateOrReply(interaction, { embeds: [errorEmbed(`Não salvei, corrija e tente de novo:\n${list}${errors.length > 8 ? `\n… e mais ${errors.length - 8}.` : ''}`)], components: render().components });
    }
    // Vazio = sem emoji nenhum (só números); para voltar ao padrão use "Restaurar padrão".
    settings.set('ap_ranking_emojis', rules);
    await adminLog(interaction, 'config_appearance', 'Emojis do ranking alterados', '🏅 Emojis das posições do ranking foram atualizados.');
    publisher.refresh({ force: true }).catch(() => {});
    return updateOrReply(interaction, render());
  }

  if (action === 'pub') {
    return interaction.showModal(
      buildModal('panel:appearance:pubsub', 'Publicar ranking', [
        { id: 'channel', label: 'Canal (ID ou #menção) de qualquer servidor', value: settings.get('rank_channel_id'), max: 40 },
      ])
    );
  }

  if (action === 'pubsub') {
    const id = parseChannelId(interaction.fields.getTextInputValue('channel'));
    const fail = (m) => updateOrReply(interaction, { embeds: [errorEmbed(m)], components: render().components });
    if (!id) return fail('Informe o ID ou a #menção do canal.');
    const channel = await interaction.client.channels.fetch(id).catch(() => null);
    if (!channel || !config.isKnownGuild(channel.guildId) || !channel.isTextBased()) return fail('Canal não encontrado nos servidores configurados.');
    try {
      await publisher.publish(channel);
    } catch (err) {
      return fail(`Não consegui publicar (verifique as permissões do bot no canal): ${err.message}`);
    }
    await adminLog(interaction, 'ranking_published', 'Ranking publicado', `📢 Ranking publicado em <#${channel.id}>`);
    const view = render();
    view.embeds.unshift(successEmbed(`Ranking publicado em <#${channel.id}>. Ele se atualiza sozinho.`));
    return updateOrReply(interaction, view);
  }

  if (action === 'refresh') {
    const ok = await publisher.refresh({ force: true });
    const view = render();
    view.embeds.unshift(ok ? successEmbed('Ranking publicado atualizado.') : errorEmbed('Não há ranking publicado (ou a mensagem foi apagada). Use **Publicar ranking**.'));
    return interaction.update(view);
  }

  if (action === 'reset') {
    for (const k of ['ap_ranking_title', 'ap_ranking_footer', 'ap_ranking_color', 'ap_ranking_banner', 'ap_ranking_emojis']) settings.set(k, null);
    await adminLog(interaction, 'config_appearance', 'Aparência do ranking restaurada', '🧹 Aparência restaurada para o padrão.');
    publisher.refresh({ force: true }).catch(() => {});
    return interaction.update(render());
  }
}

module.exports = { render, handle };
