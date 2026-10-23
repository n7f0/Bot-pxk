'use strict';

const service = require('./service');
const ui = require('./ui');
const logs = require('../logs');
const roles = require('../roles/service');
const publisher = require('../ranking/publisher');

/**
 * Altera pontos + registra log no servidor interno + sincroniza cargos por pontuação.
 * type: 'adicionar' | 'remover' | 'definir' | 'bate-ponto' | 'sistema'
 */
async function changePoints({ userId, actorId, mode, amount, reason, type, guildId }) {
  const entry = service.applyChange({ userId, actorId, mode, amount, reason, type });
  await afterChange(entry, guildId);
  return entry;
}

/** Efeitos colaterais de uma alteração já gravada (usado também pelo bate-ponto). */
async function afterChange(entry, guildId) {
  await logs.logEvent({
    category: 'points',
    action: entry.type,
    guildId,
    actorId: entry.actorId,
    targetId: entry.userId,
    summary: `${entry.before} → ${entry.after} (${entry.delta >= 0 ? '+' : ''}${entry.delta})`,
    details: entry,
    embed: ui.buildChangeEmbed(entry, { footer: logs.LOG_FOOTER }),
    mirror: ['admin'],
  });
  publisher.scheduleRefresh();
  await roles.syncMember(entry.userId, entry.after).catch((e) => console.error('[roles] sync:', e.message));
}

module.exports = { changePoints, afterChange };
