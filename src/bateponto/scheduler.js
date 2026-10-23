'use strict';

const actions = require('./actions');
const live = require('./live');

let sweepTimer = null;
let liveTimer = null;

function start(client) {
  if (sweepTimer) return;
  const run = () => actions.sweep(client).catch((e) => console.error('[bateponto] sweep:', e.message));
  sweepTimer = setInterval(run, 15_000);
  liveTimer = setInterval(() => live.tick().catch(() => {}), 30_000);
  run(); // finaliza imediatamente o que venceu enquanto o bot estava offline
}

function stop() {
  clearInterval(sweepTimer);
  clearInterval(liveTimer);
  sweepTimer = liveTimer = null;
}

module.exports = { start, stop };
