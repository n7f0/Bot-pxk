const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getCfg, setCfg, unsetCfg, getSeason, resetSeasonCache, MovEvent, Goal, Season, AuditLog, VoiceSession } = require('./db');
const { COLORS, row, fmt, ts, trunc, audit, OFFSET_MS, deny } = require('./core');
const { parseDays, formatDays } = require('./movs');
const { TYPE_LABEL, SCOPE_LABEL, PERIOD_LABEL } = require('./metas');
const { startNewSeason } = require('./seasons');
const { refreshRanking, rankingStatus } = require('./ranking');
const { publishMonitorPanel } = require('./monitoria');
const { rebuildStats } = require('./points');
const { DEFAULTS, LABELS, E } = require('./emojis');
const { adminListMovs, adminCancelMov, movStatusLine, STATUS_ICON, RESULT } = require('./iniciarmov');
const { fmtDuration } = require('./core');

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
const card = (title, desc) => new EmbedBuilder().setColor(COLORS.neutral).setTitle(title).setDescription(trunc(desc, 4000));
const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const back = (screen = 'home') => row(btn(screen === 'home' ? 'adm:home' : `adm:back:${screen}`, 'Voltar'));
const btnRows = (buttons) => {
  const rows = [];
  for (let k = 0; k < buttons.length; k += 5) rows.push(row(...buttons.slice(k, k + 5)));
  return rows;
};
const input = (id, label, value, o = {}) =>
  new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(o.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(o.required !== false)
    .setMaxLength(o.max || 100)
    .setValue(String(value ?? '').slice(0, o.max || 100))
    .setPlaceholder(o.ph || '');
const modal = (id, title, ...inputs) =>
  new ModalBuilder()
    .setCustomId(id)
    .setTitle(title)
    .addComponents(...inputs.map((x) => new ActionRowBuilder().addComponents(x)));
const num = (v, min, max, int = true) => {
  const n = parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return int ? Math.round(n) : n;
};

// MOVs
async function movsView(note = '') {
  const events = await MovEvent.find().sort({ time: 1 }).limit(20);
  const desc =
    events
      .map(
        (e) =>
          `${e.enabled ? '🟢' : '⚫'} **${e.name}** - ${e.time} • ${formatDays(e.days)} • ${e.durationMin} min • mín. ${e.minMinutes} min • ${fmt(e.points)} pts${e.channelIds.length || e.categoryIds.length ? '' : ' • calls autorizadas'}`,
      )
      .join('\n') || 'Nenhum MOV cadastrado ainda.';
  const buttons = events.map((e) => btn(`adm:mv:pick:${e._id}`, `${e.enabled ? '🟢' : '⚫'} ${e.name} ${e.time}`.slice(0, 80)));
  return {
    content: note,
    embeds: [
      card(
        '📣 MOVs oficiais',
        `MOVs com **horário fixo** (ex.: 12h, 15h, 18h, 22h). Quem estiver nas calls no horário e ficar o tempo mínimo recebe a recompensa.\n\n${desc}\n\n**Como usar:** clique no botão de um MOV para editar, ativar/desativar ou excluir, ou em **Novo MOV** para cadastrar. Horários no fuso de Brasília; sem calls definidas, vale o conjunto de calls autorizadas.`,
      ),
    ],
    components: [...btnRows(buttons), row(btn('adm:mv:new', '➕ Novo MOV', ButtonStyle.Success), btn('adm:home', 'Voltar'))],
  };
}
async function movDetail(id, note = '') {
  const e = await MovEvent.findById(id).catch(() => null);
  if (!e) return movsView(`${E('bad')} MOV não encontrado.`);
  const vc = new ChannelSelectMenuBuilder()
    .setCustomId(`adm:mv:vc:${id}`)
    .setPlaceholder('Calls do MOV (vazio = calls autorizadas)')
    .setChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
    .setMinValues(0)
    .setMaxValues(25);
  if (e.channelIds.length) vc.setDefaultChannels(e.channelIds.slice(0, 25));
  const cat = new ChannelSelectMenuBuilder()
    .setCustomId(`adm:mv:cat:${id}`)
    .setPlaceholder('Categorias do MOV (opcional)')
    .setChannelTypes(ChannelType.GuildCategory)
    .setMinValues(0)
    .setMaxValues(25);
  if (e.categoryIds.length) cat.setDefaultChannels(e.categoryIds.slice(0, 25));
  const embed = card(
    `📣 ${e.name}`,
    [
      `**Status:** ${e.enabled ? '🟢 Ativo' : '⚫ Desativado'}`,
      `**Horário:** ${e.time} (Brasília) • **Dias:** ${formatDays(e.days)}`,
      `**Duração:** ${e.durationMin} min • **Participação mínima:** ${e.minMinutes} min`,
      `**Recompensa:** ${fmt(e.points)} • **Limite de recompensados:** ${e.maxRewards || 'sem limite'}`,
      `**Calls:** ${e.channelIds.length ? e.channelIds.map((c) => `<#${c}>`).join(' ') : 'calls autorizadas'}`,
      `**Categorias:** ${e.categoryIds.length ? e.categoryIds.map((c) => `<#${c}>`).join(' ') : '-'}`,
      '',
      '-# **Editar** muda horário, dias, duração e pontos • **Ativar/Desativar** pausa o MOV sem apagar • **Excluir** remove (o histórico fica) • Os seletores abaixo escolhem em quais calls o MOV vale (vazio = calls autorizadas).',
    ].join('\n'),
  );
  return {
    content: note,
    embeds: [embed],
    components: [
      row(vc),
      row(cat),
      row(
        btn(`adm:mv:edit:${id}`, 'Editar'),
        btn(`adm:mv:tg:${id}`, e.enabled ? 'Desativar' : 'Ativar'),
        btn(`adm:mv:del:${id}`, 'Excluir', ButtonStyle.Danger),
        btn('adm:back:movs', 'Voltar'),
      ),
    ],
  };
}
function eventModal(e) {
  const cfg = getCfg();
  return modal(
    `adm:mvm:${e?._id || 'new'}`,
    e ? 'Editar MOV' : 'Novo MOV',
    input('n', 'Nome do MOV', e?.name || '', { ph: 'Ex: MOV das 12h' }),
    input('t', 'Horário (HH:MM, Brasília)', e?.time || '12:00', { max: 5 }),
    input('d', 'Dias da semana', e ? formatDays(e.days) : 'todos', { ph: 'todos  ou  seg,qua,sex', max: 60 }),
    input(
      'x',
      'Duração; mínimo; pontos; limite',
      e ? `${e.durationMin};${e.minMinutes};${e.points};${e.maxRewards}` : `60;${cfg.mov.minMinutes};${cfg.mov.points};0`,
      { ph: 'minutos; minutos; pontos; máx. recompensados (0=sem limite)', max: 40 },
    ),
  );
}
async function saveEvent(i, id) {
  const name = i.fields.getTextInputValue('n').trim();
  const time = i.fields.getTextInputValue('t').trim();
  const days = parseDays(i.fields.getTextInputValue('d'));
  const parts = i.fields
    .getTextInputValue('x')
    .split(/[;|]/)
    .map((s) => s.trim());
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
  const dur = num(parts[0], 5, 720),
    min = num(parts[1], 0, 720),
    pts = num(parts[2], 0, 100000, false),
    max = num(parts[3] ?? '0', 0, 1000);
  if (!name || !m || days === null || dur === null || min === null || pts === null || max === null || min > dur) {
    return i.reply(
      deny(
        `${E('bad')} Dados inválidos. Confira: horário \`HH:MM\`, dias (\`todos\` ou \`seg,qua\`), e \`duração; mínimo; pontos; limite\` (o mínimo não pode passar da duração).`,
      ),
    );
  }
  const data = {
    name,
    time: `${m[1].padStart(2, '0')}:${m[2]}`,
    days,
    durationMin: dur,
    minMinutes: min,
    points: pts,
    maxRewards: max,
  };
  const ev = id === 'new' ? await MovEvent.create(data) : await MovEvent.findByIdAndUpdate(id, { $set: data }, { new: true });
  await audit(
    i.client,
    i.user,
    id === 'new' ? 'MOV criado' : 'MOV editado',
    name,
    `${data.time} • ${formatDays(days)} • ${dur}min • mín ${min} • ${pts} pts`,
  );
  return i.update(await movDetail(String(ev._id), `${E('ok')} Salvo.`));
}

// metas
async function metasView(note = '') {
  const goals = await Goal.find().sort({ period: 1, name: 1 }).limit(20);
  const desc =
    goals
      .map(
        (g) =>
          `${g.enabled ? '🟢' : '⚫'} **${g.name}** - ${fmt(g.target)} ${TYPE_LABEL[g.type].toLowerCase()} • ${SCOPE_LABEL[g.scope]} • ${PERIOD_LABEL[g.period]} • recompensa ${fmt(g.reward)}`,
      )
      .join('\n') || 'Nenhuma meta cadastrada ainda.';
  const buttons = goals.map((g) => btn(`adm:mt:pick:${g._id}`, `${g.enabled ? '🟢' : '⚫'} ${g.name}`.slice(0, 80)));
  return {
    content: note,
    embeds: [
      card(
        '🎯 Metas e bônus',
        `Metas dão uma **recompensa em cristais** a quem atinge um objetivo no período (dia, semana, mês ou temporada). Metas coletivas premiam todos os que contribuíram quando o grupo atinge o total.\n\n${desc}\n\n**Como usar:** clique no botão de uma meta para editar, ativar/desativar ou excluir, ou em **Nova meta** para criar.`,
      ),
    ],
    components: [...btnRows(buttons), row(btn('adm:mt:new', '➕ Nova meta', ButtonStyle.Success), btn('adm:home', 'Voltar'))],
  };
}
async function metaDetail(id, note = '') {
  const g = await Goal.findById(id).catch(() => null);
  if (!g) return metasView(`${E('bad')} Meta não encontrada.`);
  const embed = card(
    `🎯 ${g.name}`,
    [
      `**Status:** ${g.enabled ? '🟢 Ativa' : '⚫ Desativada'}`,
      `**Tipo:** ${TYPE_LABEL[g.type]} • **Escopo:** ${SCOPE_LABEL[g.scope]} • **Período:** ${PERIOD_LABEL[g.period]}`,
      `**Meta:** ${fmt(g.target)}${g.type === 'hours' ? ' h' : ''} • **Recompensa:** ${fmt(g.reward)} • **Limite de conclusões por membro:** ${g.maxCompletions || 'sem limite'}`,
      g.description ? `*${g.description}*` : '',
      '-# **Editar** muda nome, tipo, valor e recompensa • **Ativar/Desativar** pausa a meta sem apagar • **Excluir** remove (as recompensas já dadas ficam no histórico).',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return {
    content: note,
    embeds: [embed],
    components: [
      row(
        btn(`adm:mt:edit:${id}`, 'Editar'),
        btn(`adm:mt:tg:${id}`, g.enabled ? 'Desativar' : 'Ativar'),
        btn(`adm:mt:del:${id}`, 'Excluir', ButtonStyle.Danger),
        btn('adm:back:metas', 'Voltar'),
      ),
    ],
  };
}
const WORDS = {
  type: {
    horas: 'hours',
    hora: 'hours',
    movs: 'movs',
    mov: 'movs',
    monitorias: 'monitors',
    monitoria: 'monitors',
    pontos: 'points',
    cristais: 'points',
  },
  scope: { individual: 'individual', coletiva: 'collective', coletivo: 'collective' },
  period: { diaria: 'daily', diario: 'daily', semanal: 'weekly', mensal: 'monthly', temporada: 'season' },
};
const wordOf = (map, val) => Object.keys(map).find((k) => map[k] === val);
function goalModal(g) {
  return modal(
    `adm:mtm:${g?._id || 'new'}`,
    g ? 'Editar meta' : 'Nova meta',
    input('n', 'Nome da meta', g?.name || '', { ph: 'Ex: 10 horas na semana' }),
    input(
      'a',
      'Tipo; escopo; período',
      g
        ? `${wordOf(WORDS.type, g.type)};${wordOf(WORDS.scope, g.scope)};${wordOf(WORDS.period, g.period)}`
        : 'horas;individual;semanal',
      { ph: 'horas|movs|monitorias|pontos ; individual|coletiva ; diaria|semanal|mensal|temporada', max: 60 },
    ),
    input('b', 'Meta; recompensa; limite por membro', g ? `${g.target};${g.reward};${g.maxCompletions}` : '10;50;0', {
      ph: 'valor da meta; recompensa; conclusões por membro (0 = sem limite)',
      max: 40,
    }),
    input('d', 'Descrição (opcional)', g?.description || '', { required: false, max: 150 }),
  );
}
async function saveGoal(i, id) {
  const name = i.fields.getTextInputValue('n').trim();
  const [t, s, p] = i.fields.getTextInputValue('a').split(/[;|]/).map(norm);
  const [tg, rw, mx] = i.fields
    .getTextInputValue('b')
    .split(/[;|]/)
    .map((x) => x.trim());
  const type = WORDS.type[t],
    scope = WORDS.scope[s],
    period = WORDS.period[p];
  const target = num(tg, 0.01, 1e7, false),
    reward = num(rw, 0, 1e6, false),
    max = num(mx ?? '0', 0, 1000);
  if (!name || !type || !scope || !period || target === null || reward === null || max === null) {
    return i.reply(
      deny(
        `${E('bad')} Dados inválidos. Tipo: horas, movs, monitorias ou pontos • Escopo: individual ou coletiva • Período: diaria, semanal, mensal ou temporada • Depois: \`meta; recompensa; limite\`.`,
      ),
    );
  }
  const data = {
    name,
    type,
    scope,
    period,
    target,
    reward,
    maxCompletions: max,
    description: i.fields.getTextInputValue('d').trim(),
  };
  const g = id === 'new' ? await Goal.create(data) : await Goal.findByIdAndUpdate(id, { $set: data }, { new: true });
  await audit(
    i.client,
    i.user,
    id === 'new' ? 'Meta criada' : 'Meta editada',
    name,
    `${TYPE_LABEL[type]} ≥ ${target} • ${PERIOD_LABEL[period]} • recompensa ${reward}`,
  );
  return i.update(await metaDetail(String(g._id), `${E('ok')} Salva.`));
}

// temporadas
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
async function seasonsView(note = '') {
  const wr = getCfg().seasons || {};
  const cur = await getSeason();
  const past = await Season.find({ status: 'ended' }).sort({ number: -1 }).limit(5);
  const desc = [
    `**Atual:** ${cur.name} (nº ${cur.number}) - iniciada ${ts(cur.startsAt, 'd')}${cur.endsAt ? ` • termina ${ts(cur.endsAt, 'f')}` : ' • sem data de término'}`,
    '',
    past.length
      ? '**Anteriores:**\n' +
        past
          .map(
            (s) =>
              `• ${s.name} - ${s.snapshot?.[0] ? `líder <@${s.snapshot[0].userId}> (${fmt(s.snapshot[0].crystals)})` : 'sem pontuações'}`,
          )
          .join('\n')
      : 'Nenhuma temporada anterior.',
    '',
    `**Reset semanal:** ${wr.weeklyReset ? `ligado - toda ${WEEKDAYS[wr.weekday] || 'segunda'} às ${String(wr.hour || 0).padStart(2, '0')}:00 (Brasília)` : 'desligado'}`,
    '',
    'Ao iniciar uma nova temporada a classificação zera, mas **todo o histórico permanece salvo** (banco de dados e logs).',
  ].join('\n');
  return {
    content: note,
    embeds: [card(`${E('season')} Temporadas`, desc)],
    components: [
      row(
        btn('adm:ss:new', 'Nova temporada', ButtonStyle.Danger),
        btn('adm:ss:end', 'Definir término da atual'),
        btn('adm:ss:wk', wr.weeklyReset ? 'Desligar reset semanal' : 'Ligar reset semanal'),
        btn('adm:ss:wd', 'Dia e hora do reset'),
      ),
      back(),
    ],
  };
}
const parseDate = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 23, 59) - OFFSET_MS);
  return Number.isNaN(d.getTime()) ? null : d;
};

// publicações
async function pubView(note = '') {
  const cfg = getCfg();
  const st = (ch, msg) =>
    ch ? `<#${ch}> ${msg ? '• mensagem publicada' : '• ainda não publicado'}` : `${E('bad')} canal não configurado`;
  const desc = `**Ranking:** ${st(cfg.ranking.channelId, cfg.ranking.messageId)}\n**Painel de monitoria:** ${st(cfg.panels.monitor.channelId, cfg.panels.monitor.messageId)}\n\n${(() => {
    const r = rankingStatus();
    return `**Última atualização do ranking:** ${r.okAt ? ts(r.okAt, 'R') : 'ainda não atualizou desde que o bot ligou'}${r.err ? `\n${E('bad')} **Último erro:** ${r.err}` : ''}`;
  })()}\n\nOs canais são definidos em **Canais e servidores**. Publicar de novo **atualiza** a mensagem existente, sem duplicar.`;
  return {
    content: note,
    embeds: [card('📢 Publicações', desc)],
    components: [
      row(btn('adm:pub:rank', 'Publicar / atualizar ranking'), btn('adm:pub:mon', 'Publicar / atualizar painel de monitoria')),
      back(),
    ],
  };
}

// emojis
function emojisView(note = '') {
  const cfg = getCfg();
  const desc = Object.keys(LABELS)
    .map((k) => `${E(k)} ${LABELS[k]}${cfg.emojis[k] ? ' *(personalizado)*' : ''}`)
    .join('\n');
  const keys = Object.keys(LABELS);
  const opt = (k) => ({ label: LABELS[k], value: k, description: `Padrão: ${DEFAULTS[k]}` });
  const menus = [
    row(
      new StringSelectMenuBuilder()
        .setCustomId('adm:em:k')
        .setPlaceholder('Escolha o emoji a trocar')
        .addOptions(keys.slice(0, 25).map(opt)),
    ),
  ];
  if (keys.length > 25)
    menus.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId('adm:em:k2')
          .setPlaceholder('Mais emojis…')
          .addOptions(keys.slice(25, 50).map(opt)),
      ),
    );
  return {
    content: note,
    embeds: [
      card(
        '😀 Emojis e ícones',
        `${desc}\n\nAceita emoji comum ou do servidor (\`<:nome:id>\`). Campo vazio volta ao padrão. Para pegar o código de um emoji do servidor, escreva \`\\:nome:\` no Discord.`,
      ),
    ],
    components: [...menus, back()],
  };
}

async function movCallView(note = '') {
  const { active, recent, mons } = await adminListMovs();
  const monOf = (id) => mons.filter((m) => String(m.movId) === String(id));
  const monTxt = (id) => {
    const l = monOf(id);
    if (!l.length) return 'sem monitor';
    return l.map((m) => `${m.status === 'active' ? '🔎' : m.status === 'awaiting' ? '⏳' : '🔍'} <@${m.byId}>`).join(' ');
  };
  const now = new Date();
  const act =
    active
      .map(
        (m) =>
          `🟢 <@${m.userId}> • #${String(m._id).slice(-6).toUpperCase()} • termina ${ts(m.endsAt, 'R')} • presença ${fmtDuration(m.presentSec)}${m.inCall ? '' : ' • ⚠️ fora da call'} • ${monTxt(m._id)}`,
      )
      .join('\n') || 'Nenhuma MOV em andamento.';
  const rec =
    recent
      .map(
        (m) =>
          `${STATUS_ICON[m.status] || '•'} <@${m.userId}> • ${ts(m.finishedAt || m.startedAt, 'd')} ${ts(m.finishedAt || m.startedAt, 't')} • ${fmtDuration(m.presentSec)} • ${RESULT[m.result] || '-'}${m.endReason ? ` • ${trunc(m.endReason, 40)}` : ''}`,
      )
      .join('\n') || 'Sem histórico ainda.';
  const components = [
    ...btnRows(
      active
        .slice(0, 15)
        .map((m) =>
          btn(
            `adm:mc:pick:${m._id}`,
            `❌ Cancelar ${m.tag || m.userId} #${String(m._id).slice(-6).toUpperCase()}`.slice(0, 80),
            ButtonStyle.Danger,
          ),
        ),
    ),
  ];
  components.push(row(btn('adm:mc:rf', '🔄 Atualizar'), btn('adm:home', 'Voltar')));
  return {
    content: note,
    embeds: [
      card(
        '🎙️ MOVs em andamento',
        `Aqui você acompanha as MOVs iniciadas pelos membros e pode **cancelar** uma que esteja errada (fica na auditoria).\n\n**Em andamento (${active.length})**\n${trunc(act, 1800)}\n\n**Últimas finalizadas**\n${trunc(rec, 1800)}\n\n-# Histórico completo de um membro: /movhistorico • ${ts(now, 't')}`,
      ),
    ],
    components,
  };
}

// manutenção
function maintView(note = '') {
  return {
    content: note,
    embeds: [
      card(
        '🧰 Manutenção',
        '**Reconciliar totais:** recalcula os totais da temporada a partir do histórico de transações.\n**Atualizar ranking:** força a atualização da mensagem do ranking.\n**Sessões ativas:** lista quem está sendo contabilizado agora.\n**Últimas ações:** auditoria das alterações administrativas.',
      ),
    ],
    components: [
      row(
        btn('adm:mn:rebuild', 'Reconciliar totais'),
        btn('adm:mn:rank', 'Atualizar ranking'),
        btn('adm:mn:sess', 'Sessões ativas'),
        btn('adm:mn:audit', 'Últimas ações'),
      ),
      back(),
    ],
  };
}

// roteador
async function render(screen) {
  switch (screen) {
    case 'movs':
      return movsView();
    case 'metas':
      return metasView();
    case 'temporadas':
      return seasonsView();
    case 'publicacoes':
      return pubView();
    case 'emojis':
      return emojisView();
    case 'manutencao':
      return maintView();
    case 'movativas':
      return movCallView();
    default:
      return null;
  }
}

async function handle(i, parts) {
  const [, act, a, b] = parts;
  const cfg = getCfg();
  switch (act) {
    // MOVs
    case 'mv':
      if (a === 'new') return i.showModal(eventModal(null));
      if (a === 'pick') return i.update(await movDetail(b));
      if (a === 'sel') return i.values[0] === 'new' ? i.showModal(eventModal(null)) : i.update(await movDetail(i.values[0]));
      if (a === 'edit') return i.showModal(eventModal(await MovEvent.findById(b)));
      if (a === 'tg') {
        const e = await MovEvent.findById(b);
        e.enabled = !e.enabled;
        await e.save();
        await audit(i.client, i.user, 'MOV alterado', e.name, e.enabled ? 'ativado' : 'desativado');
        return i.update(await movDetail(b));
      }
      if (a === 'del')
        return i.update({
          content: '',
          embeds: [card('Excluir MOV?', 'O histórico de MOVs já realizados é mantido.')],
          components: [
            row(btn(`adm:mv:delok:${b}`, 'Confirmar exclusão', ButtonStyle.Danger), btn(`adm:mv:sel2:${b}`, 'Cancelar')),
          ],
        });
      if (a === 'sel2') return i.update(await movDetail(b));
      if (a === 'delok') {
        const e = await MovEvent.findByIdAndDelete(b);
        await audit(i.client, i.user, 'MOV excluído', e?.name || b, '');
        return i.update(await movsView('🗑️ MOV excluído.'));
      }
      if (a === 'vc') {
        await MovEvent.updateOne({ _id: b }, { $set: { channelIds: i.values } });
        return i.update(await movDetail(b));
      }
      if (a === 'cat') {
        await MovEvent.updateOne({ _id: b }, { $set: { categoryIds: i.values } });
        return i.update(await movDetail(b));
      }
      return;
    case 'mvm':
      return saveEvent(i, a);
    // metas
    case 'mt':
      if (a === 'new') return i.showModal(goalModal(null));
      if (a === 'pick') return i.update(await metaDetail(b));
      if (a === 'sel') return i.values[0] === 'new' ? i.showModal(goalModal(null)) : i.update(await metaDetail(i.values[0]));
      if (a === 'edit') return i.showModal(goalModal(await Goal.findById(b)));
      if (a === 'tg') {
        const g = await Goal.findById(b);
        g.enabled = !g.enabled;
        await g.save();
        await audit(i.client, i.user, 'Meta alterada', g.name, g.enabled ? 'ativada' : 'desativada');
        return i.update(await metaDetail(b));
      }
      if (a === 'del')
        return i.update({
          content: '',
          embeds: [card('Excluir meta?', 'As recompensas já concedidas permanecem no histórico.')],
          components: [
            row(btn(`adm:mt:delok:${b}`, 'Confirmar exclusão', ButtonStyle.Danger), btn(`adm:mt:sel2:${b}`, 'Cancelar')),
          ],
        });
      if (a === 'sel2') return i.update(await metaDetail(b));
      if (a === 'delok') {
        const g = await Goal.findByIdAndDelete(b);
        await audit(i.client, i.user, 'Meta excluída', g?.name || b, '');
        return i.update(await metasView('🗑️ Meta excluída.'));
      }
      return;
    case 'mtm':
      return saveGoal(i, a);
    // temporadas
    case 'ss':
      if (a === 'new')
        return i.showModal(
          modal(
            'adm:ssm:new',
            'Nova temporada',
            input('n', 'Nome (opcional)', '', { required: false, ph: 'Ex: Temporada de Verão' }),
            input('e', 'Término (DD/MM/AAAA, opcional)', '', { required: false, max: 10 }),
          ),
        );
      if (a === 'end') {
        const cur = await getSeason();
        return i.showModal(
          modal(
            'adm:ssm:end',
            'Término da temporada atual',
            input(
              'e',
              'Data (DD/MM/AAAA) - vazio remove',
              cur.endsAt ? cur.endsAt.toISOString().slice(0, 10).split('-').reverse().join('/') : '',
              { required: false, max: 10 },
            ),
          ),
        );
      }
      if (a === 'wk') {
        const on = !getCfg().seasons?.weeklyReset;
        await setCfg('seasons.weeklyReset', on);
        await audit(i.client, i.user, 'Reset semanal', on ? 'ligado' : 'desligado', '');
        return i.update(await seasonsView(on ? `${E('ok')} Reset semanal ligado.` : `${E('ok')} Reset semanal desligado.`));
      }
      if (a === 'wd') {
        const w = getCfg().seasons || {};
        return i.showModal(
          modal(
            'adm:ssm:wd',
            'Dia e hora do reset semanal',
            input('d', 'Dia da semana (0=dom, 1=seg ... 6=sáb)', String(w.weekday ?? 1), { max: 1 }),
            input('h', 'Hora (0 a 23, Brasília)', String(w.hour ?? 0), { max: 2 }),
          ),
        );
      }
      return;
    case 'ssm': {
      if (a === 'wd') {
        const d = parseInt(i.fields.getTextInputValue('d'), 10);
        const h = parseInt(i.fields.getTextInputValue('h'), 10);
        if (!(d >= 0 && d <= 6) || !(h >= 0 && h <= 23)) return i.reply(deny(`${E('bad')} Dia de 0 a 6 e hora de 0 a 23.`));
        await setCfg('seasons.weekday', d);
        await setCfg('seasons.hour', h);
        await setCfg('seasons.lastKey', '');
        await audit(i.client, i.user, 'Reset semanal', `${WEEKDAYS[d]} ${h}:00`, '');
        return i.update(await seasonsView(`${E('ok')} Reset semanal: toda ${WEEKDAYS[d]} às ${String(h).padStart(2, '0')}:00.`));
      }
      const raw = i.fields.getTextInputValue('e').trim();
      const end = raw ? parseDate(raw) : null;
      if (raw && (!end || end <= new Date())) return i.reply(deny(`${E('bad')} Data inválida ou no passado. Use DD/MM/AAAA.`));
      if (a === 'new') {
        const s = await startNewSeason(i.client, {
          name: i.fields.getTextInputValue('n').trim() || null,
          endsAt: end,
          by: i.user.id,
        });
        await audit(i.client, i.user, 'Nova temporada', s.name, end ? `termina ${end.toISOString()}` : 'sem término');
        return i.update(await seasonsView(`${E('ok')} ${s.name} iniciada. O ranking zerou; o histórico foi preservado.`));
      }
      const cur = await getSeason();
      await Season.updateOne({ _id: cur._id }, { $set: { endsAt: end } });
      resetSeasonCache();
      await audit(i.client, i.user, 'Término da temporada', cur.name, end ? end.toISOString() : 'removido');
      return i.update(await seasonsView(`${E('ok')} Término atualizado.`));
    }
    // publicações
    case 'pub': {
      let r;
      try {
        r = a === 'rank' ? await refreshRanking(i.client) : await publishMonitorPanel(i.client);
      } catch (e) {
        console.error('[publicar]', e);
        const dica =
          e.code === 50013 || e.code === 50001
            ? ' O bot não tem permissão nesse canal (Ver canal, Enviar mensagens, Incorporar links).'
            : e.code === 10003 || e.code === 10008
              ? ' Canal ou mensagem não encontrados: confira o canal em Canais e servidores.'
              : '';
        r = { ok: false, reason: `${String(e.message).slice(0, 300)}${e.code ? ` (código ${e.code})` : ''}.${dica}` };
      }
      if (r.ok)
        await audit(i.client, i.user, 'Publicação', a === 'rank' ? 'Ranking' : 'Painel de monitoria', 'publicado/atualizado');
      return i.update(await pubView(r.ok ? `${E('ok')} Publicado/atualizado.` : `${E('bad')} ${r.reason}`));
    }
    // emojis
    case 'em':
      return i.showModal(
        modal(
          `adm:emm:${i.values[0]}`,
          `Emoji: ${LABELS[i.values[0]]}`.slice(0, 45),
          input('v', 'Emoji (vazio = padrão)', cfg.emojis[i.values[0]] || '', { required: false, max: 80 }),
        ),
      );
    case 'emm': {
      const v = i.fields.getTextInputValue('v').trim();
      if (!LABELS[a]) return;
      if (!v) await unsetCfg(`emojis.${a}`);
      else if (
        /^<a?:\w{2,32}:\d{17,20}>$/.test(v) ||
        /^\p{Extended_Pictographic}[\p{Extended_Pictographic}\u200d\ufe0f\u20e3]*$/u.test(v)
      )
        await setCfg(`emojis.${a}`, v);
      else return i.reply(deny(`${E('bad')} Emoji inválido. Use um emoji comum ou \`<:nome:id>\`.`));
      await audit(i.client, i.user, 'Emoji alterado', LABELS[a], v || 'padrão');
      return i.update(emojisView(`${E('ok')} Salvo.`));
    }
    // MOV Call
    case 'mc': {
      if (a === 'rf') return i.update(await movCallView());
      if (a === 'sel' || a === 'pick') {
        const movId = a === 'pick' ? b : i.values[0];
        return i.update({
          content: '',
          embeds: [
            card(
              'Cancelar MOV?',
              `A MOV #${movId.slice(-6).toUpperCase()} será encerrada sem contar como realizada e as monitorias abertas serão canceladas. Fica registrado na auditoria.`,
            ),
          ],
          components: [row(btn(`adm:mc:cx:${movId}`, 'Confirmar cancelamento', ButtonStyle.Danger), btn('adm:mc:rf', 'Voltar'))],
        });
      }
      if (a === 'cx') {
        const mov = await adminCancelMov(i.client, b, i.user.username);
        if (mov)
          await audit(i.client, i.user, 'MOV Call cancelada', `<@${mov.userId}>`, `#${String(mov._id).slice(-6).toUpperCase()}`);
        return i.update(await movCallView(mov ? `${E('ok')} MOV cancelada.` : `${E('warn')} Esta MOV já havia sido encerrada.`));
      }
      return;
    }
    // manutenção
    case 'mn': {
      if (a === 'rebuild') {
        const s = await getSeason();
        const n = await rebuildStats(s._id);
        await audit(i.client, i.user, 'Totais reconciliados', s.name, `${n} membro(s)`);
        return i.update(maintView(`${E('ok')} Totais de **${s.name}** reconstruídos a partir do histórico (${n} membro(s)).`));
      }
      if (a === 'rank') {
        const r = await refreshRanking(i.client);
        return i.update(maintView(r.ok ? `${E('ok')} Ranking atualizado.` : `${E('bad')} ${r.reason}`));
      }
      if (a === 'sess') {
        const list = await VoiceSession.find({ status: 'active' }).sort({ startedAt: 1 }).limit(25);
        const text =
          list
            .map(
              (s) =>
                `<@${s.userId}> em <#${s.channelId}> desde ${ts(s.startedAt, 'R')} • ${Math.floor(s.validSec / 60)} min válidos`,
            )
            .join('\n') || 'Nenhuma sessão ativa.';
        return i.update({ content: '', embeds: [card('🔊 Sessões ativas', text)], components: [back('manutencao')] });
      }
      if (a === 'audit') {
        const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(12);
        const text =
          logs
            .map(
              (l) =>
                `${ts(l.createdAt, 't')} <@${l.by}> - **${l.action}** ${l.target ? `• ${l.target}` : ''} ${l.detail ? `\n└ ${trunc(l.detail, 120)}` : ''}`,
            )
            .join('\n') || 'Nenhuma ação registrada.';
        return i.update({ content: '', embeds: [card('📜 Últimas ações', text)], components: [back('manutencao')] });
      }
      return;
    }
  }
}

const SPECIAL = [
  ['movativas', '🎙️ MOVs em andamento', 'MOVs ativas, histórico e cancelamento'],
  ['movs', '📣 MOVs oficiais', 'Horários, dias, canais e recompensas'],
  ['metas', '🎯 Metas e bônus', 'Metas individuais e coletivas'],
  ['temporadas', '🗓️ Temporadas', 'Nova temporada e data de término'],
  ['publicacoes', '📢 Publicações', 'Ranking e painel de monitoria'],
  ['emojis', '😀 Emojis e ícones', 'Trocar os emojis do bot'],
  ['manutencao', '🧰 Manutenção', 'Reconciliação, sessões e auditoria'],
];

module.exports = { render, handle, SPECIAL };
