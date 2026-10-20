const { ActionRowBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { AuditLog, getCfg } = require('./db');

const mainId = () => getCfg().servers?.mainId || process.env.SERVER_PRINCIPAL_ID;
const internalId = () => getCfg().servers?.internalId || process.env.SERVER_INTERNO_ID;
const unique = (arr) => [...new Set((arr || []).filter(Boolean))];

const guildKey = (id) => {
  if (!id) return null;
  if (id === mainId()) return 'main';
  if (id === internalId()) return 'internal';
  return null;
};
const commandGuildIds = () => unique([mainId(), internalId()]);
const voiceGuildIds = () => unique([mainId(), internalId(), ...(getCfg().servers?.extraGuildIds || [])]);
const isKnownGuild = (id) => !!id && voiceGuildIds().includes(id);

const COLORS = { neutral: 0x2b2d31, ok: 0x57f287, warn: 0xfee75c, bad: 0xed4245 };

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const ts = (d, style = 'f') => `<t:${Math.floor(new Date(d).getTime() / 1000)}:${style}>`;
const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const render = (tpl, vars) => String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const eph = (obj) => ({ ...obj, flags: MessageFlags.Ephemeral });
const deny = (content) => eph({ content });

function parseColor(hex, fallback = COLORS.neutral) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  return m ? parseInt(m[1], 16) : fallback;
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

const OFFSET_MS = -3 * 3600 * 1000;
const DAY_MS = 86400000;
const toBRT = (d) => new Date(new Date(d).getTime() + OFFSET_MS);
const dayKey = (d = new Date()) => toBRT(d).toISOString().slice(0, 10);
const startOfDay = (d = new Date()) => {
  const b = toBRT(d);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - OFFSET_MS);
};
const startOfWeek = (d = new Date()) => {
  const back = (toBRT(d).getUTCDay() + 6) % 7; // semana começa na segunda
  return new Date(startOfDay(d).getTime() - back * DAY_MS);
};
const startOfMonth = (d = new Date()) => {
  const b = toBRT(d);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 1) - OFFSET_MS);
};
const startOfNextMonth = (d = new Date()) => {
  const b = toBRT(d);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 1) - OFFSET_MS);
};
const FAR_FUTURE = new Date(8.64e15);

// janela de um período de meta
function periodRange(period, now = new Date(), season = null) {
  if (period === 'daily') {
    const start = startOfDay(now);
    return { key: `d:${dayKey(now)}`, start, end: new Date(start.getTime() + DAY_MS) };
  }
  if (period === 'weekly') {
    const start = startOfWeek(now);
    return { key: `w:${dayKey(start)}`, start, end: new Date(start.getTime() + 7 * DAY_MS) };
  }
  if (period === 'monthly') {
    const start = startOfMonth(now);
    return { key: `m:${dayKey(start).slice(0, 7)}`, start, end: startOfNextMonth(now) };
  }
  return { key: `s:${season?._id || 'x'}`, start: season?.startsAt || new Date(0), end: FAR_FUTURE };
}

// permissões
const envAdminRoleIds = () => (process.env.ADMIN_ROLE_IDS || '').split(/[\s,;]+/).filter(Boolean);

function perms(member, cfg = getCfg()) {
  const roles = member?.roles?.cache;
  const has = (ids) => !!roles && (ids || []).some((id) => roles.has(id));
  const discordAdmin =
    !!member?.permissions?.has(PermissionFlagsBits.Administrator) &&
    (cfg.perms.discordAdmin !== false || !(cfg.perms.admin || []).length);
  const isAdmin = discordAdmin || has(cfg.perms.admin) || has(envAdminRoleIds());
  const isLeader = isAdmin || has(cfg.perms.leader);
  return {
    isAdmin,
    isLeader,
    canMonitor: isLeader || has(cfg.perms.monitor),
    canPoints: isLeader || has(cfg.perms.points),
    canStartMov: isAdmin || has(cfg.perms.starter),
    canSelfMonitor: has(cfg.perms.selfMonitor),
  };
}

const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

async function sendLog(client, kind, embed) {
  try {
    const cfg = getCfg();
    const id = cfg.logs[kind] || cfg.logs.geral;
    if (!id) return;
    const ch = await client.channels.fetch(id).catch(() => null);
    if (!ch?.isTextBased()) return;
    await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (e) {
    console.error('[log]', e.message);
  }
}
const logEmbed = (title, description, color = COLORS.neutral) =>
  new EmbedBuilder().setColor(color).setTitle(title).setDescription(trunc(description, 4000)).setTimestamp();

async function audit(client, user, action, target, detail) {
  try {
    await AuditLog.create({ by: user.id, byTag: user.username, action, target, detail: trunc(detail || '', 500) });
  } catch (e) {
    console.error('[audit]', e.message);
  }
  await sendLog(
    client,
    'admin',
    logEmbed(`⚙️ ${action}`, `**Por:** <@${user.id}>\n**Alvo:** ${target || '-'}\n**Detalhe:** ${trunc(detail || '-', 900)}`),
  );
}

module.exports = {
  mainId,
  internalId,
  commandGuildIds,
  voiceGuildIds,
  isKnownGuild,
  guildKey,
  COLORS,
  row,
  unique,
  ts,
  trunc,
  render,
  fmt,
  eph,
  deny,
  parseColor,
  fmtDuration,
  OFFSET_MS,
  DAY_MS,
  toBRT,
  dayKey,
  startOfDay,
  startOfWeek,
  startOfMonth,
  periodRange,
  FAR_FUTURE,
  perms,
  withLock,
  sendLog,
  logEmbed,
  audit,
};
