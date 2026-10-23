'use strict';

/** Marcador da linha fina: o baseEmbed troca por theme.sep() (configurável no /painel → Visual). */
const SEP = '────────────────────';
const pad2 = (n) => String(n).padStart(2, '0');

function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

/** 7200000 -> "2 horas" | 5400000 -> "1h 30min" | 2700000 -> "45 min" */
function humanDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && !m) return h === 1 ? '1 hora' : `${h} horas`;
  if (h) return `${h}h ${m}min`;
  return `${m} min`;
}

function progressBar(value, max, size = 12) {
  return require('../theme').bar(value, max, size); // caracteres configuráveis no tema
}

function percent(value, max) {
  if (max <= 0) return 100;
  return Math.min(100, Math.floor((value / max) * 100));
}

function parseUserId(input) {
  const m = String(input || '').match(/\d{17,20}/);
  return m ? m[0] : null;
}

/** Aceita "2h", "90m", "1h30", "1h30m", "02:00", "1,5h" ou número puro (minutos). Retorna ms ou null. */
function parseDuration(input) {
  const s = String(input || '').trim().toLowerCase().replace(',', '.');
  let m;
  if ((m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/))) {
    return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0)) * 1000;
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:oras?)?\s*(?:(\d+)\s*(?:m|min|minutos?)?)?$/))) {
    return Math.round((parseFloat(m[1]) * 60 + (m[2] ? Number(m[2]) : 0)) * 60000);
  }
  if ((m = s.match(/^(\d+)\s*(?:m|min|minutos?)$/))) return Number(m[1]) * 60000;
  if ((m = s.match(/^(\d+)$/))) return Number(m[1]) * 60000;
  return null;
}

function parseIntStrict(input) {
  const s = String(input ?? '').trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const num = (n) => Number(n || 0).toLocaleString('pt-BR');
const seasonLabel = (n) => `#${pad2(n)}`;
const truncate = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const NUM_EMOJI = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
function posEmoji(pos) {
  if (pos === 1) return '🥇';
  if (pos === 2) return '🥈';
  if (pos === 3) return '🥉';
  if (pos <= 10) return NUM_EMOJI[pos];
  return '🔹';
}

module.exports = {
  SEP,
  pad2,
  formatDuration,
  humanDuration,
  progressBar,
  percent,
  parseUserId,
  parseDuration,
  parseIntStrict,
  signed,
  num,
  seasonLabel,
  truncate,
  clamp,
  posEmoji,
};
