const { PointTx, MemberStat, UserMov, MovMonitoria, MovLista, getSeason } = require('./db');
const { startOfDay, withLock } = require('./core');

const FIELD = { time: 'timePoints', mov: 'movPoints', monitor: 'monitorPoints', goal: 'goalPoints', manual: 'manualPoints' };
const COUNT = { mov: 'movs', monitor: 'monitorsDone', goal: 'goalsDone' };
const r2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Reconstrói a projeção de um único membro a partir do histórico persistido.
 * É usado quando uma transação idempotente já existe, mas a atualização dos totais
 * pode ter sido interrompida por uma queda do processo.
 */
async function reconcileMemberStats(userId, seasonId) {
  const [pointRows, movRows, monitorRows, listRows] = await Promise.all([
    PointTx.aggregate([
      { $match: { userId, seasonId } },
      { $group: { _id: '$category', amount: { $sum: '$amount' }, seconds: { $sum: '$seconds' }, count: { $sum: 1 }, tag: { $last: '$tag' } } },
    ]),
    UserMov.aggregate([
      { $match: { userId, seasonId, status: 'finished' } },
      { $group: {
        _id: null,
        mcDone: { $sum: 1 },
        mcSec: { $sum: '$presentSec' },
        mcApproved: { $sum: { $cond: [{ $eq: ['$result', 'approved'] }, 1, 0] } },
        mcRejected: { $sum: { $cond: [{ $eq: ['$result', 'rejected'] }, 1, 0] } },
      } },
    ]),
    MovMonitoria.aggregate([
      { $match: { byId: userId, seasonId, status: { $in: ['approved', 'rejected'] } } },
      { $count: 'monitoredCount' },
    ]),
    MovLista.aggregate([
      { $match: { seasonId } },
      { $unwind: '$participants' },
      { $match: { 'participants.userId': userId, 'participants.scored': true } },
      { $group: { _id: null, mcDone: { $sum: 1 }, mcSec: { $sum: '$participants.presentSec' } } },
    ]),
  ]);

  const stats = {
    crystals: 0, voiceSec: 0, timePoints: 0, movPoints: 0,
    monitorPoints: 0, goalPoints: 0, manualPoints: 0,
    movs: 0, monitorsDone: 0, goalsDone: 0,
    mcDone: 0, mcApproved: 0, mcRejected: 0, mcSec: 0, monitoredCount: 0,
  };
  let latestTag = null;
  for (const row of pointRows) {
    const field = FIELD[row._id];
    if (!field) continue;
    stats[field] += Number(row.amount || 0);
    stats.crystals += Number(row.amount || 0);
    stats.voiceSec += Number(row.seconds || 0);
    if (COUNT[row._id]) stats[COUNT[row._id]] += Number(row.count || 0);
    if (row.tag) latestTag = row.tag;
  }
  if (movRows[0]) {
    stats.mcDone += Number(movRows[0].mcDone || 0);
    stats.mcSec += Math.floor(Number(movRows[0].mcSec || 0));
    stats.mcApproved += Number(movRows[0].mcApproved || 0);
    stats.mcRejected += Number(movRows[0].mcRejected || 0);
  }
  if (monitorRows[0]) stats.monitoredCount = Number(monitorRows[0].monitoredCount || 0);
  if (listRows[0]) {
    stats.mcDone += Number(listRows[0].mcDone || 0);
    stats.mcApproved += Number(listRows[0].mcDone || 0);
    stats.mcSec += Math.floor(Number(listRows[0].mcSec || 0));
  }

  const current = await MemberStat.findOne({ userId, seasonId }).select('tag').lean();
  await MemberStat.findOneAndUpdate(
    { userId, seasonId },
    { $set: { ...stats, tag: latestTag || current?.tag || userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return stats;
}

async function awardPoints({ key, userId, tag, category, amount = 0, seconds = 0, reason = '', by = null, refId = null }) {
  if (!FIELD[category]) throw new Error(\`Categoria de pontos inválida: \${category}\`);
  if (typeof key !== 'string' || !key || !seasonIdSafe(userId)) throw new Error('Identificadores da transação inválidos.');

  const season = await getSeason();
  amount = r2(amount);
  seconds = Math.max(0, Math.round(seconds));

  return withLock('points:' + season._id + ':' + userId, async () => {
    try {
      await PointTx.create({ key, userId, tag, seasonId: season._id, category, amount, seconds, reason, by, refId });
    } catch (error) {
      if (error.code === 11000) {
        await reconcileMemberStats(userId, season._id);
        return { duplicate: true, reconciled: true };
      }
      throw error;
    }

    const inc = { crystals: amount, [FIELD[category]]: amount };
    if (seconds) inc.voiceSec = seconds;
    if (COUNT[category]) inc[COUNT[category]] = 1;
    try {
      await MemberStat.updateOne(
        { userId, seasonId: season._id },
        { $inc: inc, $set: { tag } },
        { upsert: true }
      );
    } catch (error) {
      // O registro do ledger já existe. Recalcula os totais antes de propagar o erro.
      await reconcileMemberStats(userId, season._id);
      console.error('[points] projeção MemberStat reconstruída após falha:', error.message);
    }
    return { ok: true, amount, seasonId: season._id };
  });
}

/** Verifica presença e formato de IDs sem assumir dados vindos do Discord. */
function seasonIdSafe(userId) {
  return typeof userId === 'string' && /^\d{17,20}$/.test(userId);
}

async function timePointsToday(userId) {
  const r = await PointTx.aggregate([
    { $match: { userId, category: 'time', createdAt: { $gte: startOfDay() } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return r[0]?.total || 0;
}

async function getStats(userId, seasonId) {
  const st = await MemberStat.findOne({ userId, seasonId }).lean();
  return (
    st || {
      userId,
      voiceSec: 0,
      timePoints: 0,
      movPoints: 0,
      monitorPoints: 0,
      goalPoints: 0,
      manualPoints: 0,
      crystals: 0,
      movs: 0,
      monitorsDone: 0,
      goalsDone: 0,
    }
  );
}

async function lifetimeStats(userId) {
  const r = await MemberStat.aggregate([
    { $match: { userId } },
    {
      $group: {
        _id: null,
        crystals: { $sum: '$crystals' },
        voiceSec: { $sum: '$voiceSec' },
        movs: { $sum: '$movs' },
        goalsDone: { $sum: '$goalsDone' },
        monitorsDone: { $sum: '$monitorsDone' },
      },
    },
  ]);
  return r[0] || { crystals: 0, voiceSec: 0, movs: 0, goalsDone: 0, monitorsDone: 0 };
}

async function rebuildStats(seasonId) {
  const rows = await PointTx.aggregate([
    { $match: { seasonId } },
    {
      $group: {
        _id: { u: '$userId', c: '$category' },
        amount: { $sum: '$amount' },
        seconds: { $sum: '$seconds' },
        n: { $sum: 1 },
        tag: { $last: '$tag' },
      },
    },
  ]);
  const users = new Map();
  for (const r of rows) {
    const u = users.get(r._id.u) || {
      tag: r.tag,
      set: {
        crystals: 0,
        voiceSec: 0,
        timePoints: 0,
        movPoints: 0,
        monitorPoints: 0,
        goalPoints: 0,
        manualPoints: 0,
        movs: 0,
        monitorsDone: 0,
        goalsDone: 0,
      },
    };
    const c = r._id.c;
    u.set[FIELD[c]] += r.amount;
    u.set.crystals += r.amount;
    u.set.voiceSec += r.seconds;
    if (COUNT[c]) u.set[COUNT[c]] += r.n;
    if (r.tag) u.tag = r.tag;
    users.set(r._id.u, u);
  }
  const zero = {
    crystals: 0,
    voiceSec: 0,
    timePoints: 0,
    movPoints: 0,
    monitorPoints: 0,
    goalPoints: 0,
    manualPoints: 0,
    movs: 0,
    monitorsDone: 0,
    goalsDone: 0,
    mcDone: 0,
    mcApproved: 0,
    mcRejected: 0,
    mcSec: 0,
    monitoredCount: 0,
  };
  await MemberStat.updateMany({ seasonId }, { $set: zero });
  if (users.size) {
    await MemberStat.bulkWrite(
      [...users.entries()].map(([userId, u]) => ({
        updateOne: { filter: { userId, seasonId }, update: { $set: { ...u.set, tag: u.tag } }, upsert: true },
      })),
    );
  }
  const [movRows, monRows] = await Promise.all([
    UserMov.aggregate([
      { $match: { seasonId, status: 'finished' } },
      {
        $group: {
          _id: '$userId',
          mcDone: { $sum: 1 },
          mcSec: { $sum: '$presentSec' },
          mcApproved: { $sum: { $cond: [{ $eq: ['$result', 'approved'] }, 1, 0] } },
          mcRejected: { $sum: { $cond: [{ $eq: ['$result', 'rejected'] }, 1, 0] } },
        },
      },
    ]),
    MovMonitoria.aggregate([
      { $match: { seasonId, status: { $in: ['approved', 'rejected'] } } },
      { $group: { _id: '$byId', monitoredCount: { $sum: 1 }, tag: { $last: '$byTag' } } },
    ]),
  ]);
  const ops = [
    ...movRows.map((r) => ({
      updateOne: {
        filter: { userId: r._id, seasonId },
        update: { $set: { mcDone: r.mcDone, mcSec: Math.floor(r.mcSec), mcApproved: r.mcApproved, mcRejected: r.mcRejected } },
        upsert: true,
      },
    })),
    ...monRows.map((r) => ({
      updateOne: { filter: { userId: r._id, seasonId }, update: { $set: { monitoredCount: r.monitoredCount } }, upsert: true },
    })),
  ];
  if (ops.length) await MemberStat.bulkWrite(ops);
  const listaRows = await MovLista.aggregate([
    { $match: { seasonId } },
    { $unwind: '$participants' },
    { $match: { 'participants.scored': true } },
    { $group: { _id: '$participants.userId', n: { $sum: 1 }, sec: { $sum: '$participants.presentSec' } } },
  ]);
  if (listaRows.length) {
    await MemberStat.bulkWrite(
      listaRows.map((r) => ({
        updateOne: {
          filter: { userId: r._id, seasonId },
          update: { $inc: { mcDone: r.n, mcApproved: r.n, mcSec: Math.floor(r.sec) } },
          upsert: true,
        },
      })),
    );
  }
  return users.size;
}

module.exports = { awardPoints, timePointsToday, getStats, lifetimeStats, rebuildStats, r2 };
