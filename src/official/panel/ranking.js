'use strict';

const { StringSelectMenuBuilder } = require('discord.js');
const seasons = require('../seasons/service');
const seasonActions = require('../seasons/actions');
const rankingService = require('../ranking/service');
const settings = require('../database/settings');
const { requirePermission } = require('../permissions');
const { baseEmbed, successEmbed, errorEmbed, warnEmbed, COLORS } = require('../utils/embeds');
const { SEP, num, pad2, posEmoji, parseIntStrict } = require('../utils/format');
const { WEEKDAYS, fmtDate, fmtDateTime, parseHHMM, isValidTimezone } = require('../utils/time');
const { row, button, buildModal, updateOrReply, ButtonStyle } = require('../utils/interaction');
const { menuButton, backButton, onOff, adminLog } = require('./util');

function render() {
  const tz = settings.get('timezone');
  const season = seasons.requireCurrent();
  const stats = seasons.computeStats(season.id, season.started_at);
  const embed = baseEmbed({
    title: 'Ranking · Gerenciamento',
    color: COLORS.gold,
    description: [
      `🏅 **Temporada atual:** #${pad2(season.number)} (desde ${fmtDateTime(season.started_at, tz)})`,
      `👥 **Participantes:** ${num(stats.ranked)}  •  ⭐ **Pontos em jogo:** ${num(stats.total_points)}`,
      SEP,
      `🔄 **Reset semanal:** ${onOff(settings.get('reset_enabled'))}`,
      settings.get('reset_enabled') ? `└ ${WEEKDAYS[settings.get('reset_day')]} às ${settings.get('reset_time')} (${tz})` : '',
      `📄 **Itens por página:** ${settings.get('per_page')} • 👥 **Máx. de membros:** ${settings.get('rank_max')}`,
      `🌎 **Fuso horário:** ${tz}`,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  return {
    embeds: [embed],
    components: [
      row(
        button('panel:ranking:reset', 'Reset manual', { emoji: '🔄', style: ButtonStyle.Danger }),
        button('panel:ranking:weekly', 'Reset semanal', { emoji: '📅' }),
        button('panel:ranking:seasons', 'Temporadas', { emoji: '🏅' }),
        button('panel:ranking:history', 'Histórico', { emoji: '📜' }),
        button('panel:ranking:config', 'Configurar', { emoji: '⚙️' })
      ),
      row(menuButton()),
    ],
  };
}

function renderWeekly() {
  const enabled = settings.get('reset_enabled');
  const embed = baseEmbed({
    title: 'Reset semanal',
    color: COLORS.warning,
    description: [
      `**Reset semanal:**\n${enabled ? '✅ ATIVADO' : '❌ DESATIVADO'}`,
      '',
      `**Dia:**\n${WEEKDAYS[settings.get('reset_day')]}`,
      '',
      `**Horário:**\n${settings.get('reset_time')}`,
      '',
      `**Fuso horário:**\n${settings.get('timezone')}`,
      SEP,
      'Ao chegar o horário, o bot **encerra a temporada atual, arquiva o ranking e inicia uma nova**. Se o bot estiver offline no horário, o reset acontece assim que voltar.',
    ].join('\n'),
  });
  const day = new StringSelectMenuBuilder()
    .setCustomId('panel:ranking:wday')
    .setPlaceholder('Dia da semana do reset')
    .addOptions(WEEKDAYS.map((d, i) => ({ label: d, value: String(i), default: i === settings.get('reset_day') })));
  return {
    embeds: [embed],
    components: [
      row(day),
      row(
        button('panel:ranking:wtoggle', enabled ? 'Desativar' : 'Ativar', { emoji: enabled ? '⏹️' : '▶️', style: enabled ? ButtonStyle.Danger : ButtonStyle.Success }),
        button('panel:ranking:wtime', 'Horário e fuso', { emoji: '🕐' }),
        backButton('ranking')
      ),
    ],
  };
}

function seasonSelect(customId = 'panel:ranking:seasonpick') {
  const tz = settings.get('timezone');
  const list = seasons.list(25);
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Ver o ranking de uma temporada')
    .addOptions(
      list.map((s) => ({
        label: `Temporada #${pad2(s.number)} — ${s.status === 'active' ? 'Atual' : 'Encerrada'}`,
        description: `${fmtDate(s.started_at, tz)} → ${s.ended_at ? fmtDate(s.ended_at, tz) : 'em andamento'}`,
        value: String(s.id),
      }))
    );
}

function renderSeasons() {
  const tz = settings.get('timezone');
  const lines = seasons.list(10).map((s) => `**#${pad2(s.number)}** — ${s.status === 'active' ? '🟢 Atual' : '📁 Encerrada'}\n└ ${fmtDate(s.started_at, tz)} → ${s.ended_at ? fmtDate(s.ended_at, tz) : 'em andamento'}`);
  return {
    embeds: [baseEmbed({ title: 'Temporadas', color: COLORS.gold, description: `${SEP}\n\n${lines.join('\n\n')}` })],
    components: [row(seasonSelect()), row(backButton('ranking'))],
  };
}

function renderSeasonRanking(seasonId) {
  const season = seasons.getById(seasonId);
  if (!season) return renderSeasons();
  const rows = rankingService.getPage(season.id, 1, 10);
  const lines = rows.length ? rows.map((r) => `${posEmoji(r.position)} **#${pad2(r.position)}** <@${r.user_id}> — ⭐ ${num(r.points)}`) : ['Sem pontuações nesta temporada.'];
  const stats = seasons.parseStats(season) || seasons.computeStats(season.id, season.started_at);
  return {
    embeds: [
      baseEmbed({
        title: `Temporada #${pad2(season.number)} · ${season.status === 'active' ? 'Atual' : 'Encerrada'}`,
        color: COLORS.gold,
        description: `${lines.join('\n')}\n${SEP}\n👥 ${stats.ranked} participantes • ⭐ ${num(stats.total_added)} distribuídos • ➖ ${num(stats.total_removed)} removidos • 🔄 ${num(stats.changes)} alterações\n⏱️ Bate-pontos: ${stats.bateponto_approved} aprovados / ${stats.bateponto_rejected} reprovados`,
      }),
    ],
    components: [row(seasonSelect()), row(backButton('ranking', 'seasons'))],
  };
}

function renderHistory() {
  const tz = settings.get('timezone');
  const closed = seasons.list(25).filter((s) => s.status === 'closed').slice(0, 8);
  const embed = baseEmbed({ title: 'Histórico de temporadas', color: COLORS.brand });
  if (!closed.length) embed.setDescription('Nenhuma temporada encerrada ainda.');
  for (const s of closed) {
    const st = seasons.parseStats(s) || {};
    embed.addFields({
      name: `Temporada #${pad2(s.number)} • ${fmtDate(s.started_at, tz)} → ${fmtDate(s.ended_at, tz)}`,
      value: `🏆 ${st.winner ? `<@${st.winner.user_id}> (${num(st.winner.points)} pts)` : '—'}\n👥 ${st.ranked ?? 0} • ⭐ ${num(st.total_added ?? 0)} distribuídos • 🔄 ${num(st.changes ?? 0)} alterações\n📝 ${s.close_reason || '—'}${s.closed_by ? ` • <@${s.closed_by}>` : ''}`,
    });
  }
  return { embeds: [embed], components: [row(seasonSelect(), ), row(backButton('ranking'))] };
}

async function handle(interaction, action, args) {
  if (action === 'view') return interaction.update(render());

  if (action === 'reset') {
    if (!(await requirePermission(interaction, 'reset_ranking'))) return;
    const season = seasons.requireCurrent();
    return interaction.update({
      embeds: [
        warnEmbed(
          `Você está prestes a **encerrar a temporada atual (#${pad2(season.number)})**.\n\nOs dados serão arquivados e uma nova temporada será criada.`,
          '⚠️ ATENÇÃO'
        ),
      ],
      components: [
        row(
          button(`panel:ranking:resetok:${season.id}`, 'Confirmar Reset', { emoji: '✅', style: ButtonStyle.Danger }),
          button('panel:ranking:view', 'Cancelar', { emoji: '❌' })
        ),
      ],
    });
  }

  if (action === 'resetok') {
    if (!(await requirePermission(interaction, 'reset_ranking'))) return;
    const current = seasons.requireCurrent();
    if (String(current.id) !== args[0]) {
      return interaction.update({ embeds: [errorEmbed('Esta confirmação expirou (a temporada já mudou).')], components: render().components });
    }
    await interaction.deferUpdate();
    try {
      const res = await seasonActions.resetSeason({ actorId: interaction.user.id, reason: 'Reset manual pelo painel' });
      return interaction.editReply({
        embeds: [successEmbed(`Temporada **#${pad2(res.closed.number)}** encerrada e arquivada.\nNova temporada **#${pad2(res.created.number)}** iniciada.`, 'Ranking resetado')],
        components: render().components,
      });
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed(err.message)], components: render().components });
    }
  }

  if (action === 'weekly') {
    if (!(await requirePermission(interaction, 'manage_ranking'))) return;
    return interaction.update(renderWeekly());
  }

  if (action === 'wtoggle') {
    if (!(await requirePermission(interaction, 'manage_ranking'))) return;
    const next = !settings.get('reset_enabled');
    settings.set('reset_enabled', next);
    if (next) settings.set('reset_enabled_at', Date.now());
    await adminLog(interaction, 'config_reset_weekly', 'Reset semanal alterado', `🔄 Reset semanal: **${next ? 'ATIVADO' : 'DESATIVADO'}** (${WEEKDAYS[settings.get('reset_day')]} às ${settings.get('reset_time')})`);
    return interaction.update(renderWeekly());
  }

  if (action === 'wday') {
    if (!(await requirePermission(interaction, 'manage_ranking'))) return;
    const day = Number(interaction.values[0]);
    settings.set('reset_day', day);
    if (settings.get('reset_enabled')) settings.set('reset_enabled_at', Date.now());
    await adminLog(interaction, 'config_reset_weekly', 'Dia do reset semanal alterado', `📅 Novo dia: **${WEEKDAYS[day]}**`);
    return interaction.update(renderWeekly());
  }

  if (action === 'wtime') {
    if (!(await requirePermission(interaction, 'manage_ranking'))) return;
    return interaction.showModal(
      buildModal('panel:ranking:wtimesub', 'Horário do reset semanal', [
        { id: 'time', label: 'Horário (HH:MM, 24h)', value: settings.get('reset_time'), placeholder: '23:59', max: 5 },
        { id: 'tz', label: 'Fuso horário (IANA)', value: settings.get('timezone'), placeholder: 'America/Sao_Paulo', max: 60 },
      ])
    );
  }

  if (action === 'wtimesub') {
    if (!(await requirePermission(interaction, 'manage_ranking'))) return;
    const hm = parseHHMM(interaction.fields.getTextInputValue('time'));
    const tz = interaction.fields.getTextInputValue('tz').trim();
    if (!hm) return updateOrReply(interaction, { embeds: [errorEmbed('Horário inválido. Use o formato **HH:MM** (ex.: 23:59).')], components: renderWeekly().components });
    if (!isValidTimezone(tz)) return updateOrReply(interaction, { embeds: [errorEmbed('Fuso horário inválido. Exemplo: `America/Sao_Paulo`.')], components: renderWeekly().components });
    settings.set('reset_time', hm.text);
    settings.set('timezone', tz);
    if (settings.get('reset_enabled')) settings.set('reset_enabled_at', Date.now());
    await adminLog(interaction, 'config_reset_weekly', 'Horário do reset semanal alterado', `🕐 Novo horário: **${hm.text}** (${tz})`);
    return updateOrReply(interaction, renderWeekly());
  }

  if (action === 'seasons') {
    if (!(await requirePermission(interaction, 'manage_seasons'))) return;
    return interaction.update(renderSeasons());
  }

  if (action === 'seasonpick') {
    if (!(await requirePermission(interaction, 'manage_seasons'))) return;
    return interaction.update(renderSeasonRanking(Number(interaction.values[0])));
  }

  if (action === 'history') {
    if (!(await requirePermission(interaction, 'manage_seasons'))) return;
    return interaction.update(renderHistory());
  }

  if (action === 'config') {
    if (!(await requirePermission(interaction, 'manage_ranking'))) return;
    return interaction.showModal(
      buildModal('panel:ranking:cfgsub', 'Configurar ranking', [
        { id: 'per_page', label: 'Itens por página (5 a 20)', value: settings.get('per_page'), max: 2 },
        { id: 'rank_max', label: `Máximo de membros no ranking (10 a ${rankingService.RANK_MAX_LIMIT})`, value: settings.get('rank_max'), max: 3 },
      ])
    );
  }

  if (action === 'cfgsub') {
    if (!(await requirePermission(interaction, 'manage_ranking'))) return;
    const n = parseIntStrict(interaction.fields.getTextInputValue('per_page'));
    const max = parseIntStrict(interaction.fields.getTextInputValue('rank_max'));
    if (n === null || n < 5 || n > 20) return updateOrReply(interaction, { embeds: [errorEmbed('Itens por página: informe um número entre **5** e **20**.')], components: render().components });
    if (max === null || max < 10 || max > rankingService.RANK_MAX_LIMIT) return updateOrReply(interaction, { embeds: [errorEmbed(`Máximo de membros: informe um número entre **10** e **${rankingService.RANK_MAX_LIMIT}**.`)], components: render().components });
    const old = settings.get('per_page');
    const oldMax = settings.get('rank_max');
    settings.set('per_page', n);
    settings.set('rank_max', max);
    await adminLog(interaction, 'config_ranking', 'Configuração do ranking alterada', `📄 Itens por página: **${old}** → **${n}**\n👥 Máx. de membros: **${oldMax}** → **${max}**`);
    return updateOrReply(interaction, render());
  }
}

module.exports = { render, handle };
