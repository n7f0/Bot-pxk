'use strict';

const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const WD_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const pad2 = (n) => String(n).padStart(2, '0');

function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Partes da data (no fuso informado) para um timestamp em ms. */
function partsInTz(ms, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const out = {};
  for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WD_MAP[out.weekday],
  };
}

function tzOffsetMs(ms, tz) {
  const p = partsInTz(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Converte uma data/hora local (no fuso) para timestamp UTC em ms. */
function zonedToUtc(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0);
  const off = tzOffsetMs(guess, tz);
  let utc = guess - off;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off) utc = guess - off2;
  return utc;
}

/** Última ocorrência (<= agora) de "dia da semana + HH:MM" no fuso informado. */
function lastWeeklyOccurrence(nowMs, weekday, hh, mm, tz) {
  for (let back = 0; back <= 7; back++) {
    const p = partsInTz(nowMs - back * 86400000, tz);
    if (p.weekday !== weekday) continue;
    const cand = zonedToUtc(p.year, p.month, p.day, hh, mm, tz);
    if (cand <= nowMs) return cand;
  }
  return null;
}

/** Data no formato 02/10/2026 21:00 no fuso informado. */
function fmtDateTime(ms, tz) {
  if (!ms) return '—';
  const p = partsInTz(ms, tz);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

function fmtDate(ms, tz) {
  if (!ms) return '—';
  const p = partsInTz(ms, tz);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
}

function parseHHMM(text) {
  const m = String(text || '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return { hh: Number(m[1]), mm: Number(m[2]), text: `${pad2(Number(m[1]))}:${m[2]}` };
}

module.exports = {
  WEEKDAYS,
  pad2,
  isValidTimezone,
  partsInTz,
  zonedToUtc,
  lastWeeklyOccurrence,
  fmtDateTime,
  fmtDate,
  parseHHMM,
};
