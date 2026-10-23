const {
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const { getCfg, setCfg, UserStat } = require('./db');
const { COLORS, guildKey, guildIdOf, perms, fmtDuration, render, parseColor } = require('./core');
const { E, lbl, rankEmoji } = require('./emojis');

// ---------- critérios de ordenação ----------
const SORTS = {
  points: { label: 'Pontos', sort: { points: -1, recruitments: -1, shiftSeconds: -1 } },
  recruitments: { label: 'Recrutamentos', sort: { recruitments: -1, points: -1, shiftSeconds: -1 } },
  migrations: { label: 'Migrações', sort: { migrations: -1, points: -1, shiftSeconds: -1 } },
  shifts: { label: 'Plantões', sort: { shifts: -1, points: -1, shiftSeconds: -1 } },
  time: { label: 'Tempo de plantão', sort: { shiftSeconds: -1, points: -1, recruitments: -1 } },
};

// ---------- modelos de linha prontos (usados pelo /admin) ----------
// {staff} = recrutamentos de staff • {migracoes} = migrações • {atendidos} = staff + migrações
// ({recrutamentos} continua valendo como o total, por compatibilidade)
const LINE_PRESETS = {
  simple: '{emoji} {usuario} — **{pontos}** {unidade}',
  compact: '{emoji} {usuario} — **{pontos}** • {iconeRec} {staff} • {iconeMig} {migracoes} • {iconePlantoes} {plantoes}',
  detail:
    '{emoji} {usuario}\n' +
    '└ {iconePontos} **{pontos}** {unidade} • {iconeRec} {staff} recrutamentos • {iconeMig} {migracoes} migrações • {iconePlantoes} {plantoes} plantões • {iconeTempo} {tempo}',
  elegant:
    '{emoji} {usuario} **{pontos}** {unidade}\n' +
    '-# {iconeRec} {staff} recrutamentos  ·  {iconeMig} {migracoes} migrações  ·  {iconePlantoes} {plantoes} plantões',
};

// Temas prontos: aplicam vários ajustes de uma vez (todos continuam editáveis depois)
const THEMES = {
  elegant: {
    style: 'v3',
    v3Accent: true,
    showTimestamp: true,
    spacing: 'airy',
    lineTemplate: LINE_PRESETS.elegant,
    podiumCount: 3,
    podiumTemplate:
      '{emoji} **{usuario}** — **{pontos}** {unidade}\n' +
      '-# {iconeRec} {staff} recrutamentos  ·  {iconeMig} {migracoes} migrações  ·  {iconePlantoes} {plantoes} plantões  ·  {iconeTempo} {tempo}',
    totalsTemplate: '-# {membros} recrutadores  ·  {totalPontos} {unidade}  ·  {totalStaff} recrutamentos  ·  {totalMigracoes} migrações  ·  {totalPlantoes} plantões',
  },
};

const SPACINGS = ['auto', 'compact', 'airy'];
const SPACING_LABEL = { auto: 'Automático', compact: 'Compacto', airy: 'Arejado' };

// Quebra os números de uma pessoa (ou do total) nas variáveis usadas pelos modelos
const split = (s) => {
  const rec = s.recruitments || 0;
  const mig = s.migrations || 0;
  return { total: rec, mig, staff: Math.max(0, rec - mig) };
};

function entryLine(view, s, pos) {
  const n = split(s);
  const podium = view.podiumCount > 0 && pos <= view.podiumCount && view.podiumTemplate;
  return render(podium ? view.podiumTemplate : view.lineTemplate, {
    pos,
    emoji: rankEmoji(pos),
    usuario: `<@${s.userId}>`,
    nome: s.name || s.userId,
    id: s.userId,
    pontos: s.points,
    unidade: view.unit,
    staff: n.staff,
    migracoes: n.mig,
    atendidos: n.total,
    recrutamentos: n.total,
    plantoes: s.shifts,
    tempo: fmtDuration(s.shiftSeconds),
    iconePontos: E('rankPoints'),
    iconeRec: E('rankRecruits'),
    iconeMig: E('rankMig'),
    iconePlantoes: E('rankShifts'),
    iconeTempo: E('rankTime'),
  });
}

const ACTIVE = { $or: [{ points: { $gt: 0 } }, { recruitments: { $gt: 0 } }, { shifts: { $gt: 0 } }] };

async function topStats(cfg) {
  const sortKey = SORTS[cfg.ranking.view.sortBy] ? cfg.ranking.view.sortBy : 'points';
  return UserStat.find(ACTIVE)
    .sort(SORTS[sortKey].sort)
    .limit(cfg.ranking.topSize)
    .lean();
}

function buildLines(cfg, stats) {
  const v = cfg.ranking.view;
  if (!stats.length) return `*${v.emptyText}*`;
  const lines = stats.map((s, idx) => entryLine(v, s, idx + 1));
  // espaço entre as posições: compacto = nenhuma linha em branco • arejado = sempre • automático = só se houver modelo de várias linhas
  const multi = lines.some((l) => l.includes('\n'));
  const airy = v.spacing === 'airy' || (v.spacing !== 'compact' && multi);
  return lines.join(airy ? '\n\n' : '\n');
}

// Totais gerais (somando todos os recrutadores, não só o top)
async function buildTotals(cfg) {
  const v = cfg.ranking.view;
  if (!v.totalsTemplate) return '';
  const [t] = await UserStat.aggregate([
    { $match: ACTIVE },
    { $group: { _id: null, membros: { $sum: 1 }, pontos: { $sum: '$points' }, rec: { $sum: '$recruitments' }, mig: { $sum: '$migrations' }, plantoes: { $sum: '$shifts' }, segundos: { $sum: '$shiftSeconds' } } },
  ]);
  const x = t || { membros: 0, pontos: 0, rec: 0, mig: 0, plantoes: 0, segundos: 0 };
  const n = split({ recruitments: x.rec, migrations: x.mig });
  return render(v.totalsTemplate, {
    membros: x.membros,
    totalPontos: x.pontos,
    totalStaff: n.staff,
    totalMigracoes: n.mig,
    totalAtendidos: n.total,
    totalPlantoes: x.plantoes,
    totalTempo: fmtDuration(x.segundos),
    unidade: v.unit,
  });
}

const footerText = (cfg) => render(cfg.ranking.view.footer, { top: cfg.ranking.topSize });

// ---------- visual clássico (embed) ----------
function embedPayload(cfg, parts) {
  const v = cfg.ranking.view;
  const embed = new EmbedBuilder()
    .setColor(parseColor(v.color || '#2B2D31'))
    .setTitle(lbl('rankTitle', v.title).slice(0, 256))
    .setDescription([v.description, parts.lines.slice(0, 3400), parts.totals].filter(Boolean).join('\n\n').slice(0, 4000));
  if (v.banner) embed.setImage(v.banner);
  if (v.thumbnail) embed.setThumbnail(v.thumbnail);
  const f = footerText(cfg);
  if (f) embed.setFooter({ text: f.slice(0, 2048) });
  if (v.showTimestamp) embed.setTimestamp();
  return { embeds: [embed] };
}

// ---------- visual V3 (container de bordas finas) ----------
function v3Payload(cfg, parts) {
  const v = cfg.ranking.view;
  const c = new ContainerBuilder();
  if (v.v3Accent) c.setAccentColor(parseColor(v.color || '#2B2D31'));
  if (v.banner) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(v.banner)));

  const head = new TextDisplayBuilder().setContent(`## ${lbl('rankTitle', v.title)}`);
  if (v.thumbnail) {
    c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(head).setThumbnailAccessory(new ThumbnailBuilder().setURL(v.thumbnail)));
  } else {
    c.addTextDisplayComponents(head);
  }
  c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  if (v.description) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(v.description).slice(0, 400)));
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.lines.slice(0, 3000)));
  if (parts.totals) {
    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.totals.slice(0, 400)));
  }

  const bits = [footerText(cfg)];
  if (v.showTimestamp) bits.push(`<t:${Math.floor(Date.now() / 1000)}:R>`);
  const foot = bits.filter(Boolean).join(' • ');
  if (foot) {
    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${foot}`.slice(0, 400)));
  }
  return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

const kindOf = (cfg) => (cfg.ranking.view.style === 'v3' ? 'v3' : 'embed');

// Monta a mensagem do ranking conforme o estilo escolhido em /admin → Ranking → Personalizar
async function buildRankingPayload(cfg) {
  const parts = { lines: buildLines(cfg, await topStats(cfg)), totals: await buildTotals(cfg) };
  return kindOf(cfg) === 'v3' ? v3Payload(cfg, parts) : embedPayload(cfg, parts);
}

let timer = null;
let lastRun = 0;

// manual=true ignora a opção "atualização automática"
async function refreshRankingNow(client, { manual = false } = {}) {
  const cfg = await getCfg();
  if (!cfg.ranking.enabled) return { ok: false, reason: 'O ranking está desativado.' };
  if (!cfg.ranking.channelId) return { ok: false, reason: 'Nenhum canal de ranking configurado.' };
  if (!manual && !cfg.ranking.auto) return { ok: false, reason: 'Atualização automática desativada.' };

  const ch = await client.channels.fetch(cfg.ranking.channelId).catch(() => null);
  if (!ch || ch.guildId !== guildIdOf('internal') || !ch.isTextBased()) {
    return { ok: false, reason: 'O canal do ranking precisa ser um canal de texto do servidor interno.' };
  }

  const payload = await buildRankingPayload(cfg);
  const kind = kindOf(cfg);
  lastRun = Date.now();

  if (cfg.ranking.messageId) {
    const msg = await ch.messages.fetch(cfg.ranking.messageId).catch(() => null);
    if (msg) {
      // Mensagem V3 não vira embed (e vice-versa): ao trocar o estilo, apaga e reenvia
      if ((cfg.ranking.messageKind ?? 'embed') === kind) {
        await msg.edit(kind === 'embed' ? { content: '', components: [], ...payload } : payload);
        return { ok: true };
      }
      await msg.delete().catch(() => {});
    }
  }
  const sent = await ch.send(payload);
  await setCfg('ranking.messageId', sent.id);
  await setCfg('ranking.messageKind', kind);
  return { ok: true };
}

// Fila: nunca roda duas atualizações ao mesmo tempo (evita mensagem duplicada e rate limit)
let refreshChain = Promise.resolve();
function refreshRanking(client, opts) {
  const run = refreshChain.then(() => refreshRankingNow(client, opts));
  refreshChain = run.catch(() => {});
  return run;
}

// Atualiza o ranking logo após um recrutamento/plantão (com pequeno atraso para não estourar rate limit)
function scheduleRankingRefresh(client) {
  clearTimeout(timer);
  timer = setTimeout(() => refreshRanking(client).catch((e) => console.error('[ranking]', e.message)), 3000);
}

async function rankingTick(client) {
  const cfg = await getCfg();
  if (!cfg.ranking.enabled || !cfg.ranking.auto) return;
  if (Date.now() - lastRun < cfg.ranking.intervalMin * 60000) return;
  await refreshRanking(client);
}

// /ranking [usuario]
async function rankingCommand(i) {
  const cfg = await getCfg();
  if (guildKey(i.guildId) !== 'internal') {
    return i.reply({ content: `${E('bad')} O ranking é exclusivo do servidor interno de recrutamento.`, flags: MessageFlags.Ephemeral });
  }
  if (!perms(i.member, cfg).isRecruiter) {
    return i.reply({ content: `${E('bad')} Você não tem permissão para consultar o ranking.`, flags: MessageFlags.Ephemeral });
  }
  const user = i.options.getUser('usuario');
  if (!user) {
    const payload = await buildRankingPayload(cfg);
    return i.reply({ ...payload, flags: (payload.flags ?? 0) | MessageFlags.Ephemeral });
  }

  const s = await UserStat.findOne({ userId: user.id }).lean();
  if (!s) return i.reply({ content: `${E('info')} ${user} ainda não tem pontuação.`, flags: MessageFlags.Ephemeral });
  const pos = (await UserStat.countDocuments({ points: { $gt: s.points } })) + 1;
  const embed = new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle(lbl('rankStats', `Estatísticas — ${user.username}`))
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: 'Posição', value: `#${pos}`, inline: true },
      { name: 'Pontos', value: String(s.points), inline: true },
      { name: `${E('rankRecruits')} Recrutamentos`, value: String(split(s).staff), inline: true },
      { name: `${E('rankMig')} Migrações`, value: String(s.migrations || 0), inline: true },
      { name: `${E('rankShifts')} Plantões`, value: String(s.shifts), inline: true },
      { name: 'Tempo de plantão', value: fmtDuration(s.shiftSeconds), inline: true },
      { name: 'ID', value: `\`${user.id}\``, inline: true }
    );
  return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = {
  SORTS, LINE_PRESETS, THEMES, SPACINGS, SPACING_LABEL,
  buildRankingPayload, refreshRanking, scheduleRankingRefresh, rankingTick, rankingCommand,
};
