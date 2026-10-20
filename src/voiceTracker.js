const { isKnownGuild } = require('./core');
const { syncMember, tickSessions } = require('./movcall');
const { tickMovs } = require('./movs');
const { tickMonitor } = require('./monitoria');
const { checkCollective } = require('./metas');
const { rankingTick } = require('./ranking');
const { tickSeasons } = require('./seasons');
const { tickMovCall, onVoiceMovCall } = require('./iniciarmov');
const { tickLista, onVoiceLista } = require('./movlista');

async function onVoiceUpdate(client, oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  if (!isKnownGuild(newState.guild.id)) return;
  await syncMember(client, member.id, member.user.username);
  await onVoiceMovCall(client, member.id); // MOV Call e monitorias do membro
  await onVoiceLista(client, member.id);
}

function startTickers(client) {
  const running = new Set();
  const every = (name, ms, fn) =>
    setInterval(async () => {
      if (running.has(name)) return;
      running.add(name);
      try {
        await fn(client);
      } catch (e) {
        console.error(`[tick:${name}]`, e);
      } finally {
        running.delete(name);
      }
    }, ms);
  every('sessoes', 60_000, tickSessions);
  every('movs', 30_000, tickMovs);
  every('monitoria', 60_000, tickMonitor);
  every('movcall', 30_000, tickMovCall);
  every('lista', 30_000, tickLista);
  every('metas', 120_000, checkCollective);
  every('ranking', 60_000, rankingTick);
  every('temporada', 60_000, tickSeasons);
}

module.exports = { onVoiceUpdate, startTickers };
