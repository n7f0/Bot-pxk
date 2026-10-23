'use strict';

const { baseEmbed, COLORS } = require('../utils/embeds');
const settings = require('../database/settings');
const { fmtDateTime } = require('../utils/time');
const { signed, SEP } = require('../utils/format');
const { muted } = require('../utils/layout');
const { row, button, ButtonStyle } = require('../utils/interaction');

const TYPE_LABEL = {
  adicionar: 'Adição manual',
  remover: 'Remoção manual',
  definir: 'Definição manual',
  'bate-ponto': 'Bate-ponto',
  sistema: 'Sistema',
};

function buildChangeEmbed(entry, { footer } = {}) {
  const tz = settings.get('timezone');
  const color = entry.delta > 0 ? COLORS.success : entry.delta < 0 ? COLORS.danger : COLORS.neutral;
  const actor = entry.actorId ? `<@${entry.actorId}>` : 'Sistema';
  return baseEmbed({
    title: 'Alteração de pontos',
    color,
    footer,
    description: [
      `<@${entry.userId}> · ${TYPE_LABEL[entry.type] || entry.type}`,
      muted(`Por ${actor} · ${fmtDateTime(entry.createdAt, tz)}`),
      SEP,
      `**Motivo:** ${entry.reason || 'Não informado'}`,
    ].join('\n'),
  }).addFields(
    { name: 'Antes', value: `${entry.before}`, inline: true },
    { name: 'Alteração', value: `**${signed(entry.delta)}**`, inline: true },
    { name: 'Depois', value: `**${entry.after}**`, inline: true }
  );
}

const PAGE_SIZE = 5;

/** Histórico paginado. ownerId = quem pode paginar (os demais recebem uma cópia ephemeral). */
function buildHistoryPage(service, { userId, page, ownerId, withMenu = false }) {
  const tz = settings.get('timezone');
  const total = service.countHistory(userId);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);
  const rows = service.getHistory(userId, { limit: PAGE_SIZE, offset: (p - 1) * PAGE_SIZE });

  const lines = rows.length
    ? rows.map((h) =>
        [
          `**#${h.id}** · Temporada #${String(h.season_number).padStart(2, '0')} · ${TYPE_LABEL[h.type] || h.type}`,
          `${h.points_before} → **${signed(h.delta)}** → **${h.points_after}**`,
          muted(`${h.actor_id ? `<@${h.actor_id}>` : 'Sistema'} · ${fmtDateTime(h.created_at, tz)}`),
          `${h.reason || '*Sem motivo informado*'}`,
        ].join('\n')
      )
    : ['*Nenhuma alteração registrada para este usuário.*'];

  const embed = baseEmbed({
    title: 'Histórico de pontuação',
    description: `<@${userId}>\n${SEP}\n${lines.join(`\n${SEP}\n`)}`,
    footer: `Página ${p}/${pages} · ${total} alteração(ões)`,
    color: COLORS.brand,
  });

  const nav = [
    button(`hist:${userId}:${p - 1}:${ownerId}`, 'Anterior', { emoji: '⬅️', disabled: p <= 1 }),
    button(`hist:${userId}:${p + 1}:${ownerId}`, 'Próxima', { emoji: '➡️', disabled: p >= pages }),
  ];
  if (withMenu) nav.push(button('panel:points:view', 'Voltar', { emoji: '↩️', style: ButtonStyle.Secondary }));
  return { embeds: [embed], components: [row(...nav)] };
}

module.exports = { buildChangeEmbed, buildHistoryPage, TYPE_LABEL };
