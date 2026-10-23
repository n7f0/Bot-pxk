const { ActionRowBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { LogEntry, UserStat } = require('./db');

const MAIN_ID = process.env.SERVER_PRINCIPAL_ID;
const INTERNAL_ID = process.env.SERVER_INTERNO_ID;
// Cargos (IDs, separados por vírgula) com acesso total a todos os comandos e ao painel /admin
const FULL_ACCESS_ROLE_IDS = String(process.env.FULL_ACCESS_ROLE_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const guildKey = (id) => {
  if (!id) return null;
  if (id === MAIN_ID) return 'main';
  if (id === INTERNAL_ID) return 'internal';
  return null;
};
const guildIdOf = (key) => (key === 'main' ? MAIN_ID : INTERNAL_ID);
const SERVER_NAMES = { main: 'Servidor Principal', internal: 'Servidor Interno' };

// Paleta única: nada de cores aleatórias
const COLORS = { neutral: 0x2b2d31, ok: 0x57f287, warn: 0xfee75c, bad: 0xed4245 };

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const unique = (arr) => [...new Set((arr || []).filter(Boolean))];
const ts = (d, style = 'f') => `<t:${Math.floor(new Date(d).getTime() / 1000)}:${style}>`;
const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const render = (tpl, vars) => String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));

function parseColor(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return Number.isNaN(n) ? COLORS.neutral : n;
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
  if (m > 0) return `${m}min ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

// ---------- permissões (por servidor) ----------
const hasAny = (member, ids) => (ids || []).some((id) => member.roles.cache.has(id));

function perms(member, cfg) {
  const k = guildKey(member.guild?.id);
  const p = k ? cfg.perms[k] : null;
  const isAdmin =
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    hasAny(member, FULL_ACCESS_ROLE_IDS) ||
    (!!p && hasAny(member, p.admin));
  const isLeader = isAdmin || (!!p && hasAny(member, p.leader));
  const isRecruiter = isLeader || (!!p && hasAny(member, p.recruiter));
  const isShift = isAdmin || (!!p && (p.shift?.length ? hasAny(member, p.shift) : isRecruiter));
  return { isAdmin, isLeader, isRecruiter, isShift };
}

// ---------- logs nos dois servidores ----------
const LOG_ROUTES = {
  tickets: ['main', 'internal'],
  recruitment: ['main', 'internal'],
  plantao: ['internal'], // obrigatoriamente no servidor interno
  admin: ['internal'],
};
const LOG_KEYS = { tickets: 'tickets', recruitment: 'recrutamento', plantao: 'plantao', admin: 'admin' };

async function emit(client, cfg, { category, action, embed, userId, data }) {
  LogEntry.create({ category, action, userId, data }).catch((e) => console.error('[log-db]', e.message));
  for (const sk of LOG_ROUTES[category]) {
    const targets = cfg.logs[sk] || {};
    const id = targets[LOG_KEYS[category]] || targets.geral;
    if (!id) {
      console.warn(`[log] sem canal configurado para "${category}" no ${SERVER_NAMES[sk]}.`);
      continue;
    }
    try {
      const ch = await client.channels.fetch(id);
      if (!ch || ch.guildId !== guildIdOf(sk)) {
        console.warn(`[log] canal ${id} não pertence ao ${SERVER_NAMES[sk]}.`);
        continue;
      }
      await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (e) {
      console.error(`[log:${category}:${sk}]`, e.message);
    }
  }
}

// Remove os emojis de botões/menus (usado como plano B quando o Discord recusa um emoji)
function stripEmojis(components) {
  const walk = (n) => {
    if (Array.isArray(n)) return n.map(walk);
    if (n && typeof n === 'object') {
      if (typeof n.toJSON === 'function') return walk(n.toJSON());
      const o = {};
      for (const [k, v] of Object.entries(n)) if (k !== 'emoji') o[k] = walk(v);
      return o;
    }
    return n;
  };
  return walk(components);
}

async function addStats(userId, name, inc) {
  return UserStat.findOneAndUpdate(
    { userId },
    { $set: { name: name || undefined, updatedAt: new Date() }, $inc: inc },
    { upsert: true, new: true }
  );
}

module.exports = {
  MAIN_ID, INTERNAL_ID, guildKey, guildIdOf, SERVER_NAMES, COLORS,
  row, unique, ts, trunc, render, parseColor, fmtDuration, perms, emit, addStats, stripEmojis, EmbedBuilder,
};
