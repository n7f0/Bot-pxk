const {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const { getCfg, setCfg, MemberStat, Season, getSeason } = require('./db');
const { COLORS, render, fmt, fmtDuration, parseColor, perms, ts, row } = require('./core');
const { lifetimeStats } = require('./points');
const { E, Eb, rankEmoji } = require('./emojis');

const SORTS = {
  crystals: { label: 'Pontos', field: 'crystals' },
  hours: { label: 'Horas válidas em call', field: 'voiceSec' },
  movs: { label: 'MOVs oficiais concluídos', field: 'movs' },
  monitor: { label: 'Bônus de monitoria', field: 'monitorPoints' },
  goals: { label: 'Metas concluídas', field: 'goalsDone' },
};

const valueOf = (sortKey, st) => (sortKey === 'hours' ? fmtDuration(st.voiceSec) : fmt(st[SORTS[sortKey].field]));
const unitOf = (sortKey, cfg) =>
  ({ crystals: cfg.points.unit, hours: '', movs: 'MOVs', monitor: cfg.points.unit, goals: 'metas' })[sortKey];

async function topStats(sortKey, seasonId, limit) {
  const f = SORTS[sortKey].field;
  const filter = { seasonId, [f]: sortKey === 'crystals' ? { $ne: 0 } : { $gt: 0 } };
  return MemberStat.find(filter)
    .sort({ [f]: -1, crystals: -1, voiceSec: -1 })
    .limit(limit)
    .lean();
}

function lineFor(cfg, sortKey, st, pos) {
  return render(cfg.ranking.lineTemplate, {
    emoji: rankEmoji(pos),
    posicao: pos,
    usuario: `<@${st.userId}>`,
    tag: st.tag || st.userId,
    valor: valueOf(sortKey, st),
    unidade: unitOf(sortKey, cfg),
    cristais: fmt(st.crystals),
    horas: fmtDuration(st.voiceSec),
    movs: st.movs,
    metas: st.goalsDone,
    // MOV Call
    mcfeitas: st.mcDone || 0,
    mcaprov: st.mcApproved || 0,
    mcreprov: st.mcRejected || 0,
    horasmov: fmtDuration(st.mcSec || 0),
    monitorias: st.monitoredCount || 0,
    pontosmon: fmt(st.monitorPoints || 0),
    iconMov: E('movcall'),
    iconTempo: E('time'),
    iconMon: E('btnMovMonitor'),
    iconOk: E('mcOk'),
    iconBad: E('mcBad'),
    iconCristal: E('crystal'),
  }).trim();
}

const legendText = () =>
  `-# ${E('mcOk')} **Aprovadas / ${E('mcBad')} Reprovadas** = resultado da monitoria nas MOVs da pessoa • **MOVs concluídas** = MOVs feitas com a presença mínima • **Tempo em call** = horas válidas em call • **Monitorias feitas** = quantas vezes ela monitorou outro membro`;

const seasonsBtn = () =>
  new ButtonBuilder().setCustomId('rk:seasons').setLabel('Temporadas').setEmoji(Eb('seasonsBtn')).setStyle(ButtonStyle.Secondary);
function navRow(page, pages, sortKey, season) {
  const sn = season.number || 0;
  if (pages <= 1) return row(seasonsBtn());
  return row(
    new ButtonBuilder()
      .setCustomId(`rk:go:${page - 1}:${sortKey}:${sn}`)
      .setEmoji(Eb('prev'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('rk:noop')
      .setLabel(`Página ${page + 1}/${pages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`rk:go:${page + 1}:${sortKey}:${sn}`)
      .setEmoji(Eb('next'))
      .setStyle(ButtonStyle.Secondary),
    seasonsBtn(),
  );
}

async function buildRankingPayload(cfg, { sortKey = null, season = null, page = 0 } = {}) {
  const r = cfg.ranking;
  sortKey = SORTS[sortKey] ? sortKey : SORTS[r.sortBy] ? r.sortBy : 'crystals';
  season = season || (await getSeason());
  const pageSize = Math.max(1, Math.min(15, r.pageSize || 10));
  const stats = await topStats(sortKey, season._id, Math.max(1, Math.min(100, r.topSize || 100)));
  const pages = Math.max(1, Math.ceil(stats.length / pageSize));
  page = (((Math.trunc(Number(page)) || 0) % pages) + pages) % pages;
  const offset = page * pageSize;
  const lines = stats.slice(offset, offset + pageSize).map((s, i) => lineFor(cfg, sortKey, s, offset + i + 1));
  const body = lines.join('\n') || r.emptyText;
  const footer = render(r.footer, {
    top: stats.length,
    total: stats.length,
    pagina: page + 1,
    paginas: pages,
    temporada: season.name,
    ordem: SORTS[sortKey].label,
  });
  const nav = navRow(page, pages, sortKey, season);

  if (r.style === 'v3') {
    const c = new ContainerBuilder();
    if (r.accentBar) c.setAccentColor(parseColor(r.color)); // por padrão sem barra lateral colorida
    if (r.banner) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(r.banner)));
    c.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${E('rankTitle')} ${r.title}\n-# ${SORTS[sortKey].label} • ${season.name}`),
    );
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(body.slice(0, 3000)));
    if (r.legend !== false && stats.length) {
      c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(legendText()));
    }
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${footer}${r.showTimestamp ? ` • atualizado ${ts(new Date(), 'R')}` : ''}`),
    );
    if (nav) c.addActionRowComponents(nav);
    return { kind: 'v3', payload: { components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } } };
  }
  const embed = new EmbedBuilder()
    .setColor(parseColor(r.color))
    .setTitle(`${E('rankTitle')} ${r.title}`)
    .setDescription((r.legend !== false && stats.length ? `${body}\n\n${legendText()}` : body).slice(0, 4000))
    .setFooter({ text: footer.slice(0, 2000) });
  if (r.banner) embed.setImage(r.banner);
  if (r.thumbnail) embed.setThumbnail(r.thumbnail);
  if (r.showTimestamp) embed.setTimestamp();
  return { kind: 'embed', payload: { embeds: [embed], components: nav ? [nav] : [], allowedMentions: { parse: [] } } };
}

async function seasonsMenu(cfg, selected = null) {
  const all = await Season.find().sort({ number: -1 }).limit(25).lean();
  const cur = await getSeason();
  const sel = selected ? all.find((s) => s.number === selected) : null;
  const embed = new EmbedBuilder().setColor(COLORS.neutral).setTitle(`${E('season')} Temporadas`);
  if (!sel) {
    embed
      .setDescription(
        all
          .map((s) => {
            const lead = s.snapshot?.[0];
            const info = s._id.equals(cur._id)
              ? 'em andamento'
              : lead
                ? `líder <@${lead.userId}> (${fmt(lead.crystals)} ${cfg.points.unit})`
                : 'sem pontuações';
            return `**${s.name}** - ${info}`;
          })
          .join('\n') || 'Nenhuma temporada ainda.',
      )
      .setFooter({ text: 'Escolha uma temporada abaixo para ver a classificação.' });
  } else if (sel._id.equals(cur._id)) {
    const top = await topStats('crystals', sel._id, 15);
    embed
      .setTitle(`${E('season')} ${sel.name} (em andamento)`)
      .setDescription(
        top.map((s, i) => `${rankEmoji(i + 1)} <@${s.userId}> - **${fmt(s.crystals)}** ${cfg.points.unit}`).join('\n') ||
          cfg.ranking.emptyText,
      );
  } else {
    const snap = (sel.snapshot || []).slice(0, 15);
    embed
      .setTitle(`${E('season')} ${sel.name} - final`)
      .setDescription(
        snap.map((s, i) => `${rankEmoji(i + 1)} <@${s.userId}> - **${fmt(s.crystals)}** ${cfg.points.unit}`).join('\n') ||
          'Sem pontuações.',
      )
      .setFooter({
        text: `Encerrada em ${sel.endedAt ? new Date(sel.endedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-'}`,
      });
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId('rk:sv')
    .setPlaceholder('Ver outra temporada')
    .addOptions(
      all.slice(0, 25).map((s) => ({ label: s.name.slice(0, 100), value: String(s.number), default: sel?.number === s.number })),
    );
  return { embeds: [embed], components: [row(menu)], allowedMentions: { parse: [] } };
}

async function handleRankingNav(i) {
  const [, act, pageStr, sortKey, seasonNum] = i.customId.split(':');
  if (act === 'seasons') return i.reply({ ...(await seasonsMenu(getCfg())), flags: MessageFlags.Ephemeral });
  if (act === 'sv') return i.update(await seasonsMenu(getCfg(), parseInt(i.values[0], 10)));
  if (act !== 'go') return i.deferUpdate();
  const cfg = getCfg();
  const num = parseInt(seasonNum, 10);
  const season = (num > 0 ? await Season.findOne({ number: num }) : null) || (await getSeason());
  const isV3 = i.message.flags.has(MessageFlags.IsComponentsV2);
  const { payload } = await buildRankingPayload(
    { ...cfg, ranking: { ...cfg.ranking, style: isV3 ? 'v3' : 'embed' } },
    { sortKey, season, page: parseInt(pageStr, 10) },
  );
  if (i.message.flags.has(MessageFlags.Ephemeral)) return i.update(payload);
  return i.reply({ ...payload, flags: (payload.flags || 0) | MessageFlags.Ephemeral });
}

let lastRefresh = 0;
const status = { okAt: null, errAt: null, err: '' };
const rankingStatus = () => ({ ...status });
async function refreshRanking(client) {
  try {
    const res = await doRefresh(client);
    if (res.ok) {
      status.okAt = new Date();
      status.err = '';
    } else {
      status.errAt = new Date();
      status.err = res.reason;
    }
    return res;
  } catch (e) {
    status.errAt = new Date();
    status.err = e.message;
    throw e;
  }
}
async function doRefresh(client) {
  const cfg = getCfg();
  const r = cfg.ranking;
  if (!r.channelId) return { ok: false, reason: 'Canal do ranking não configurado (/admin → Canais e servidores).' };
  const channel = await client.channels.fetch(r.channelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, reason: 'Não consegui acessar o canal do ranking.' };
  const { kind, payload } = await buildRankingPayload(cfg);
  let msg = r.messageId ? await channel.messages.fetch(r.messageId).catch(() => null) : null;
  if (msg && r.messageKind !== kind) {
    await msg.delete().catch(() => {});
    msg = null;
  } // embed <-> V3 exige mensagem nova
  if (msg) await msg.edit(payload);
  else {
    const sent = await channel.send(payload);
    await setCfg('ranking.messageId', sent.id);
    await setCfg('ranking.messageKind', kind);
  }
  lastRefresh = Date.now();
  return { ok: true };
}

let refreshTimer = null;
function scheduleRankingRefresh(client, delayMs = 4000) {
  if (refreshTimer) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    const r = getCfg().ranking;
    if (!r.enabled || !r.channelId) return;
    const res = await refreshRanking(client).catch((e) => ({ ok: false, reason: e.message }));
    if (!res.ok) console.warn('[ranking]', res.reason);
  }, delayMs);
}

async function rankingTick(client) {
  const r = getCfg().ranking;
  if (!r.enabled || !r.auto || !r.channelId) return;
  if (Date.now() - lastRefresh < r.intervalMin * 60_000 - 5_000) return; // folga de 5s por causa do intervalo do tick
  lastRefresh = Date.now();
  const res = await refreshRanking(client);
  if (!res.ok) console.warn('[ranking]', res.reason);
}

async function userEmbed(cfg, user, season) {
  const st = (await MemberStat.findOne({ userId: user.id, seasonId: season._id }).lean()) || {};
  const pos =
    st.crystals !== undefined
      ? (await MemberStat.countDocuments({ seasonId: season._id, crystals: { $gt: st.crystals } })) + 1
      : null;
  const life = await lifetimeStats(user.id);
  const g = (k) => st[k] || 0;
  return new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setTitle(`${E('rankTitle')} Estatísticas - ${season.name}`)
    .addFields(
      {
        name: `${E('crystal')} ${cfg.points.unit}`,
        value: `**${fmt(g('crystals'))}**${pos ? ` • ${pos}º lugar` : ''}`,
        inline: true,
      },
      { name: `${E('time')} Tempo em call`, value: fmtDuration(g('voiceSec')), inline: true },
      { name: `${E('mov')} MOVs`, value: String(g('movs')), inline: true },
      {
        name: 'Por categoria',
        value: `Tempo: ${fmt(g('timePoints'))} • MOVs: ${fmt(g('movPoints'))} • Monitoria: ${fmt(g('monitorPoints'))} • Metas: ${fmt(g('goalPoints'))} • Ajustes: ${fmt(g('manualPoints'))}`,
      },
      {
        name: `${E('goal')} Metas / ${E('monitor')} Monitorias`,
        value: `${g('goalsDone')} / ${g('monitorsDone')}`,
        inline: true,
      },
      {
        name: `${E('movcall')} MOV Call`,
        value: `Realizadas: **${g('mcDone')}** • ${E('mcOk')} ${g('mcApproved')} • ${E('mcBad')} ${g('mcRejected')}\nTempo de MOV: ${fmtDuration(g('mcSec'))} • Monitorias realizadas: ${g('monitoredCount')}`,
        inline: false,
      },
      {
        name: `${E('star')} Histórico total`,
        value: `${fmt(life.crystals)} ${cfg.points.unit} • ${fmtDuration(life.voiceSec)} • ${life.movs} MOVs`,
        inline: false,
      },
    )
    .setTimestamp();
}

async function rankingCommand(i) {
  const cfg = getCfg();
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const num = i.options.getInteger('temporada');
  let season = await getSeason();
  if (num) {
    season = await Season.findOne({ number: num });
    if (!season) return i.editReply({ content: `${E('bad')} Temporada ${num} não encontrada.` });
  }
  const user = i.options.getUser('usuario');
  if (user) {
    if (user.id !== i.user.id && !perms(i.member, cfg).isLeader) {
      return i.editReply({ content: `${E('bad')} Só a liderança pode consultar as estatísticas de outro membro.` });
    }
    return i.editReply({ embeds: [await userEmbed(cfg, user, season)] });
  }
  const { payload } = await buildRankingPayload(
    { ...cfg, ranking: { ...cfg.ranking, style: 'embed' } },
    { sortKey: i.options.getString('ordem'), season },
  );
  return i.editReply({ embeds: payload.embeds, components: payload.components });
}

module.exports = {
  rankingStatus,
  SORTS,
  buildRankingPayload,
  handleRankingNav,
  refreshRanking,
  scheduleRankingRefresh,
  rankingTick,
  rankingCommand,
  userEmbed,
};
