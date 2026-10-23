'use strict';

const settings = require('../database/settings');
const { UI_DEFAULTS } = require('./defaults');

const DEFAULT_COLOR = parseInt(UI_DEFAULTS.ui_color.slice(1), 16);

/** "#2b2d31" ou "2b2d31" -> número. Retorna null se inválido. */
function parseHex(hex) {
  const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? parseInt(m[1], 16) : null;
}

const color = () => parseHex(settings.get('ui_color')) ?? DEFAULT_COLOR;
const statusColors = () => Boolean(settings.get('ui_status_colors'));
const timestamp = () => Boolean(settings.get('ui_timestamp'));

/** Linha fina do tema. */
function sep() {
  const ch = String(settings.get('ui_sep_char') || UI_DEFAULTS.ui_sep_char);
  const len = Math.min(40, Math.max(4, Number(settings.get('ui_sep_len')) || UI_DEFAULTS.ui_sep_len));
  return ch.repeat(len);
}

/** Rodapé global: string, ou null quando ocultado (valor "-"). undefined = usar o padrão do bot. */
function footer() {
  const f = settings.get('ui_footer');
  if (f === '-') return null;
  return f || undefined;
}

function bar(value, max, size = 12) {
  const full = String(settings.get('ui_bar_full') || UI_DEFAULTS.ui_bar_full);
  const empty = String(settings.get('ui_bar_empty') || UI_DEFAULTS.ui_bar_empty);
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 1;
  const filled = Math.round(ratio * size);
  return full.repeat(filled) + empty.repeat(size - filled);
}

/** Substitui {variavel} por valores; variáveis desconhecidas ficam como estão. */
function render(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m));
}

module.exports = { DEFAULT_COLOR, parseHex, color, statusColors, timestamp, sep, footer, bar, render };
