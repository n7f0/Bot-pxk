const {
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  ActionRowBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const HELP = require('./adminHelp');
const { Panel, FLAGS, asV2 } = require('./adminUi');
const { getCfg, setCfg, getPath } = require('./db');
const { trunc, perms, deny, audit, guildKey, mainId, internalId, commandGuildIds } = require('./core');
const { registerCommands } = require('./register');
const extra = require('./adminExtra');
const { SORTS, rankingStatus } = require('./ranking');
const { E } = require('./emojis');

const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const VOICE = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];
const CAT = [ChannelType.GuildCategory];

// definição declarativa dos campos
let CLIENT = null;
const T = (path, label, o = {}) => ({ type: 'text', path, label, ...o });
const N = (path, label, min, max, o = {}) => ({ type: 'num', path, label, min, max, ...o });
const B = (path, label) => ({ type: 'bool', path, label });
const EN = (path, label, options) => ({ type: 'enum', path, label, options });
const CH = (path, label, types) => ({ type: 'chan', path, label, types });
const CHS = (path, label, types) => ({ type: 'chans', path, label, types });
const RL = (path, label) => ({ type: 'roles', path, label });
const L = (path, label, toStr, fromStr, o = {}) => ({ type: 'lines', path, label, toStr, fromStr, ...o });

const slug = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
const typesToStr = (arr) => (arr || []).map((t) => `${t.key}|${t.label}|${t.bonus}`).join('\n');
function typesFromStr(str) {
  const out = [];
  for (const line of String(str)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const [k, label, bonus] = line.split('|').map((x) => x.trim());
    const key = slug(k);
    const b = parseFloat(String(bonus ?? '0').replace(',', '.'));
    if (!key || !label || !Number.isFinite(b) || b < 0) throw new Error(`Linha inválida: "${line}". Use: chave|Nome|bônus`);
    if (out.some((o) => o.key === key)) throw new Error(`Chave repetida: ${key}`);
    out.push({ key, label: label.slice(0, 100), bonus: b });
  }
  if (!out.length) throw new Error('Cadastre pelo menos um tipo de monitoria.');
  return out.slice(0, 25);
}
const SNOW = /^\d{17,20}$/;
const idsToStr = (arr) => (arr || []).join('\n');
function idsFromStr(str) {
  const out = [];
  for (const t of String(str)
    .split(/[\s,;]+/)
    .filter(Boolean)) {
    if (!SNOW.test(t)) throw new Error(`"${t}" não é um ID válido (use o ID numérico do servidor).`);
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 25);
}
const reRegister = () =>
  registerCommands({ token: process.env.DISCORD_TOKEN, clientId: process.env.CLIENT_ID, guildIds: commandGuildIds() }).catch(
    (e) => console.error('[registro]', e.message),
  );
const linesFromStr = (str) =>
  String(str)
    .split('\n')
    .map((l) => l.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 25);

const SCREENS = {
  aparencia: {
    title: '🎨 Aparência',
    desc: 'Título, textos, cores e formato das mensagens fixas.',
    fields: [
      T('ranking.title', 'Título do ranking', { max: 100 }),
      EN('ranking.style', 'Formato do ranking', [
        { value: 'embed', label: 'Embed clássico' },
        { value: 'v3', label: 'Container V3' },
      ]),
      T('ranking.color', 'Cor do ranking (hex)', { color: true, max: 7 }),
      T('ranking.banner', 'Banner do ranking (URL)', { optional: true, max: 300 }),
      T('ranking.thumbnail', 'Miniatura do ranking (URL)', { optional: true, max: 300 }),
      T('ranking.footer', 'Rodapé do ranking', { max: 200, help: 'Variáveis: {top} {pagina} {paginas} {temporada} {ordem}' }),
      T('ranking.emptyText', 'Texto do ranking vazio', { max: 200 }),
      T('ranking.lineTemplate', 'Modelo da linha do ranking', {
        max: 300,
        long: true,
        help: 'Variáveis: {emoji} {posicao} {usuario} {tag} {valor} {unidade} {cristais} {horas} {horasmov} {movs} {metas} {mcfeitas} {mcaprov} {mcreprov} {monitorias} {pontosmon} {iconMov} {iconTempo} {iconMon} {iconOk} {iconBad} {iconCristal}',
      }),
      B('ranking.showTimestamp', 'Mostrar horário de atualização'),
      B('ranking.accentBar', 'Barra lateral colorida (formato V3)'),
      T('points.unit', 'Nome da moeda', { max: 30 }),
      T('appearance.monitorTitle', 'Título do painel de monitoria', { max: 100 }),
      T('appearance.monitorText', 'Texto do painel de monitoria', { max: 1000, long: true, help: 'Variável: {duracao}' }),
    ],
  },
  canais: {
    title: '📡 Canais e servidores',
    desc: () =>
      `**Servidor Principal:** \`${mainId()}\`\n**Servidor Interno:** \`${internalId()}\`\n*(IDs em branco usam o arquivo \`.env\`. Para usar calls de outro servidor: cadastre o ID dele em **Servidores extras de call** ANTES de convidar o bot, senão o bot sai sozinho.)*\n*(Canais de outros servidores: no seletor, escolha **Adicionar por ID**.)*`,
    fields: [
      T('servers.mainId', 'ID do Servidor Principal', {
        optional: true,
        max: 20,
        snowflake: true,
        after: reRegister,
        help: 'Vazio = usa o .env',
      }),
      T('servers.internalId', 'ID do Servidor Interno', {
        optional: true,
        max: 20,
        snowflake: true,
        after: reRegister,
        help: 'Vazio = usa o .env',
      }),
      L('servers.extraGuildIds', 'Servidores extras de call (IDs)', idsToStr, idsFromStr, {
        max: 500,
        optional: true,
        help: 'Um ID por linha. O bot precisa estar no servidor para enxergar as calls.',
      }),
      CHS('voice.channelIds', 'Calls autorizadas (horas gerais)', VOICE),
      CHS('voice.categoryIds', 'Categorias autorizadas (horas gerais)', CAT),
      CHS('voice.movChannelIds', 'Calls válidas para MOV Call', VOICE),
      CHS('voice.movCategoryIds', 'Categorias válidas para MOV Call', CAT),
      CH('ranking.channelId', 'Canal do ranking', TEXT),
      CH('movCall.panelChannelId', 'Canal dos painéis de MOV', TEXT),
      CH('panels.monitor.channelId', 'Canal do painel de monitoria', TEXT),
      CH('logs.geral', 'Log geral', TEXT),
      CH('logs.movcall', 'Log de MOV Call', TEXT),
      CH('logs.sessoes', 'Log de sessões (entradas/saídas)', TEXT),
      CH('logs.movs', 'Log de MOVs oficiais', TEXT),
      CH('logs.monitoria', 'Log de monitorias', TEXT),
      CH('logs.pontos', 'Log de pontos/ajustes', TEXT),
      CH('logs.admin', 'Log administrativo', TEXT),
    ],
  },
  movcall: {
    title: '🎙️ MOV Call',
    desc: 'Regras do `/iniciarmov`, do painel público e da monitoria de MOV. As categorias de voz válidas para MOV ficam em **Canais e servidores** (vazio = vale a lista de horas gerais).',
    fields: [
      CH('movCall.panelChannelId', 'Canal dos painéis de MOV', TEXT),
      CH('movCall.commandChannelId', 'Canal para usar o /iniciarmov (vazio = qualquer)', TEXT),
      RL('perms.starter', 'Cargos que podem iniciar MOV'),
      RL('perms.monitor', 'Cargos de monitor'),
      RL('perms.selfMonitor', 'Cargos que podem monitorar/aprovar a própria MOV'),
      N('movCall.durationMin', 'Duração padrão da MOV (min)', 1, 720),
      N('movCall.minPresencePct', 'Presença mínima para a MOV valer (%)', 0, 100),
      N('movCall.leaveGraceSec', 'Tolerância fora da call (s)', 0, 3600, {
        help: 'Padrão 300 (5 min). Passou disso fora da call, a MOV é cancelada. 0 = só avalia no fim',
      }),
      N('monitor.durationMin', 'Duração da monitoria (min)', 1, 60),
      N('movCall.pointsMin', 'Pontuação mínima por monitoria aprovada', 0, 100000, { int: false }),
      N('movCall.pointsMax', 'Pontuação máxima por monitoria aprovada', 0, 100000, { int: false }),
      N('movCall.pointsDefault', 'Pontuação sugerida ao aprovar', 0, 100000, { int: false }),
      B('movCall.allowDuplicateMonitoring', 'Permitir monitorias simultâneas na mesma MOV'),
      EN('movCall.onLeave', 'Membro saiu da call / presença baixa na monitoria', [
        { value: 'review', label: 'Marcar para análise da liderança' },
        { value: 'reject', label: 'Reprovar automaticamente' },
      ]),
      B('movCall.requireMonitorInCall', 'Exigir o monitor na mesma call'),
      B('movCall.allowEarlyApproval', 'Permitir aprovar/pontuar antes do fim da monitoria'),
      B('movCall.autoPointsEnabled', 'Pontuar automaticamente MOV sem monitor'),
      N('movCall.autoPoints', 'Pontuação automática (MOV sem monitor)', 0, 100000, { int: false }),
      B('movCall.autoMoveMonitor', 'Mover o monitor para a call (precisa de Mover Membros)'),
      N('movCall.restartToleranceSec', 'Tolerância após reinício do bot (s)', 0, 3600, {
        help: 'Tempo parado que ainda é creditado a quem continua na call',
      }),
      T('movCall.title', 'Título do painel da MOV', { max: 60 }),
    ],
  },
  lista: {
    title: '📋 Prefixos e Lista de MOV',
    desc: 'Prefixos de mensagem: o primeiro inicia a MOV (como o `/iniciarmov`), o segundo coleta a Lista de MOV e o terceiro cancela. Só cargos autorizados conseguem usar. Exige o intent **Message Content** ligado no Developer Portal.',
    fields: [
      T('prefixes.start', 'Prefixo para iniciar a MOV', {
        max: 20,
        prefix: true,
        help: 'Padrão: unionlista - sem espaços, de 2 a 20 caracteres. Escreva só o prefixo na mensagem.',
      }),
      T('prefixes.lista', 'Prefixo para coletar a Lista de MOV', {
        max: 20,
        prefix: true,
        help: 'Padrão: unionlista - use na call onde estão os membros da Mov Call.',
      }),
      T('prefixes.cancel', 'Prefixo para interromper/cancelar', {
        max: 20,
        prefix: true,
        help: 'Padrão: unionlistacancel - cancela a sua MOV em andamento e a sua lista em andamento.',
      }),
      RL('perms.starter', 'Cargos autorizados a usar os prefixos'),
      RL('listaMov.launchRoleIds', 'Cargos que lançam a lista e clicam em Iniciar MOV'),
      EN('listaMov.collectMode', 'Quem a lista coleta', [
        { value: 'all', label: 'Todos os IDs da call' },
        { value: 'roles', label: 'Só quem tem cargo de Mov Call' },
      ]),
      B('listaMov.requireStartButton', 'Só contar depois do botão Iniciar MOV'),
      RL('listaMov.roleIds', 'Cargos de Mov Call (usados no modo "só cargos")'),
      RL('listaMov.staffRoleIds', 'Cargos de staff (vazio = não exige staff)'),
      CH('listaMov.channelId', 'Canal chat-lista', TEXT),
      N('listaMov.durationMin', 'Tempo de cada pessoa em call pública (min)', 1, 720),
      N('listaMov.minPresencePct', 'Presença mínima para o botão Pontuar (%)', 0, 100),
      N('listaMov.waitMin', 'Prazo para descer para a call pública (min)', 1, 720),
      N('listaMov.pointsDefault', 'Pontuação sugerida', 0, 100000, { int: false }),
      N('listaMov.pointsMax', 'Pontuação máxima por pessoa', 0, 100000, { int: false }),
      B('listaMov.notify', 'Enviar DMs automáticas da lista'),
      T('listaMov.msgStart', 'DM: começou a participar', {
        max: 400,
        long: true,
        help: 'Variáveis: {emoji} {usuario} {duracao} {fim}',
      }),
      T('listaMov.msgEnd', 'DM: MOV enviada para análise', {
        max: 400,
        long: true,
        help: 'Variáveis: {emoji} {usuario} {duracao} {presenca}',
      }),
    ],
  },
  mensagens: {
    title: '📨 Mensagens da MOV',
    desc: 'Mensagens automáticas, enviadas na DM do membro (o membro precisa permitir DMs de membros do servidor), quando a MOV começa, quando o membro sai/volta da call, é cancelada ou termina.',
    fields: [
      B('movCall.notifyEnabled', 'Enviar mensagens automáticas da MOV'),
      B('movCall.notifyDm', 'Enviar na DM do membro'),
      B('movCall.notifyChannel', 'Também publicar no canal (menciona o membro)'),
      B('movCall.notifyFallback', 'Se a DM falhar, publicar no canal'),
      CH('movCall.notifyChannelId', 'Canal das mensagens (vazio = canal do painel)', TEXT),
      T('movCall.msgStart', 'Mensagem: MOV iniciada', {
        max: 400,
        long: true,
        help: 'Variáveis: {emoji} {usuario} {duracao} {fim} {tolerancia} {motivo} {presenca} {pontuacao} {pontos} {moeda} {call}',
      }),
      T('movCall.msgLeave', 'Mensagem: saiu da call (tolerância)', {
        max: 400,
        long: true,
        help: 'Use {tolerancia} para o tempo que ele tem para voltar',
      }),
      T('movCall.msgReturn', 'Mensagem: voltou para a call', { max: 400, long: true }),
      T('movCall.msgCancel', 'Mensagem: MOV cancelada', { max: 400, long: true, help: 'Use {motivo}' }),
      T('movCall.msgFinish', 'Mensagem: MOV finalizada', {
        max: 400,
        long: true,
        help: 'Use {presenca} e {pontuacao} (texto da pontuação automática, se houver)',
      }),
      T('movCall.msgFail', 'Mensagem: MOV não validada', { max: 400, long: true, help: 'Use {motivo}' }),
      T('movCall.msgAuto', 'Mensagem: pontuação automática tardia', { max: 400, long: true, help: 'Use {pontos} e {moeda}' }),
    ],
  },
  permissoes: {
    title: '🔐 Permissões',
    desc: 'Quem pode fazer o quê. Cargos dos dois servidores podem ser cadastrados (abra o painel em cada servidor ou use **Adicionar por ID**). Administradores do Discord têm acesso total, a menos que isso seja desligado aqui.',
    fields: [
      RL('perms.admin', 'Cargos de administrador'),
      RL('perms.leader', 'Cargos de responsável pela Mov Call'),
      RL('perms.monitor', 'Cargos autorizados a monitorar'),
      RL('perms.points', 'Cargos autorizados a ajustar pontos'),
      RL('perms.starter', 'Cargos autorizados a iniciar MOV (/iniciarmov)'),
      RL('perms.selfMonitor', 'Cargos que podem monitorar/aprovar a própria MOV'),
      B('perms.discordAdmin', 'Administrador do Discord conta como admin do bot'),
    ],
  },
  pontuacao: {
    title: '💎 Pontuação',
    desc: 'Regras de cristais por tempo e valores padrão para novos MOVs.',
    fields: [
      N('points.perHour', 'Cristais por hora válida', 0, 100000, { int: false }),
      EN('points.rounding', 'Arredondamento', [
        { value: 'floor', label: 'Para baixo (padrão)' },
        { value: 'round', label: 'Mais próximo' },
        { value: 'ceil', label: 'Para cima' },
        { value: 'exact', label: 'Exato (2 casas)' },
      ]),
      N('points.dailyCap', 'Limite diário por tempo (0 = sem limite)', 0, 1000000, { int: false }),
      N('mov.points', 'Pontos padrão de um novo MOV', 0, 100000, { int: false }),
      N('mov.minMinutes', 'Participação mínima padrão (min)', 0, 720),
    ],
  },
  contagem: {
    title: '🔊 Contagem automática',
    desc: 'Como o tempo em call é validado. Os canais válidos ficam em **Canais e servidores**.',
    fields: [
      B('voice.countMuted', 'Membro mutado continua contando'),
      B('voice.countDeafened', 'Membro ensurdecido continua contando'),
      N('voice.minSessionSec', 'Tempo mínimo para validar a sessão (s)', 0, 3600),
      N('voice.maxSessionHours', 'Duração máxima de uma sessão (h)', 1, 24),
    ],
  },
  monitoria: {
    title: '🛡️ Monitoria',
    desc: 'Regras do sistema de monitoria. O bot não grava áudio: a avaliação segue os critérios abaixo.',
    fields: [
      N('monitor.durationMin', 'Duração padrão (min)', 1, 60),
      N('monitor.minPresencePct', 'Presença mínima do monitorado (%)', 0, 100),
      B('monitor.requireAllCriteria', 'Exigir todos os critérios para aprovar'),
      B('monitor.allowSelf', 'Permitir monitorar a si mesmo'),
      N('monitor.maxPerTargetPerDay', 'Bônus por membro por dia (0 = sem limite)', 0, 50),
      N('monitor.maxPerMonitorPerDay', 'Aprovações por responsável por dia (0 = sem limite)', 0, 500),
      L('monitor.criteria', 'Critérios de validação (um por linha)', (v) => (v || []).join('\n'), linesFromStr, {
        max: 1500,
        help: 'Até 25 critérios, um por linha.',
      }),
      L('monitor.types', 'Tipos de monitoria e bônus', typesToStr, typesFromStr, {
        max: 2000,
        help: 'Uma linha por tipo: chave|Nome|bônus',
      }),
    ],
  },
  ranking: {
    title: '🏆 Ranking e temporadas',
    desc: () => {
      const cfg = getCfg();
      const st = rankingStatus();
      const lines = ['O ranking é calculado a partir do banco de dados. Temporadas ficam em **Temporadas**.'];
      if (cfg.ranking.sortBy !== 'crystals')
        lines.push(
          `${E('warn')} Ordenando por **${SORTS[cfg.ranking.sortBy]?.label || cfg.ranking.sortBy}**: o ranking só mostra e só muda para quem tem esse tipo de pontuação. Para o total de pontos, escolha **Cristais** em *Critério de ordenação*.`,
        );
      lines.push(
        st.okAt
          ? `Última atualização: <t:${Math.floor(st.okAt.getTime() / 1000)}:R>`
          : 'Ainda não atualizou desde que o bot ligou.',
      );
      if (st.err) lines.push(`${E('bad')} Último erro: ${st.err}`);
      return lines.join('\n');
    },
    fields: [
      B('ranking.enabled', 'Ranking ligado'),
      B('ranking.auto', 'Atualização automática'),
      N('ranking.intervalMin', 'Intervalo de atualização (min)', 1, 1440),
      N('ranking.topSize', 'Posições no ranking (até 100)', 1, 100),
      N('ranking.pageSize', 'Posições por página', 5, 15),
      EN(
        'ranking.sortBy',
        'Critério de ordenação',
        Object.entries(SORTS).map(([value, s]) => ({ value, label: s.label })),
      ),
    ],
  },
};

const descOf = (sc) => (typeof sc.desc === 'function' ? sc.desc() : sc.desc);
const PAGE = 6; // campos por página
const helpOf = (f) => HELP[f.path] || f.help || '';

// exibição
const chanLabel = (id) => {
  const ch = CLIENT?.channels.cache.get(id);
  return ch ? `**${trunc(ch.name, 28)}** · ${trunc(ch.guild?.name || 'servidor', 22)}` : `\`${id}\` *(bot não enxerga)*`;
};
const roleLabel = (id) => {
  const g = CLIENT?.guilds.cache.find((x) => x.roles.cache.has(id));
  return g ? `**@${trunc(g.roles.cache.get(id).name, 28)}** · ${trunc(g.name, 22)}` : `\`${id}\``;
};
const oneLine = (v) => String(v).replace(/\s*\n\s*/g, ' ⏐ ');
function show(f, cfg) {
  const v = getPath(cfg, f.path);
  switch (f.type) {
    case 'bool':
      return v ? `${E('ok')} Ligado` : `${E('bad')} Desligado`;
    case 'enum':
      return f.options.find((o) => o.value === v)?.label || String(v);
    case 'chan':
      return v ? chanLabel(v) : '- *(não definido)*';
    case 'chans':
      return (v || []).length ? trunc(v.map(chanLabel).join('\n'), 900) : '- *(nenhum)*';
    case 'roles':
      return (v || []).length ? trunc(v.map(roleLabel).join('\n'), 900) : '- *(nenhum)*';
    case 'lines':
      return trunc(oneLine(f.toStr(v) || '-'), 300);
    default:
      return v === '' || v == null ? '- *(vazio)*' : `\`${trunc(oneLine(v), 300)}\``;
  }
}
function showShort(f, cfg) {
  const v = getPath(cfg, f.path);
  if (f.type === 'chans' || f.type === 'roles') {
    const list = v || [];
    if (!list.length) return '- *(nenhum)*';
    const lab = f.type === 'chans' ? chanLabel : roleLabel;
    return `${list.length} selecionado(s): ${list.slice(0, 3).map(lab).join(', ')}${list.length > 3 ? ` e mais ${list.length - 3}` : ''}`;
  }
  if (f.type === 'lines') return trunc(oneLine(f.toStr(v) || '-'), 160);
  if (f.type === 'text' || f.type === 'num') return v === '' || v == null ? '- *(vazio)*' : `\`${trunc(oneLine(v), 160)}\``;
  return show(f, cfg);
}

const sbtn = (id, label, style = ButtonStyle.Secondary, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
};
const homeBtn = () => sbtn('adm:home', 'Início', ButtonStyle.Secondary, '🏠');

// tela inicial
const GROUPS = [
  {
    title: '🚀 Comece por aqui',
    items: [
      ['canais', '📡 Canais e servidores', 'escolha quais calls valem, onde ficam o ranking, os painéis e os logs'],
      ['permissoes', '🔐 Permissões', 'defina quem é administrador, líder, monitor e quem pode iniciar MOV'],
    ],
  },
  {
    title: '🎙️ MOV Call',
    items: [
      ['movcall', '🎙️ MOV Call', 'regras da MOV iniciada pelo membro (duração, presença, monitoria, pontos)'],
      ['lista', '📋 Prefixos e Lista', 'prefixos de mensagem e a Lista de MOV com o chat-lista'],
      ['mensagens', '📨 Mensagens', 'textos e DMs automáticos enviados durante a MOV'],
      ['movativas', '🔴 Em andamento', 'veja quem está em MOV agora e cancele se precisar'],
    ],
  },
  {
    title: '💎 Pontos e ranking',
    items: [
      ['pontuacao', '💎 Pontuação', 'quantos cristais cada hora em call rende'],
      ['contagem', '🔊 Contagem', 'regras para o tempo em call valer (mute, tempo mínimo)'],
      ['monitoria', '🛡️ Monitoria', 'critérios, tipos e limites da monitoria'],
      ['ranking', '🏆 Ranking', 'como o ranking é ordenado e atualizado'],
    ],
  },
  {
    title: '📅 Eventos e metas',
    items: [
      ['movs', '📣 MOVs oficiais', 'MOVs com horário fixo (12h, 15h, 18h…)'],
      ['metas', '🎯 Metas', 'metas individuais e coletivas com recompensa'],
      ['temporadas', '🗓️ Temporadas', 'zerar o ranking começando uma nova temporada'],
    ],
  },
  {
    title: '🎨 Visual e manutenção',
    items: [
      ['aparencia', '🎨 Aparência', 'títulos, cores e textos das mensagens fixas'],
      ['emojis', '😀 Emojis', 'trocar os emojis usados pelo bot'],
      ['publicacoes', '📢 Publicações', 'publicar ou atualizar o ranking e o painel de monitoria'],
      ['manutencao', '🧰 Manutenção', 'reconciliar totais, ver sessões e o histórico de ações'],
    ],
  },
];

function checklist(cfg) {
  const has = (a) => (a || []).length > 0;
  const items = [
    [has(cfg.voice.channelIds) || has(cfg.voice.categoryIds), 'Calls públicas autorizadas', 'Canais e servidores'],
    [has(cfg.perms.admin) || has(cfg.perms.leader), 'Cargo de administrador ou responsável', 'Permissões'],
    [has(cfg.perms.starter), 'Cargos que podem iniciar MOV', 'Permissões'],
    [!!cfg.movCall.panelChannelId, 'Canal dos painéis de MOV', 'Canais e servidores'],
    [has(cfg.listaMov.roleIds), 'Cargo de Mov Call (Lista de MOV)', 'Prefixos e Lista'],
    [!!cfg.ranking.channelId, 'Canal do ranking', 'Canais e servidores'],
  ];
  const done = items.filter((x) => x[0]).length;
  return `**Primeiros passos** - ${done}/${items.length} concluídos\n${items.map(([ok, label, where]) => `${ok ? `${E('ok')}` : '⬜'} ${label}${ok ? '' : ` → *${where}*`}`).join('\n')}`;
}

function homeV2(note = '') {
  const cfg = getCfg();
  const p = new Panel();
  p.text(
    '## ⚙️ Painel administrativo - Mov Call Union\nTudo é configurado por **botões**: clique numa categoria para ver o que ela faz. Só você vê esta mensagem. Ao entrar numa categoria, cada opção traz uma explicação e um botão ao lado para alterar.',
  );
  if (note) p.text(note);
  p.sep();
  p.text(checklist(cfg));
  for (const g of GROUPS) {
    p.sep();
    p.text(`**${g.title}**\n${g.items.map(([, label, d]) => `${label} - ${d}`).join('\n')}`);
    p.row(
      ...g.items.map(([key, label]) =>
        sbtn(`adm:s:${key}`, label.replace(/^\S+\s/, ''), ButtonStyle.Primary, label.split(' ')[0]),
      ),
    );
  }
  return p.done();
}

// telas de configuração
function fieldButton(key, idx, f, cfg) {
  if (f.type === 'bool') {
    const on = !!getPath(cfg, f.path);
    return sbtn(`adm:t:${key}:${idx}`, on ? 'Ligado' : 'Desligado', on ? ButtonStyle.Success : ButtonStyle.Secondary);
  }
  if (['text', 'num', 'lines'].includes(f.type)) return sbtn(`adm:e:${key}:${idx}`, 'Editar', ButtonStyle.Primary, '✏️');
  if (f.type === 'enum') return sbtn(`adm:e:${key}:${idx}`, 'Escolher', ButtonStyle.Primary, '🔘');
  return sbtn(`adm:e:${key}:${idx}`, 'Alterar', ButtonStyle.Primary, '📌');
}

function screenV2(key, page = 0, note = '') {
  const sc = SCREENS[key];
  const cfg = getCfg();
  const pages = Math.max(1, Math.ceil(sc.fields.length / PAGE));
  page = Math.min(Math.max(0, page), pages - 1);
  const p = new Panel();
  p.text(`## ${sc.title}${pages > 1 ? ` - página ${page + 1}/${pages}` : ''}\n${descOf(sc)}`);
  if (note) p.text(note);
  p.sep();
  sc.fields.slice(page * PAGE, page * PAGE + PAGE).forEach((f, k) => {
    const idx = page * PAGE + k;
    const help = helpOf(f);
    p.section(trunc(`**${f.label}**\n${showShort(f, cfg)}${help ? `\n-# ${help}` : ''}`, 620), fieldButton(key, idx, f, cfg));
  });
  p.sep();
  const nav = [];
  if (pages > 1) {
    nav.push(sbtn(`adm:pg:${key}:${page - 1}`, 'Anterior', ButtonStyle.Secondary, '◀️').setDisabled(page === 0));
    nav.push(sbtn(`adm:pg:${key}:${page + 1}`, 'Próxima', ButtonStyle.Secondary, '▶️').setDisabled(page >= pages - 1));
  }
  nav.push(homeBtn());
  p.row(...nav);
  return p.done();
}
const pageOf = (idx) => Math.floor(Number(idx) / PAGE);
const screenAt = (key, idx, note = '') => screenV2(key, pageOf(idx), note);

async function renderScreen(key) {
  if (SCREENS[key]) return screenV2(key, 0);
  return (await extra.render(key)) || homeV2();
}

// edição
async function save(i, f, value) {
  await setCfg(f.path, value);
  await audit(
    i.client,
    i.user,
    'Configuração alterada',
    f.label,
    trunc(Array.isArray(value) ? JSON.stringify(value) : String(value), 300),
  );
  if (f.after) f.after(i);
}
function pointsConflict(path, value, cfg) {
  const m = { ...cfg.movCall };
  const key = { 'movCall.pointsMin': 'pointsMin', 'movCall.pointsMax': 'pointsMax', 'movCall.pointsDefault': 'pointsDefault' }[
    path
  ];
  if (!key) return null;
  m[key] = value;
  if (m.pointsMin > m.pointsMax) return 'A pontuação mínima não pode ser maior que a máxima.';
  if (m.pointsDefault < m.pointsMin || m.pointsDefault > m.pointsMax)
    return 'A pontuação sugerida precisa ficar entre a mínima e a máxima.';
  return null;
}

function fieldModal(screen, idx, f, cfg) {
  const cur = f.type === 'lines' ? f.toStr(getPath(cfg, f.path)) : getPath(cfg, f.path);
  const max = f.type === 'num' ? 20 : Math.min(f.max || 100, 4000);
  const ti = new TextInputBuilder()
    .setCustomId('v')
    .setLabel(f.label.slice(0, 45))
    .setStyle(f.long || f.type === 'lines' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(!f.optional)
    .setMaxLength(max)
    .setValue(String(cur ?? '').slice(0, max));
  if (f.type === 'num') ti.setPlaceholder(`Número entre ${f.min} e ${f.max}`);
  return new ModalBuilder()
    .setCustomId(`adm:m:${screen}:${idx}`)
    .setTitle('Editar campo')
    .addComponents(new ActionRowBuilder().addComponents(ti));
}

function pickerV2(guild, screen, idx, f, cfg, note = '') {
  const p = new Panel();
  p.text(`## ${f.label}\n${helpOf(f) || 'Escolha uma opção.'}`);
  p.text(`**Atual:**\n${show(f, cfg)}`);
  if (note) p.text(note);
  p.sep();
  const back = sbtn(`adm:pg:${screen}:${pageOf(idx)}`, 'Voltar', ButtonStyle.Secondary, '⬅️');
  if (f.type === 'enum') {
    const cur = getPath(cfg, f.path);
    const btns = f.options.map((o, k) =>
      sbtn(`adm:o:${screen}:${idx}:${k}`, o.label.slice(0, 80), o.value === cur ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
    for (let k = 0; k < btns.length; k += 5) p.row(...btns.slice(k, k + 5));
    p.row(back);
    return p.done();
  }
  const cur = getPath(cfg, f.path);
  const id = `adm:v:${screen}:${idx}`;
  let menu;
  if (f.type === 'roles') {
    menu = new RoleSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder(`Escolha os cargos (deste servidor)`)
      .setMinValues(0)
      .setMaxValues(25);
    const defs = (cur || []).filter((r) => guild?.roles.cache.has(r));
    if (defs.length) menu.setDefaultRoles(defs.slice(0, 25));
  } else {
    const multi = f.type === 'chans';
    menu = new ChannelSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder(multi ? 'Escolha os canais (deste servidor)' : 'Escolha o canal (deste servidor)')
      .setChannelTypes(...f.types)
      .setMinValues(multi ? 0 : 1)
      .setMaxValues(multi ? 25 : 1);
    const defs = (multi ? cur || [] : cur ? [cur] : []).filter((c) => guild?.channels.cache.has(c));
    if (defs.length) menu.setDefaultChannels(defs.slice(0, 25));
  }
  p.row(menu);
  const buttons = [
    sbtn(`adm:ida:${screen}:${idx}`, f.type === 'chan' ? 'Definir por ID' : 'Adicionar por ID', ButtonStyle.Primary, '🔢'),
  ];
  if (f.type !== 'chan') buttons.push(sbtn(`adm:idr:${screen}:${idx}`, 'Remover por ID', ButtonStyle.Secondary, '➖'));
  buttons.push(sbtn(`adm:clr:${screen}:${idx}`, f.type === 'chan' ? 'Limpar canal' : 'Limpar tudo', ButtonStyle.Danger, '🧹'));
  buttons.push(back);
  p.row(...buttons);
  p.text(
    '-# O seletor mostra só este servidor e **troca apenas os itens dele**; os de outros servidores são mantidos. Para itens de outro servidor, use **por ID** (Modo Desenvolvedor → botão direito → Copiar ID).',
  );
  return p.done();
}

const idsModal = (kind, screen, idx, f) =>
  new ModalBuilder()
    .setCustomId(`adm:id${kind}m:${screen}:${idx}`)
    .setTitle(`${kind === 'a' ? (f.type === 'chan' ? 'Definir' : 'Adicionar') : 'Remover'} por ID`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ids')
          .setLabel('IDs (um por linha)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1500)
          .setPlaceholder('Modo Desenvolvedor → botão direito → Copiar ID'),
      ),
    );

async function resolveIds(client, f, ids) {
  const out = [];
  for (const id of ids) {
    if (!SNOW.test(id)) throw new Error(`"${id}" não é um ID válido.`);
    if (f.type === 'roles') {
      if (!client.guilds.cache.some((g) => g.roles.cache.has(id)))
        throw new Error(`Não encontrei o cargo ${id}. O bot precisa estar no servidor dele.`);
    } else {
      const ch = await client.channels.fetch(id).catch(() => null);
      if (!ch)
        throw new Error(
          `Não encontrei o canal ${id}. O bot precisa estar no servidor dele (cadastre o ID do servidor em **Servidores extras de call** antes de convidar o bot).`,
        );
      if (f.types && !f.types.includes(ch.type))
        throw new Error(`O canal ${id} (**${ch.name}**) não é do tipo esperado para este campo.`);
    }
    out.push(id);
  }
  return out;
}

async function handleAdmin(i) {
  const cfg = getCfg();
  CLIENT = i.client;
  if (!guildKey(i.guildId)) return i.reply(deny(`${E('bad')} Este servidor não está autorizado.`));
  if (!perms(i.member, cfg).isAdmin) return i.reply(deny(`${E('bad')} Apenas administradores podem usar o painel.`));
  const rawUpdate = i.update.bind(i);
  i.update = (p) => rawUpdate(asV2(p));
  const parts = i.customId.split(':');
  const [, act, a, b, c] = parts;

  switch (act) {
    case 'home':
      return i.update(homeV2());
    case 'back':
    case 's':
      return i.update(await renderScreen(a));
    case 'pg':
      return i.update(screenV2(a, Number(b)));
    case 't': {
      // liga/desliga
      const f = SCREENS[a]?.fields[Number(b)];
      if (!f || f.type !== 'bool') return undefined;
      await save(i, f, !getPath(cfg, f.path));
      return i.update(screenAt(a, b));
    }
    case 'e': {
      // editar
      const idx = Number(b);
      const f = SCREENS[a]?.fields[idx];
      if (!f) return undefined;
      if (['text', 'num', 'lines'].includes(f.type)) return i.showModal(fieldModal(a, idx, f, cfg));
      return i.update(pickerV2(i.guild, a, idx, f, cfg));
    }
    case 'o': {
      // opção de um campo de escolha
      const f = SCREENS[a]?.fields[Number(b)];
      const opt = f?.options?.[Number(c)];
      if (!opt) return undefined;
      await save(i, f, opt.value);
      return i.update(screenAt(a, b, `${E('ok')} Salvo.`));
    }
    case 'v': {
      // seletor de canal/cargo
      const idx = Number(b);
      const f = SCREENS[a]?.fields[idx];
      if (!f) return undefined;
      let value = f.type === 'chan' ? i.values[0] : i.values;
      if (f.type === 'chans' || f.type === 'roles') {
        const inGuild = (id) => (f.type === 'roles' ? i.guild.roles.cache.has(id) : i.guild.channels.cache.has(id));
        value = [...new Set([...(getPath(cfg, f.path) || []).filter((id) => !inGuild(id)), ...i.values])];
      }
      await save(i, f, value);
      return i.update(pickerV2(i.guild, a, idx, f, getCfg(), `${E('ok')} Salvo.`));
    }
    case 'ida':
    case 'idr': {
      const f = SCREENS[a]?.fields[Number(b)];
      if (!f) return undefined;
      return i.showModal(idsModal(act === 'ida' ? 'a' : 'r', a, b, f));
    }
    case 'idam':
    case 'idrm': {
      const f = SCREENS[a]?.fields[Number(b)];
      if (!f) return undefined;
      const raw = i.fields.getTextInputValue('ids');
      let ids;
      try {
        ids = idsFromStr(raw);
      } catch (e) {
        return i.reply(deny(`${E('bad')} ${e.message}`));
      }
      if (!ids.length) return i.reply(deny(`${E('bad')} Informe pelo menos um ID.`));
      const cur = getPath(cfg, f.path);
      let value;
      if (act === 'idam') {
        try {
          ids = await resolveIds(i.client, f, f.type === 'chan' ? ids.slice(0, 1) : ids);
        } catch (e) {
          return i.reply(deny(`${E('bad')} ${e.message}`));
        }
        value = f.type === 'chan' ? ids[0] : [...new Set([...(cur || []), ...ids])];
      } else {
        value = (cur || []).filter((id) => !ids.includes(id));
      }
      await save(i, f, value);
      return i.update(
        pickerV2(i.guild, a, Number(b), f, getCfg(), act === 'idam' ? `${E('ok')} Adicionado.` : `${E('ok')} Removido.`),
      );
    }
    case 'clr': {
      const f = SCREENS[a]?.fields[Number(b)];
      if (!f) return undefined;
      await save(i, f, f.type === 'chan' ? null : []);
      return i.update(pickerV2(i.guild, a, Number(b), f, getCfg(), `${E('ok')} Limpo.`));
    }
    case 'm': {
      // salvar campo de texto/número
      const f = SCREENS[a]?.fields[Number(b)];
      if (!f) return undefined;
      const raw = i.fields.getTextInputValue('v').trim();
      let value;
      if (f.type === 'num') {
        value = parseFloat(raw.replace(',', '.'));
        if (!Number.isFinite(value) || value < f.min || value > f.max)
          return i.reply(deny(`${E('bad')} Informe um número entre ${f.min} e ${f.max}.`));
        if (f.int !== false) value = Math.round(value);
        const conflict = pointsConflict(f.path, value, cfg);
        if (conflict) return i.reply(deny(`${E('bad')} ${conflict}`));
      } else if (f.type === 'lines') {
        try {
          value = f.fromStr(raw);
        } catch (e) {
          return i.reply(deny(`${E('bad')} ${e.message}`));
        }
      } else {
        if (f.snowflake) {
          if (raw && !SNOW.test(raw))
            return i.reply(deny(`${E('bad')} Informe o ID numérico do servidor (ou deixe vazio para usar o .env).`));
          const otherPath = f.path === 'servers.mainId' ? 'servers.internalId' : 'servers.mainId';
          const otherEnv = f.path === 'servers.mainId' ? process.env.SERVER_INTERNO_ID : process.env.SERVER_PRINCIPAL_ID;
          const effective =
            raw || (f.path === 'servers.mainId' ? process.env.SERVER_PRINCIPAL_ID : process.env.SERVER_INTERNO_ID);
          if (effective && effective === (getPath(cfg, otherPath) || otherEnv))
            return i.reply(deny(`${E('bad')} O servidor principal e o interno precisam ser diferentes.`));
        }
        if (f.prefix) {
          const v = raw.toLowerCase();
          if (!/^\S{2,20}$/.test(v)) return i.reply(deny(`${E('bad')} O prefixo precisa ter de 2 a 20 caracteres, sem espaços.`));
          const others = ['prefixes.start', 'prefixes.lista', 'prefixes.cancel'].filter((x) => x !== f.path);
          if (others.some((x) => v === String(getPath(cfg, x) || '').toLowerCase()))
            return i.reply(deny(`${E('bad')} Os prefixos precisam ser diferentes entre si.`));
        }
        if (f.color && !/^#?[0-9a-f]{6}$/i.test(raw))
          return i.reply(deny(`${E('bad')} Use uma cor hexadecimal, por exemplo \`#2B2D31\`.`));
        if (f.path.endsWith('banner') || f.path.endsWith('thumbnail')) {
          if (raw && !/^https?:\/\/\S+$/i.test(raw))
            return i.reply(deny(`${E('bad')} Informe uma URL começando com http:// ou https://.`));
        }
        value = f.color ? `#${raw.replace('#', '').toUpperCase()}` : f.prefix ? raw.toLowerCase() : raw;
      }
      await save(i, f, value);
      return i.update(screenAt(a, b, `${E('ok')} Salvo.`));
    }
    default:
      return extra.handle(i, parts);
  }
}

async function adminCommand(i) {
  const cfg = getCfg();
  CLIENT = i.client;
  if (!guildKey(i.guildId)) return i.reply(deny(`${E('bad')} Este servidor não está autorizado.`));
  if (!perms(i.member, cfg).isAdmin) return i.reply(deny(`${E('bad')} Apenas administradores podem usar o painel.`));
  return i.reply({ ...homeV2(), flags: FLAGS | MessageFlags.Ephemeral }); // só quem usou o comando vê o painel
}

module.exports = {
  adminCommand,
  handleAdmin,
  _test: { SCREENS, screenV2, homeV2, pickerV2, fieldModal, idsModal, idsFromStr, pointsConflict, GROUPS },
};
