'use strict';

const seasons = require('./service');
const actions = require('./actions');
const settings = require('../database/settings');
const { lastWeeklyOccurrence, parseHHMM, isValidTimezone } = require('../utils/time');
const config = require('../config');

let timer = null;

/**
 * Verifica se o reset semanal deve rodar. Também recupera um reset perdido caso o bot
 * tenha ficado offline no horário (compara a última ocorrência com o início da temporada).
 */
async function tick() {
  if (!settings.get('reset_enabled')) return;
  const hm = parseHHMM(settings.get('reset_time'));
  let tz = settings.get('timezone');
  if (!isValidTimezone(tz)) tz = config.defaultTimezone;
  if (!hm) return;

  const now = Date.now();
  const occurrence = lastWeeklyOccurrence(now, settings.get('reset_day'), hm.hh, hm.mm, tz);
  if (!occurrence) return;
  if (occurrence <= settings.get('reset_enabled_at')) return; // ocorrência anterior à ativação
  const season = seasons.requireCurrent();
  if (season.started_at >= occurrence) return; // já houve reset depois dessa ocorrência

  await actions.resetSeason({ actorId: null, reason: 'Reset semanal automático', auto: true });
}

function start(intervalMs = 30_000) {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((e) => console.error('[seasons] reset semanal falhou:', e.message));
  }, intervalMs);
  tick().catch((e) => console.error('[seasons] reset semanal falhou:', e.message));
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
