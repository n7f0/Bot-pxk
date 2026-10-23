'use strict';

const logs = require('../logs');
const { COLORS } = require('../utils/embeds');
const { button } = require('../utils/interaction');

const menuButton = () => button('panel:menu', 'Menu', { emoji: '🏠' });
const backButton = (section, action = 'view', extra = '') =>
  button(`panel:${section}:${action}${extra ? `:${extra}` : ''}`, 'Voltar', { emoji: '↩️' });
const onOff = (v) => (v ? '✅ Ativado' : '❌ Desativado');

/** Extrai o ID de um canal a partir de "#canal", "<#id>" ou do ID puro. */
function parseChannelId(input) {
  const m = String(input || '').match(/\d{17,20}/);
  return m ? m[0] : null;
}

/** Registra uma ação administrativa (banco + canal de logs administrativos do servidor interno). */
function adminLog(interaction, action, title, description) {
  return logs.logEvent({
    category: 'admin',
    action,
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    summary: title,
    title: title,
    description: `👮 **Responsável:** <@${interaction.user.id}>\n${description}`,
    color: COLORS.warning,
  });
}

module.exports = { menuButton, backButton, onOff, parseChannelId, adminLog };
