'use strict';

const { StringSelectMenuBuilder, ChannelType } = require('discord.js');
const service = require('../bateponto/service');
const actions = require('../bateponto/actions');
const settings = require('../database/settings');
const config = require('../config');
const { requirePermission } = require('../permissions');
const { baseEmbed, successEmbed, errorEmbed, COLORS } = require('../utils/embeds');
const { SEP, humanDuration, parseDuration, parseIntStrict, formatDuration, progressBar, truncate } = require('../utils/format');
const { fmtDateTime } = require('../utils/time');
const { row, button, buildModal, updateOrReply, ButtonStyle } = require('../utils/interaction');
const { menuButton, backButton, onOff, parseChannelId, adminLog } = require('./util');
const { h, muted } = require('../utils/layout');
const publisher = require('../ranking/publisher');

function render() {
  const cfg = service.getConfig();
  const active = service.listActive().length;
  const panelCh = settings.get('bp_panel_channel_id');
  const rankCh = settings.get('rank_channel_id');
  const inRanking = Boolean(settings.get('bp_in_ranking'));
  const startWhere = inRanking && rankCh ? `Junto do ranking em <#${rankCh}>` : panelCh ? `Painel próprio em <#${panelCh}>` : '⚠️ *não publicado*';

  const embed = baseEmbed({
    title: 'Bate-ponto · Configuração',
    color: COLORS.success,
    timestamp: false,
    footer: `${cfg.area} · As alterações valem para os próximos bate-pontos`,
    description: `${muted('O membro inicia pelo servidor interno; as mensagens são validadas no canal de contagem.')}\n${SEP}`,
  }).addFields(
    { name: 'Status', value: onOff(cfg.enabled), inline: true },
    { name: 'Área', value: cfg.area, inline: true },
    { name: 'Ativos agora', value: `**${active}**`, inline: true },
    { name: 'Tempo mínimo', value: `**${humanDuration(cfg.durationMin * 60000)}**`, inline: true },
    { name: 'Meta', value: `**${cfg.goal}** mensagens`, inline: true },
    { name: 'Recompensa', value: `**+${cfg.reward}** pontos`, inline: true },
    { name: 'Canal de contagem', value: cfg.channelId ? `<#${cfg.channelId}>` : '⚠️ *não configurado*', inline: true },
    { name: 'Anti-flood', value: `${cfg.cooldownSec}s entre mensagens`, inline: true },
    { name: 'Botão de iniciar', value: startWhere, inline: false }
  );
  return {
    embeds: [embed],
    components: [
      row(
        button('panel:bateponto:time', 'Tempo', { emoji: '⏱️' }),
        button('panel:bateponto:goal', 'Meta', { emoji: '💬' }),
        button('panel:bateponto:reward', 'Recompensa', { emoji: '🏆' }),
        button('panel:bateponto:area', 'Área', { emoji: '🏷️' }),
        button('panel:bateponto:cd', 'Anti-flood', { emoji: '🛡️' })
      ),
      row(
        button('panel:bateponto:chan', 'Canal de contagem', { emoji: '📍' }),
        button('panel:bateponto:pub', 'Publicar painel', { emoji: '📢', style: ButtonStyle.Primary }),
        button('panel:bateponto:inrank', `No ranking: ${inRanking ? 'sim' : 'não'}`, { emoji: '🏆' }),
        button('panel:bateponto:list', 'Acompanhar', { emoji: '👁️' }),
        button('panel:bateponto:toggle', cfg.enabled ? 'Desativar' : 'Ativar', { emoji: cfg.enabled ? '⏹️' : '▶️', style: cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success })
      ),
      row(button('panel:visual:view', 'Visual e mensagens', { emoji: '🖌️' }), menuButton()),
    ],
  };
}

function renderList() {
  const tz = settings.get('timezone');
  const active = service.listActive();
  const recent = service.listRecent(8);
  const activeLines = active.length
    ? active.slice(0, 15).map((s) => {
        const snap = service.snapshot(s);
        return `<@${s.user_id}> · \`${formatDuration(snap.elapsed)}/${formatDuration(s.duration_ms)}\` · \`${s.messages}/${s.goal} msgs\`${snap.goalMet ? ' · meta ok' : ''}\n${progressBar(s.messages, s.goal, 10)}`;
      })
    : ['*Nenhum bate-ponto ativo.*'];
  const icon = { approved: '✅', rejected: '❌', cancelled: '🛑' };
  const recentLines = recent.length
    ? recent.map((s) => `${icon[s.status] || '•'} <@${s.user_id}> · \`${s.messages}/${s.goal}\` · +${s.points_awarded} · ${muted(fmtDateTime(s.ended_at, tz))}`)
    : ['*Nenhum bate-ponto finalizado ainda.*'];
  const embed = baseEmbed({
    title: 'Bate-pontos · Acompanhamento',
    color: COLORS.brand,
    timestamp: false,
    description: `${h(`Ativos (${active.length})`)}\n${activeLines.join('\n\n')}\n${SEP}\n${h('Últimos finalizados')}\n${recentLines.join('\n')}`,
  });
  const components = [];
  if (active.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId('panel:bateponto:cancelpick')
          .setPlaceholder('Cancelar um bate-ponto ativo…')
          .addOptions(active.slice(0, 25).map((s) => ({ label: truncate(`Sessão #${s.id}`, 100), description: `Usuário ${s.user_id} • ${s.messages}/${s.goal} msgs`, value: String(s.id), emoji: '🛑' })))
      )
    );
  }
  components.push(row(backButton('bateponto'), button('panel:bateponto:list', 'Atualizar', { emoji: '🔄' })));
  return { embeds: [embed], components };
}

const FIELDS = {
  time: { perm: 'manage_bateponto', title: 'Tempo do bate-ponto', label: 'Tempo (ex.: 2h, 90m, 1h30)', current: () => `${settings.get('bp_duration_min')}m` },
  goal: { title: 'Meta de mensagens', label: 'Meta (nº de mensagens)', current: () => settings.get('bp_goal') },
  reward: { title: 'Recompensa', label: 'Pontos de recompensa', current: () => settings.get('bp_reward') },
  area: { title: 'Área', label: 'Nome da área', current: () => settings.get('bp_area') },
  cd: { title: 'Anti-flood', label: 'Segundos entre mensagens contadas (0-60)', current: () => settings.get('bp_cooldown_sec') },
  chan: { title: 'Canal de contagem', label: 'Canal de contagem (ID do servidor externo)', current: () => settings.get('bp_channel_id') || '' },
  pub: { title: 'Publicar painel no servidor interno', label: 'Canal do painel (ID, servidor interno)', current: () => settings.get('bp_panel_channel_id') || settings.get('bp_channel_id') || '' },
};

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/** Canal de CONTAGEM: normalmente do servidor externo (informado por ID). Aceita qualquer servidor configurado. */
async function resolveCountChannel(interaction, raw) {
  const id = parseChannelId(raw);
  if (!id) return { error: 'Informe o ID ou a #menção do canal.' };
  const channel = await interaction.client.channels.fetch(id).catch(() => null);
  if (!channel || !config.isKnownGuild(channel.guildId)) return { error: 'Canal não encontrado. O bot precisa estar no servidor desse canal (normalmente o **externo**).' };
  if (!TEXT_TYPES.includes(channel.type)) return { error: 'O canal precisa ser de texto.' };
  return { channel };
}

/** Canal do PAINEL de iniciar: sempre do servidor interno. */
async function resolveInternalChannel(interaction, raw) {
  const id = parseChannelId(raw);
  if (!id) return { error: 'Informe o ID ou a #menção do canal.' };
  const channel = await interaction.client.channels.fetch(id).catch(() => null);
  if (!channel || channel.guildId !== config.internalGuildId) return { error: 'Canal não encontrado no **servidor interno**.' };
  if (!TEXT_TYPES.includes(channel.type)) return { error: 'O canal precisa ser de texto.' };
  return { channel };
}

async function applySubmit(interaction, field, raw) {
  const fail = (msg) => ({ error: msg });
  switch (field) {
    case 'time': {
      const ms = parseDuration(raw);
      if (!ms || ms < 60000 || ms > 24 * 3600000) return fail('Tempo inválido. Use de **1 minuto** a **24 horas** (ex.: `2h`, `90m`, `1h30`).');
      const old = settings.get('bp_duration_min');
      settings.set('bp_duration_min', Math.round(ms / 60000));
      return { log: `⏱️ Tempo: **${humanDuration(old * 60000)}** → **${humanDuration(ms)}**` };
    }
    case 'goal': {
      const n = parseIntStrict(raw);
      if (n === null || n < 1 || n > 100000) return fail('Meta inválida (1 a 100000).');
      const old = settings.get('bp_goal');
      settings.set('bp_goal', n);
      return { log: `💬 Meta: **${old}** → **${n}**` };
    }
    case 'reward': {
      const n = parseIntStrict(raw);
      if (n === null || n < 0 || n > config.limits.maxPoints) return fail('Recompensa inválida.');
      const old = settings.get('bp_reward');
      settings.set('bp_reward', n);
      return { log: `🏆 Recompensa: **+${old}** → **+${n}**` };
    }
    case 'area': {
      const v = String(raw).trim();
      if (v.length < 2 || v.length > 40) return fail('O nome da área deve ter de 2 a 40 caracteres.');
      const old = settings.get('bp_area');
      settings.set('bp_area', v);
      return { log: `🏷️ Área: **${old}** → **${v}**` };
    }
    case 'cd': {
      const n = parseIntStrict(raw);
      if (n === null || n < 0 || n > 60) return fail('Informe de 0 a 60 segundos.');
      const old = settings.get('bp_cooldown_sec');
      settings.set('bp_cooldown_sec', n);
      return { log: `🛡️ Anti-flood: **${old}s** → **${n}s**` };
    }
    case 'chan': {
      const r = await resolveCountChannel(interaction, raw);
      if (r.error) return fail(r.error);
      const old = settings.get('bp_channel_id');
      settings.set('bp_channel_id', r.channel.id);
      return { log: `📍 Canal de contagem: ${old ? `<#${old}>` : '—'} → <#${r.channel.id}>` };
    }
    case 'pub': {
      const r = await resolveInternalChannel(interaction, raw);
      if (r.error) return fail(r.error);
      try {
        await actions.publishPanel(r.channel);
      } catch (err) {
        return fail(`Não consegui publicar no canal (verifique as permissões do bot): ${err.message}`);
      }
      return { log: `📢 Painel público publicado em <#${r.channel.id}>`, notice: `Painel publicado em <#${r.channel.id}>.` };
    }
    default:
      return fail('Campo desconhecido.');
  }
}

async function handle(interaction, action, args = []) {
  if (!(await requirePermission(interaction, 'manage_bateponto'))) return;

  if (action === 'view') return interaction.update(render());
  if (action === 'list') return interaction.update(renderList());

  if (FIELDS[action]) {
    const f = FIELDS[action];
    return interaction.showModal(buildModal(`panel:bateponto:sub:${action}`, f.title, [{ id: 'value', label: f.label, value: f.current(), max: 100 }]));
  }

  if (action === 'sub') {
    const field = args[0];
    const res = await applySubmit(interaction, field, interaction.fields.getTextInputValue('value'));
    if (res.error) return updateOrReply(interaction, { embeds: [errorEmbed(res.error)], components: render().components });
    await adminLog(interaction, 'config_bateponto', 'Configuração do bate-ponto alterada', res.log);
    if (field !== 'pub') await actions.refreshPublicPanel(interaction.client);
    const view = render();
    if (res.notice) view.embeds.unshift(successEmbed(res.notice));
    return updateOrReply(interaction, view);
  }

  if (action === 'inrank') {
    const next = !settings.get('bp_in_ranking');
    settings.set('bp_in_ranking', next);
    await adminLog(interaction, 'config_bateponto', 'Bate-ponto no ranking', `🏆 Botões do bate-ponto junto do ranking: **${next ? 'ATIVADOS' : 'DESATIVADOS'}**`);
    publisher.refresh({ force: true }).catch(() => {});
    return interaction.update(render());
  }

  if (action === 'toggle') {
    const next = !settings.get('bp_enabled');
    settings.set('bp_enabled', next);
    await adminLog(interaction, 'config_bateponto', 'Bate-ponto ' + (next ? 'ativado' : 'desativado'), `🔘 Status: **${next ? 'ATIVADO' : 'DESATIVADO'}**`);
    await actions.refreshPublicPanel(interaction.client);
    return interaction.update(render());
  }

  if (action === 'cancelpick') {
    const id = Number(interaction.values[0]);
    await actions.cancelSession(interaction.client, id, { actorId: interaction.user.id, note: `Cancelado por ${interaction.user.tag || interaction.user.id}` });
    return interaction.update(renderList());
  }
}

module.exports = { render, handle };
