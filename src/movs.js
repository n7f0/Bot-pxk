const { MovEvent, MovOccurrence, MovParticipation, getCfg } = require('./db');
const {
  withLock,
  sendLog,
  logEmbed,
  toBRT,
  dayKey,
  OFFSET_MS,
  DAY_MS,
  COLORS,
  fmt,
  fmtDuration,
  voiceGuildIds,
} = require('./core');
const { awardPoints } = require('./points');
const { checkMember } = require('./metas');
const { stateCounts } = require('./movcall');
const { E } = require('./emojis');

const DAY_NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

function parseDays(str) {
  const s = norm(str);
  if (!s || s.startsWith('todo') || s === '*' || s.startsWith('diari')) return [];
  const out = [];
  for (const t of s.split(/[\s,;/]+/).filter(Boolean)) {
    const i = DAY_NAMES.indexOf(t.slice(0, 3));
    if (i < 0) return null;
    if (!out.includes(i)) out.push(i);
  }
  return out.length ? out.sort() : null;
}
const formatDays = (days) => (!days?.length || days.length === 7 ? 'todos os dias' : days.map((d) => DAY_NAMES[d]).join(', '));

function windowFor(ev, ref) {
  const b = toBRT(ref);
  if (ev.days?.length && !ev.days.includes(b.getUTCDay())) return null;
  const [hh, mm] = String(ev.time).split(':').map(Number);
  const start = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), hh, mm) - OFFSET_MS);
  return { start, end: new Date(start.getTime() + ev.durationMin * 60000), dateKey: dayKey(ref) };
}
// próximo início a partir de agora
function nextStart(ev, now = new Date()) {
  for (let d = 0; d <= 7; d++) {
    const w = windowFor(ev, new Date(now.getTime() + d * DAY_MS));
    if (w && w.start > now) return w.start;
  }
  return null;
}

async function presentMembers(client, occ, cfg) {
  const useOcc = occ.channelIds.length || occ.categoryIds.length;
  const chIds = useOcc ? occ.channelIds : cfg.voice.channelIds;
  const catIds = useOcc ? occ.categoryIds : cfg.voice.categoryIds;
  const out = [];
  for (const gid of voiceGuildIds()) {
    const guild = client.guilds.cache.get(gid);
    if (!guild) continue;
    for (const vs of guild.voiceStates.cache.values()) {
      if (!vs.channelId) continue;
      if (!chIds.includes(vs.channelId) && !(vs.channel?.parentId && catIds.includes(vs.channel.parentId))) continue;
      if (!stateCounts(cfg, vs)) continue;
      const member = vs.member || (await guild.members.fetch(vs.id).catch(() => null));
      if (!member || member.user.bot) continue;
      out.push({ userId: member.id, tag: member.user.username });
    }
  }
  return out;
}

async function tickMovs(client) {
  const cfg = getCfg();
  const now = new Date();

  // 1) abre os MOVs que começaram agora
  const events = await MovEvent.find({ enabled: true });
  for (const ev of events) {
    const w = windowFor(ev, now);
    if (!w || now < w.start || now >= w.end) continue;
    try {
      await MovOccurrence.create({
        eventId: ev._id,
        name: ev.name,
        dateKey: w.dateKey,
        startsAt: w.start,
        endsAt: w.end,
        points: ev.points,
        minMinutes: ev.minMinutes,
        maxRewards: ev.maxRewards,
        channelIds: ev.channelIds,
        categoryIds: ev.categoryIds,
      });
      sendLog(
        client,
        'movs',
        logEmbed(
          `${E('mov')} MOV iniciado`,
          `**${ev.name}** começou e vai até <t:${Math.floor(w.end / 1000)}:t>.\nParticipação mínima: ${ev.minMinutes} min • Recompensa: ${fmt(ev.points)}.`,
          COLORS.ok,
        ),
      );
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
  }

  // 2) registra presença nos MOVs em andamento
  const active = await MovOccurrence.find({ status: 'active', startsAt: { $lte: now } });
  for (const occ of active) {
    if (now >= occ.endsAt) {
      await finalizeOccurrence(client, occ);
      continue;
    }
    const present = await presentMembers(client, occ, cfg);
    for (const m of present) {
      const p = await MovParticipation.findOne({ occurrenceId: occ._id, userId: m.userId });
      if (!p) {
        await MovParticipation.create({ occurrenceId: occ._id, userId: m.userId, tag: m.tag, sec: 0, lastSeenAt: now }).catch(
          (e) => {
            if (e.code !== 11000) throw e;
          },
        );
        continue;
      }
      const gap = (now - p.lastSeenAt) / 1000;
      await MovParticipation.updateOne(
        { _id: p._id },
        { $inc: { sec: gap > 0 && gap <= 150 ? gap : 0 }, $set: { lastSeenAt: now, tag: m.tag } },
      );
    }
  }

  const expired = await MovOccurrence.find({ status: 'active', endsAt: { $lte: now } });
  for (const occ of expired) await finalizeOccurrence(client, occ);
}

function finalizeOccurrence(client, occ) {
  return withLock(`mov:${occ._id}`, async () => {
    const fresh = await MovOccurrence.findById(occ._id);
    if (!fresh || fresh.status !== 'active') return;
    const parts = await MovParticipation.find({ occurrenceId: fresh._id }).sort({ sec: -1 });
    const need = fresh.minMinutes * 60;
    const eligible = parts.filter((p) => p.sec >= need);
    const winners = fresh.maxRewards > 0 ? eligible.slice(0, fresh.maxRewards) : eligible;
    for (const p of winners) {
      const res = await awardPoints({
        key: `mov:${fresh._id}:${p.userId}`,
        userId: p.userId,
        tag: p.tag,
        category: 'mov',
        amount: fresh.points,
        reason: `MOV: ${fresh.name} (${fresh.dateKey})`,
        refId: fresh._id,
      });
      await MovParticipation.updateOne(
        { _id: p._id },
        { $set: { rewarded: true, reward: res.duplicate ? p.reward : fresh.points } },
      );
      if (!res.duplicate) checkMember(client, p.userId, p.tag).catch((e) => console.error('[metas]', e.message));
    }
    fresh.status = 'done';
    fresh.participants = parts.length;
    fresh.rewarded = winners.length;
    await fresh.save();
    const top =
      parts
        .slice(0, 10)
        .map((p, i) => `${i + 1}. <@${p.userId}> - ${fmtDuration(p.sec)}${p.sec >= need ? ` ${E('ok')}` : ''}`)
        .join('\n') || 'Ninguém participou.';
    await sendLog(
      client,
      'movs',
      logEmbed(
        `${E('mov')} MOV finalizado: ${fresh.name}`,
        `**Participantes:** ${parts.length} • **Recompensados:** ${winners.length} (mín. ${fresh.minMinutes} min, ${fmt(fresh.points)} cada)\n\n${top}`,
        COLORS.neutral,
      ),
    );
  });
}

module.exports = { parseDays, formatDays, nextStart, windowFor, tickMovs, DAY_NAMES };
