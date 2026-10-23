// ============================================================
// Emojis editáveis do bot
// ------------------------------------------------------------
// Tudo que aparece com emoji (botões, menus, títulos, ranking, logs...)
// passa por aqui. O administrador troca pelo /admin → Emojis e ícones.
//
//   E('close')   → texto do emoji, para usar dentro de mensagens/embeds
//   Eb('close')  → objeto de emoji para botões e opções de menu
//
// Só as trocas ficam salvas no banco (cfg.emojis). Chave sem troca usa o padrão.
// ============================================================

// [chave, descrição, padrão]
const GROUPS = [
  {
    id: 'ticket_btn',
    label: 'Botões e tipos do ticket',
    emoji: '🎫',
    items: [
      ['typeStaff', 'Quero ser staff (botão/título)', '📋'],
      ['typeMig', 'Quero ser migrado (botão/título)', '🔁'],
      ['menuStaff', 'Opção Recrutamento (menu do painel V3)', '✨'],
      ['menuMig', 'Opção Migração (menu do painel V3)', '✨'],
      ['claim', 'Assumir atendimento', '🙋'],
      ['setRoles', 'Setar cargos', '🎖️'],
      ['reject', 'Reprovar', '❌'],
      ['transfer', 'Transferir', '🔁'],
      ['close', 'Fechar ticket', '🔒'],
      ['done', 'Botão final (concluído/reprovado)', '✅'],
    ],
  },
  {
    id: 'ticket_log',
    label: 'Títulos de ticket e logs',
    emoji: '📥',
    items: [
      ['attended', 'Campo "Atendido por"', '👤'],
      ['logOpened', 'Log: ticket aberto', '📥'],
      ['logStarted', 'Log: recrutamento iniciado', '📝'],
      ['logFinished', 'Log: recrutamento finalizado', '🏆'],
      ['logDeleted', 'Log: canal apagado', '🗑️'],
    ],
  },
  {
    id: 'status',
    label: 'Status e avisos',
    emoji: '✅',
    items: [
      ['ok', 'Sucesso', '✅'],
      ['warn', 'Atenção', '⚠️'],
      ['bad', 'Erro / negado', '❌'],
      ['info', 'Informação', 'ℹ️'],
      ['off', 'Desativado', '⛔'],
    ],
  },
  {
    id: 'shift',
    label: 'Plantão',
    emoji: '🕐',
    items: [
      ['shiftTitle', 'Título do painel de plantão', '🕐'],
      ['shiftStart', 'Botão Iniciar Plantão', '🕐'],
      ['shiftEnd', 'Botão Cancelar Plantão', '⏹️'],
      ['shiftPlanned', 'Duração prevista', '⏱️'],
      ['shiftMin', 'Tempo mínimo', '⏳'],
      ['shiftEta', 'Término previsto', '🕑'],
      ['shiftLog', 'Log: plantão iniciado / em análise', '📋'],
      ['shiftMuted', 'Log: tempo mutado', '🔇'],
      ['shiftTickets', 'Log: tickets atendidos', '🎫'],
      ['voice', 'Call / voz', '🎙️'],
      ['trophy', 'Pontos recebidos', '🏆'],
    ],
  },
  {
    id: 'ranking',
    label: 'Ranking (títulos e detalhes)',
    emoji: '📊',
    items: [
      ['rankTitle', 'Título do ranking', '🏆'],
      ['rankStats', 'Estatísticas (/ranking usuário)', '📊'],
      ['rankPoints', 'Pontos', '🏆'],
      ['rankRecruits', 'Recrutamentos', '👥'],
      ['rankMig', 'Migrações', '🔁'],
      ['rankShifts', 'Plantões', '🕐'],
      ['rankTime', 'Tempo de plantão', '⏱️'],
    ],
  },
  {
    id: 'ranking_pos',
    label: 'Ranking (posições)',
    emoji: '🥇',
    // vazio = usa o número em negrito (**4.**)
    items: [
      ['rank1', '1º lugar', '🥇'],
      ['rank2', '2º lugar', '🥈'],
      ['rank3', '3º lugar', '🥉'],
      ['rank4', '4º lugar', ''],
      ['rank5', '5º lugar', ''],
      ['rank6', '6º lugar', ''],
      ['rank7', '7º lugar', ''],
      ['rank8', '8º lugar', ''],
      ['rank9', '9º lugar', ''],
      ['rank10', '10º lugar', ''],
      ['rankOther', 'Demais posições (11+)', ''],
    ],
  },
  {
    id: 'admin_menu',
    label: 'Painel admin: menus e títulos',
    emoji: '⚙️',
    items: [
      ['admHome', 'Painel administrativo', '⚙️'],
      ['admTickets', 'Tickets', '🎫'],
      ['admPresets', 'Presets de tickets', '🧩'],
      ['admPoints', 'Pontuação', '🏆'],
      ['admShift', 'Plantão', '🕐'],
      ['admRanking', 'Ranking', '📊'],
      ['admLogs', 'Logs', '📝'],
      ['admPerms', 'Permissões', '🔐'],
      ['admEmojis', 'Emojis e ícones', '😀'],
      ['admAppearance', 'Aparência do painel', '🎨'],
      ['admMessages', 'Mensagens', '💬'],
      ['admNaming', 'Nome dos tickets', '🏷️'],
      ['admForms', 'Formulários', '📝'],
      ['admRoles', 'Cargos do recrutamento', '🎖️'],
      ['admReqShift', 'Exigir plantão', '🕐'],
      ['admPublish', 'Publicar painel', '📢'],
    ],
  },
  {
    id: 'admin_btn',
    label: 'Painel admin: botões',
    emoji: '🔘',
    items: [
      ['admBack', 'Voltar', '↩️'],
      ['admEdit', 'Editar', '✏️'],
      ['admAdd', 'Adicionar', '➕'],
      ['admRestore', 'Restaurar padrão', '♻️'],
      ['admToggle', 'Liga/desliga', '🔘'],
      ['admAuto', 'Atualização automática', '🔄'],
      ['admRefresh', 'Atualizar agora', '📌'],
      ['admReset', 'Resetar', '🗑️'],
      ['admActive', 'Plantões ativos', '📋'],
      ['admClear', 'Limpar / remover', '🧹'],
      ['admPreview', 'Ver prévia', '👁️'],
      ['admStyle', 'Alterna estilo', '🖼️'],
      ['admSort', 'Ordenação', '🔃'],
    ],
  },
];

const DEFAULTS = {};
const LABELS = {};
const GROUP_OF = {};
for (const g of GROUPS) {
  for (const [key, label, def] of g.items) {
    DEFAULTS[key] = def;
    LABELS[key] = label;
    GROUP_OF[key] = g.id;
  }
}

// Trocas feitas pelo administrador (null/ausente = padrão, '' = sem emoji)
let overrides = {};
function setOverrides(o) {
  overrides = o && typeof o === 'object' ? o : {};
}

const raw = (key) => {
  const v = overrides[key];
  if (v === undefined || v === null) return DEFAULTS[key] ?? '';
  return v;
};

const CUSTOM_RE = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,22})>$/;

// Texto para mensagens/embeds
const E = (key) => raw(key);

// Objeto para botões e opções de menu (undefined = sem emoji)
let _client = null;
const setClient = (c) => { _client = c; };

function Eb(key) {
  const v = raw(key);
  if (!v) return undefined;
  const m = v.match(CUSTOM_RE);
  if (m) {
    // emoji customizado que o bot não enxerga (apagado ou de servidor onde ele não está) derrubaria a mensagem inteira
    if (_client && _client.isReady() && !_client.emojis.cache.has(m[3])) return undefined;
    return { id: m[3], name: m[2], animated: m[1] === 'a' };
  }
  return { name: v };
}

// Título com emoji (sem espaço sobrando quando o emoji foi removido)
const lbl = (key, text) => (raw(key) ? `${raw(key)} ${text}` : text);

// Emoji da posição no ranking (cai para "**4.**" se não houver emoji)
function rankEmoji(pos) {
  const v = raw(pos <= 10 ? `rank${pos}` : 'rankOther');
  return v || `**${pos}.**`;
}

// Valida o texto digitado pelo administrador.
// → { value: string|null }  (null = voltar ao padrão, '' = sem emoji)  ou { error }
const NONE_WORDS = ['nenhum', 'none', 'remover', 'sem', '-'];
function parseInput(input) {
  const s = String(input ?? '').trim();
  if (!s) return { value: null };
  if (NONE_WORDS.includes(s.toLowerCase())) return { value: '' };

  if (CUSTOM_RE.test(s)) return { value: s };
  if (/^\d{17,22}$/.test(s)) return { value: `<:emoji:${s}>` };
  if (/^:[A-Za-z0-9_]+:$/.test(s)) {
    return { error: 'Digite o emoji em si (ex: 🏆) ou o formato completo `<:nome:ID>` — o formato `:nome:` não funciona em botões.' };
  }

  const parts = [...new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(s)];
  const isEmoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|^[#*0-9]\uFE0F?\u20E3$/u.test(s);
  if (parts.length !== 1 || !isEmoji) {
    return { error: 'Use **um único emoji** (ex: 🏆), um emoji customizado `<:nome:ID>` / `<a:nome:ID>`, ou escreva `nenhum` para tirar o emoji.' };
  }
  return { value: s };
}

module.exports = {
  GROUPS, DEFAULTS, LABELS, GROUP_OF,
  E, Eb, lbl, rankEmoji, setOverrides, setClient, parseInput,
  current: raw,
  isChanged: (key) => overrides[key] !== undefined && overrides[key] !== null,
};
