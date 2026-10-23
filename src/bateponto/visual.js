'use strict';

const { ButtonStyle } = require('discord.js');
const settings = require('../database/settings');
const theme = require('../theme');
const { BPV_TEXT } = require('../theme/defaults');
const { humanDuration } = require('../utils/format');

const STYLES = { secondary: ButtonStyle.Secondary, primary: ButtonStyle.Primary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };
const STYLE_NAMES = { secondary: 'cinza', primary: 'azul', success: 'verde', danger: 'vermelho' };
const STYLE_ALIASES = {
  cinza: 'secondary', neutro: 'secondary', secundario: 'secondary', secundário: 'secondary', secondary: 'secondary',
  azul: 'primary', primario: 'primary', primário: 'primary', primary: 'primary',
  verde: 'success', sucesso: 'success', success: 'success',
  vermelho: 'danger', perigo: 'danger', danger: 'danger',
};

/** "verde" -> 'success' (ou null se inválido). */
const parseStyle = (input) => STYLE_ALIASES[String(input || '').trim().toLowerCase()] || null;
const styleName = (key) => STYLE_NAMES[get(key)] || 'cinza';

/** Emoji unicode ou personalizado (<:nome:id>). */
const EMOJI_RE = /^(?:<a?:\w{2,32}:\d{17,20}>|(?:\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]\uFE0F?\u20E3)(?:[\uFE0F\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic})*)$/u;
const validEmoji = (s) => EMOJI_RE.test(String(s || '').trim());

/** Valor configurado ou, se vazio, o padrão. */
function get(key) {
  const v = settings.get(key);
  return v === null || v === undefined || v === '' ? BPV_TEXT[key] : v;
}

/** Texto já com as variáveis substituídas. */
const text = (key, vars) => theme.render(get(key), vars);

/** Emoji de botão: null = sem emoji ("-"), inválido = padrão. */
function emoji(key) {
  const v = settings.get(key);
  if (v === '-') return null;
  if (v && validEmoji(v)) return String(v).trim();
  return BPV_TEXT[key] || null;
}

const style = (key) => STYLES[get(key)] || ButtonStyle.Secondary;

/** Variáveis disponíveis nos textos configuráveis. */
function vars(cfg, extra = {}) {
  return {
    area: cfg.area,
    tempo: humanDuration(cfg.durationMin * 60000),
    meta: `${cfg.goal}`,
    canal: cfg.channelId ? `<#${cfg.channelId}>` : '*não configurado*',
    recompensa: `+${cfg.reward} pontos`,
    antiflood: `${cfg.cooldownSec}s`,
    ...extra,
  };
}

/** Linhas de texto -> marcadores. Linhas que já começam com símbolo são mantidas. */
function bullets(raw) {
  return String(raw)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[•\-*›▸▪·>#]/u.test(l) ? l : `• ${l}`))
    .join('\n');
}

module.exports = { get, text, emoji, style, styleName, parseStyle, validEmoji, vars, bullets, STYLE_NAMES };
