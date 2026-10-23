'use strict';

const {
  StringSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} = require('discord.js');
const rankingService = require('./service');
const seasons = require('../seasons/service');
const pointsService = require('../points/service');
const settings = require('../database/settings');
const config = require('../config');
const visual = require('../bateponto/visual');
const emojis = require('./emojis');
const { pad2, num, clamp, seasonLabel } = require('../utils/format');
const { muted } = require('../utils/layout');
const { fmtDate } = require('../utils/time');
const { row, button, ButtonStyle } = require('../utils/interaction');

const statusLabel = (season) => (season.status === 'active' ? 'Atual' : 'Encerrada');

function getPerPage() {
  return clamp(Number(settings.get('per_page')) || 10, 5, 20);
}

const V2 = MessageFlags.IsComponentsV2;
const text = (content) => new TextDisplayBuilder().setContent(String(content).slice(0, 4000));
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/**
 * Cartão (Components V2): cantos arredondados e SEM a faixa colorida lateral,
 * porque o container não recebe cor de destaque.
 */
function card(parts) {
  const c = new ContainerBuilder();
  for (const p of parts) {
    if (!p) continue;
    if (p instanceof TextDisplayBuilder) c.addTextDisplayComponents(p);
    else if (p instanceof SeparatorBuilder) c.addSeparatorComponents(p);
    else if (p instanceof MediaGalleryBuilder) c.addMediaGalleryComponents(p);
    else c.addActionRowComponents(p);
  }
  return { components: [c], flags: V2 };
}

/** Linha de botões do bate-ponto (iniciar / meu bate-ponto), usada junto do ranking no servidor interno. */
function batePontoRow() {
  const v = visual.vars(require('../bateponto/service').getConfig());
  return row(
    button('bp:start', visual.text('bpv_btn_start_label', v).slice(0, 80), { emoji: visual.emoji('bpv_btn_start_emoji'), style: visual.style('bpv_btn_start_style') }),
    button('bp:view', visual.text('bpv_btn_view_label', v).slice(0, 80), { emoji: visual.emoji('bpv_btn_view_emoji'), style: visual.style('bpv_btn_view_style') })
  );
}

/**
 * Ranking em lista única, com paginação.
 * - viewerId: usuário cuja posição aparece no rodapé do painel
 * - ownerId: quem "possui" os botões ('0' = mensagem pública fixa; cada pessoa recebe uma cópia própria ao clicar)
 * - guildId: servidor onde o painel aparece; os botões do bate-ponto só aparecem no servidor interno
 *   (undefined = mensagem publicada, que sempre leva os botões quando a opção está ligada)
 */
async function buildRanking(client, { seasonId, page = 1, viewerId, ownerId, viewerIsTarget = false, guildId }) {
  const season = (seasonId && seasons.getById(seasonId)) || seasons.requireCurrent();
  const perPage = getPerPage();
  const total = rankingService.countRanked(season.id);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = clamp(page, 1, pages);
  const rows = rankingService.getPage(season.id, p, perPage);
  const totals = rankingService.getMessageTotals([...rows.map((r) => r.user_id), viewerId], season);

  const area = settings.get('bp_area') || 'Mov. Chat';
  const title = settings.get('ap_ranking_title') || `Ranking · ${area}`;
  const now = Math.floor(Date.now() / 1000);

  const body = rows.length
    ? rows
        .map((r) => {
          const t = totals.get(r.user_id) || { messages: 0, approved: 0 };
          return `${emojis.mark(r.position)}  <@${r.user_id}> · **${num(r.points)} pts** · \`${num(t.messages)} msgs · ${t.approved} bp\``;
        })
        .join('\n')
    : '*Ainda não há pontuações nesta temporada.*';

  let you = null;
  if (viewerId) {
    const pos = rankingService.getPosition(season.id, viewerId);
    const pts = pointsService.getScore(viewerId, season.id).points;
    const t = totals.get(viewerId) || { messages: 0, approved: 0 };
    you = text(`${viewerIsTarget ? `Posição de <@${viewerId}>` : '**Sua posição**'} · ${pos ? `**#${pad2(pos)}**` : '—'} · **${num(pts)} pts** · ${num(t.messages)} msgs`);
  }

  const custom = settings.get('ap_ranking_footer');
  const footer = `${custom ? `${custom} · ` : ''}Página ${p}/${pages} · Top ${rankingService.maxMembers()} · +${settings.get('bp_reward')} pts por bate-ponto aprovado (bp)`;

  const owner = ownerId || viewerId || '0';
  const nav = row(
    button(`or:go:${season.id}:${p - 1}:${owner}`, null, { emoji: '⬅️', disabled: p <= 1 }),
    button(`or:me:${season.id}:${owner}`, 'Minha posição', { emoji: '🏆', style: ButtonStyle.Primary }),
    button(`or:go:${season.id}:${p + 1}:${owner}`, null, { emoji: '➡️', disabled: p >= pages }),
    button(`or:seasons:${owner}`, 'Temporadas', { emoji: '🏅' })
  );
  const showBp = settings.get('bp_in_ranking') && (guildId === undefined || config.isInternal(guildId));

  const banner = settings.get('ap_ranking_banner');
  return card([
    text(`## ${title}\n-# ${area} · Temporada ${seasonLabel(season.number)} · ${statusLabel(season)} · Atualizado <t:${now}:R>`),
    banner ? new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(banner)) : null,
    divider(),
    text(body),
    you ? divider() : null,
    you,
    text(`-# ${footer}`),
    divider(),
    nav,
    showBp ? batePontoRow() : null,
  ]);
}

/** Lista de temporadas com menu de seleção. */
function buildSeasonsList({ ownerId }) {
  const tz = settings.get('timezone');
  const list = seasons.list(25);
  const lines = list.map((s) => {
    const range = `${fmtDate(s.started_at, tz)} → ${s.ended_at ? fmtDate(s.ended_at, tz) : 'em andamento'}`;
    return `**${seasonLabel(s.number)}** · ${statusLabel(s)}\n${muted(range)}`;
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`or:pick:${ownerId}`)
    .setPlaceholder('Escolha uma temporada')
    .addOptions(
      list.map((s) => ({
        label: `Temporada ${seasonLabel(s.number)} — ${statusLabel(s)}`,
        description: `${fmtDate(s.started_at, tz)} → ${s.ended_at ? fmtDate(s.ended_at, tz) : 'em andamento'}`,
        value: String(s.id),
        emoji: s.status === 'active' ? '🟢' : '📁',
      }))
    );
  return card([
    text(`## Temporadas\n-# Selecione uma temporada para ver o ranking dela.`),
    divider(),
    text(lines.join('\n\n')),
    divider(),
    row(menu),
    row(button(`or:go:${seasons.requireCurrent().id}:1:${ownerId}`, 'Voltar ao ranking', { emoji: '↩️' })),
  ]);
}

module.exports = { buildRanking, buildSeasonsList, getPerPage, batePontoRow, V2 };
