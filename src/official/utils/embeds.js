'use strict';

const { EmbedBuilder } = require('discord.js');
const theme = require('../theme');
const { SEP } = require('./format');

/** Cores semânticas: só são usadas se "Cores de status" estiver ligado no /painel → Visual. */
const COLORS = {
  brand: 0x5b8def,
  success: 0x2ecc71,
  danger: 0xe74c3c,
  warning: 0xf39c12,
  gold: 0xf1c40f,
  silver: 0xbdc3c7,
  bronze: 0xcd7f32,
  neutral: 0x2f3136,
};

const FOOTER = 'Pontuação • Ranking • Bate-Ponto';

function resolveFooter(footer) {
  if (footer === null) return null;
  if (footer !== undefined && footer !== '') return footer;
  const t = theme.footer();
  if (t === null) return null; // ocultado no tema
  return t || FOOTER;
}

/**
 * Embed padrão do bot. A faixa lateral segue o tema (neutra por padrão).
 * - color: cor "semântica" (só vale com Cores de status ligado)
 * - forceColor: cor escolhida explicitamente pelo admin (sempre vale)
 * - footer: undefined = rodapé do tema/padrão • null = sem rodapé • string = texto
 * - timestamp: undefined = configuração do tema
 * A linha fina (SEP) nas descrições é trocada pela linha configurada no tema.
 */
function baseEmbed({ title, description, color, forceColor, footer, timestamp } = {}) {
  const finalColor = forceColor ?? (theme.statusColors() && color !== undefined ? color : theme.color());
  const e = new EmbedBuilder().setColor(finalColor);
  const footerText = resolveFooter(footer);
  if (footerText) e.setFooter({ text: String(footerText).slice(0, 2048) });
  if (title) e.setTitle(String(title).slice(0, 256));
  if (description) e.setDescription(String(description).split(SEP).join(theme.sep()).slice(0, 4096));
  if (timestamp === undefined ? theme.timestamp() : timestamp) e.setTimestamp();
  return e;
}

const errorEmbed = (description, title = 'Erro') => baseEmbed({ title, description, color: COLORS.danger });
const successEmbed = (description, title = 'Concluído') => baseEmbed({ title, description, color: COLORS.success });
const warnEmbed = (description, title = 'Atenção') => baseEmbed({ title, description, color: COLORS.warning });

module.exports = { COLORS, FOOTER, baseEmbed, errorEmbed, successEmbed, warnEmbed };
