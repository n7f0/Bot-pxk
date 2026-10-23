'use strict';

const service = require('./service');
const visual = require('./visual');
const settings = require('../database/settings');
const theme = require('../theme');
const { baseEmbed, COLORS } = require('../utils/embeds');
const { SEP, formatDuration, humanDuration, percent } = require('../utils/format');
const { fmtDateTime } = require('../utils/time');
const { row, button } = require('../utils/interaction');

const code = (s) => `\`${s}\``;

/**
 * Painel público (servidor externo) com o botão de iniciar.
 * Todo o texto, rótulos, imagens e botões vêm de /painel → Visual.
 * preview = true devolve os botões desativados (pré-visualização no painel administrativo).
 */
function buildPublicPanel({ preview = false } = {}) {
  const cfg = service.getConfig();
  const v = visual.vars(cfg);
  const layout = settings.get('bpv_layout') === 'list' ? 'list' : 'fields';
  const rules = visual.bullets(visual.text('bpv_rules', v));
  const rulesTitle = visual.text('bpv_rules_title', v);
  const intro = cfg.enabled ? visual.text('bpv_intro', v) : visual.text('bpv_disabled_text', v);

  const infoRows = [
    [visual.text('bpv_l_time', v), code(v.tempo)],
    [visual.text('bpv_l_goal', v), `${code(v.meta)} mensagens`],
    [visual.text('bpv_l_reward', v), `**${v.recompensa}**`],
    [visual.text('bpv_l_channel', v), v.canal],
  ];

  const footerRaw = settings.get('bpv_footer');
  const embed = baseEmbed({
    title: visual.text('bpv_title', v),
    footer: footerRaw ? theme.render(footerRaw, v) : undefined,
    description:
      layout === 'list'
        ? [intro, SEP, infoRows.map(([k, val]) => `**${k}** · ${val}`).join('\n'), rules ? `${SEP}\n**${rulesTitle}**\n${rules}` : ''].filter(Boolean).join('\n')
        : `${intro}\n${SEP}`,
  });

  if (layout === 'fields') {
    embed.addFields(
      { name: infoRows[0][0], value: infoRows[0][1], inline: true },
      { name: infoRows[1][0], value: infoRows[1][1], inline: true },
      { name: infoRows[2][0], value: infoRows[2][1], inline: true },
      { name: infoRows[3][0], value: infoRows[3][1], inline: false }
    );
    if (rules) embed.addFields({ name: rulesTitle.slice(0, 256), value: rules.slice(0, 1024), inline: false });
  }

  const image = settings.get('bpv_image');
  const thumb = settings.get('bpv_thumb');
  if (image) embed.setImage(image);
  if (thumb) embed.setThumbnail(thumb);

  const components = [
    row(
      button('bp:start', visual.text('bpv_btn_start_label', v).slice(0, 80), {
        emoji: visual.emoji('bpv_btn_start_emoji'),
        style: visual.style('bpv_btn_start_style'),
        disabled: preview || !cfg.enabled,
      }),
      button('bp:view', visual.text('bpv_btn_view_label', v).slice(0, 80), {
        emoji: visual.emoji('bpv_btn_view_emoji'),
        style: visual.style('bpv_btn_view_style'),
        disabled: preview,
      })
    ),
  ];
  return { embeds: [embed], components };
}

/** Painel individual (ephemeral) do bate-ponto ativo. */
function buildActivePanel(s, { preview = false } = {}) {
  const cfg = service.getConfig();
  const v = visual.vars({ ...cfg, area: s.area }, { fim: fmtDateTime(s.ends_at, settings.get('timezone')).slice(11) });
  const snap = service.snapshot(s);
  const pct = percent(s.messages, s.goal);
  const [lTime, lMsgs, lProg] = String(visual.get('bpv_active_labels')).split(',').map((x) => x.trim());
  const l = [lTime || 'Tempo', lMsgs || 'Mensagens', lProg || 'Progresso'];

  const status = snap.goalMet
    ? `🟡 **Meta concluída** · bate-ponto ainda ativo\n⏳ Restam ${code(formatDuration(snap.remaining))}`
    : '🟢 **Em andamento**';

  const embed = baseEmbed({
    title: visual.text('bpv_t_active', v),
    color: snap.goalMet ? COLORS.gold : COLORS.success,
    footer: visual.text('bpv_active_footer', v),
    description: `<@${s.user_id}> · **${s.area}**\n${SEP}\n${status}`,
  }).addFields(
    { name: l[0], value: `${code(`${formatDuration(snap.elapsed)} / ${formatDuration(s.duration_ms)}`)}\n${theme.bar(snap.elapsed, s.duration_ms, 10)}`, inline: true },
    { name: l[1], value: `${code(`${s.messages} / ${s.goal}`)}\n${theme.bar(s.messages, s.goal, 10)}`, inline: true },
    { name: l[2], value: `**${pct}%**`, inline: true }
  );
  return {
    embeds: [embed],
    components: [
      row(
        button(`bp:refresh:${s.id}`, 'Atualizar', { emoji: '🔄', disabled: preview }),
        button(`bp:cancel:${s.id}`, 'Cancelar', { emoji: '🛑', disabled: preview })
      ),
    ],
  };
}

function buildStartedNotice(s) {
  const panel = buildActivePanel(s);
  const cfg = service.getConfig();
  panel.embeds[0].setTitle(visual.text('bpv_t_started', visual.vars({ ...cfg, area: s.area })).slice(0, 256));
  return panel;
}

function buildResult(s) {
  const tz = settings.get('timezone');
  const v = visual.vars({ ...service.getConfig(), area: s.area });
  const head = `<@${s.user_id}> · **${s.area}**\n${SEP}`;
  const stat = (k, val) => ({ name: k, value: val, inline: true });

  if (s.status === 'approved') {
    return baseEmbed({ title: visual.text('bpv_t_approved', v), color: COLORS.success, description: `${head}\n🎯 Meta cumprida` }).addFields(
      stat('Tempo', code(humanDuration(s.duration_ms))),
      stat('Mensagens', code(`${s.messages} / ${s.goal}`)),
      stat('Pontos', `**+${s.points_awarded}**`)
    );
  }
  if (s.status === 'rejected') {
    return baseEmbed({ title: visual.text('bpv_t_rejected', v), color: COLORS.danger, description: `${head}\n❌ Meta não atingida` }).addFields(
      stat('Tempo', code(humanDuration(s.duration_ms))),
      stat('Mensagens', code(`${s.messages} / ${s.goal}`)),
      stat('Pontos', '**0**')
    );
  }
  return baseEmbed({
    title: visual.text('bpv_t_cancelled', v),
    color: COLORS.neutral,
    description: `${head}\n💬 ${code(`${s.messages} / ${s.goal}`)}\n🕐 ${fmtDateTime(s.ended_at, tz)}\n📝 ${s.result_note || '—'}`,
  });
}

/** Log para o servidor INTERNO (#logs-bate-ponto). */
function buildLogEmbed(s) {
  const tz = settings.get('timezone');
  const v = visual.vars({ ...service.getConfig(), area: s.area });
  const result = { approved: '✅ Aprovado', rejected: '❌ Reprovado', cancelled: '🛑 Cancelado' }[s.status] || s.status;
  const color = { approved: COLORS.success, rejected: COLORS.danger }[s.status] || COLORS.neutral;
  return baseEmbed({
    title: `${visual.text('bpv_t_log', v)}`,
    color,
    footer: 'Log interno · Não compartilhar',
    description: [
      `👤 **Usuário:** <@${s.user_id}>`,
      `🎖️ **Cargo:** ${s.role_name || '—'}`,
      `🏷️ **Área:** ${s.area}`,
      SEP,
      `🟢 **Início:** ${fmtDateTime(s.started_at, tz)}`,
      `🔴 **Término:** ${fmtDateTime(s.ended_at, tz)}`,
      `⏱️ **Tempo:** ${humanDuration(s.duration_ms)}`,
      `💬 **Mensagens:** ${s.messages} / ${s.goal}`,
      `🎯 **Meta:** ${s.messages >= s.goal ? 'Cumprida' : 'Não cumprida'}`,
      `📌 **Resultado:** ${result}`,
      `🏆 **Pontos recebidos:** ${s.points_awarded}`,
    ].join('\n'),
  });
}

function buildGoalNotice(s) {
  const snap = service.snapshot(s);
  const v = visual.vars({ ...service.getConfig(), area: s.area });
  return baseEmbed({
    title: `${visual.text('bpv_t_goal', v)}`,
    color: COLORS.gold,
    description: `<@${s.user_id}> atingiu ${code(`${s.messages}/${s.goal}`)} mensagens.\n${SEP}\n⏱️ Bate-ponto **ainda ativo**\n⏳ Tempo restante: **${formatDuration(snap.remaining)}**`,
  });
}

/** Log interno: usuário atingiu a meta (o bate-ponto continua ativo). */
function buildGoalLog(s) {
  const snap = service.snapshot(s);
  const v = visual.vars({ ...service.getConfig(), area: s.area });
  return baseEmbed({
    title: `${visual.text('bpv_t_goal', v)}`,
    color: COLORS.gold,
    footer: 'Log interno · Não compartilhar',
    description: `👤 **Usuário:** <@${s.user_id}>\n🏷️ **Área:** ${s.area}\n💬 **Mensagens:** ${s.messages} / ${s.goal}\n⏳ **Tempo restante:** ${formatDuration(snap.remaining)}\n📌 Bate-ponto **ainda ativo**.`,
  });
}

module.exports = { buildGoalLog, buildPublicPanel, buildActivePanel, buildStartedNotice, buildResult, buildLogEmbed, buildGoalNotice };
