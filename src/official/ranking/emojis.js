'use strict';

const settings = require('../database/settings');
const { pad2 } = require('../utils/format');

/** Posições que podem ter emoji próprio (1 a 100). */
const MAX_POS = 100;

/** Regras padrão: medalhas no pódio; as demais posições aparecem como número (`04`). */
const DEFAULT_TEXT = '1 = 🥇\n2 = 🥈\n3 = 🥉';

/** Um emoji unicode (com variações/ZWJ/keycap) ou customizado do servidor (<:nome:id> / <a:nome:id>). */
const EMOJI_RE = /^(?:<a?:\w{2,32}:\d{17,20}>|(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]️?⃣)(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)+$/u;

const isEmoji = (s) => s.length <= 80 && EMOJI_RE.test(s);

/**
 * Lê as regras digitadas pelo admin. Uma por linha:
 *   1 = 🥇            posição única
 *   4-10 = 🔹         intervalo (de 4 a 10)
 *   demais = ▫️       todas as posições sem emoji definido (inclusive acima de 100)
 * Linhas vazias e as que começam com # são ignoradas; regras de baixo vencem as de cima.
 * Retorna { map, rest, errors }.
 */
function parse(text) {
  const map = new Map();
  let rest = null;
  const errors = [];
  String(text || '')
    .split(/\r?\n/)
    .forEach((raw, idx) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const m = line.match(/^(\d+\s*(?:-|–|a|até)\s*\d+|\d+|demais|resto|\*)\s*(?:=|:|→|->)\s*(.+)$/iu);
      if (!m) {
        errors.push(`Linha ${idx + 1}: use o formato \`posição = emoji\` (ex.: \`1 = 🥇\` ou \`4-10 = 🔹\`).`);
        return;
      }
      const emoji = m[2].trim();
      if (!isEmoji(emoji)) {
        errors.push(`Linha ${idx + 1}: \`${emoji.slice(0, 20)}\` não é um emoji válido.`);
        return;
      }
      const key = m[1].toLowerCase();
      if (/^(demais|resto|\*)$/.test(key)) {
        rest = emoji;
        return;
      }
      const nums = key.match(/\d+/g).map(Number);
      const from = nums[0];
      const to = nums[1] ?? nums[0];
      if (from < 1 || to > MAX_POS || from > to) {
        errors.push(`Linha ${idx + 1}: as posições precisam ficar entre 1 e ${MAX_POS} (e o primeiro número não pode passar do segundo).`);
        return;
      }
      for (let p = from; p <= to; p++) map.set(p, emoji);
    });
  return { map, rest, errors };
}

let cached = { text: null, parsed: null };
function current() {
  const text = settings.get('ap_ranking_emojis') ?? DEFAULT_TEXT;
  if (cached.text !== text) cached = { text, parsed: parse(text) };
  return cached.parsed;
}

/** Texto das regras em uso (para preencher o modal de edição). */
const currentText = () => settings.get('ap_ranking_emojis') ?? DEFAULT_TEXT;

/** Marcador da posição: emoji definido → emoji; senão o número em destaque (`04`). */
function mark(position) {
  const { map, rest } = current();
  return map.get(position) || rest || `\`${pad2(position)}\``;
}

module.exports = { MAX_POS, DEFAULT_TEXT, parse, mark, currentText };
