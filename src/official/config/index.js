'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const rootDir = path.resolve(__dirname, '../../..');

const list = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const config = {
  rootDir,
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  externalGuildId: process.env.EXTERNAL_GUILD_ID || process.env.SERVER_PRINCIPAL_ID,
  internalGuildId: process.env.INTERNAL_GUILD_ID || process.env.SERVER_INTERNO_ID,
  ownerIds: list(process.env.OWNER_IDS),
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'America/Sao_Paulo',
  dbPath: path.resolve(rootDir, process.env.DB_PATH || 'data/pxk-features.sqlite'),
  limits: { maxPoints: 1_000_000 },
};

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Valida as variáveis de ambiente. Lança erro com mensagem clara se algo estiver errado.
 * @param {{needToken?: boolean}} opts
 */
function validate({ needToken = true } = {}) {
  const missing = [];
  if (needToken && !config.token) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('CLIENT_ID');
  if (!config.externalGuildId) missing.push('EXTERNAL_GUILD_ID');
  if (!config.internalGuildId) missing.push('INTERNAL_GUILD_ID');
  if (missing.length) {
    throw new Error(
      `Variáveis ausentes no .env: ${missing.join(', ')}. Copie .env.example para .env e preencha.`
    );
  }
  for (const [name, value] of [
    ['CLIENT_ID', config.clientId],
    ['EXTERNAL_GUILD_ID', config.externalGuildId],
    ['INTERNAL_GUILD_ID', config.internalGuildId],
  ]) {
    if (!SNOWFLAKE.test(value)) throw new Error(`${name} inválido (deve ser um ID numérico do Discord).`);
  }
  if (config.externalGuildId === config.internalGuildId) {
    throw new Error('EXTERNAL_GUILD_ID e INTERNAL_GUILD_ID precisam ser servidores diferentes.');
  }
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: config.defaultTimezone });
  } catch {
    throw new Error(`DEFAULT_TIMEZONE inválido: ${config.defaultTimezone}`);
  }
}

config.validate = validate;
config.isKnownGuild = (id) => id === config.externalGuildId || id === config.internalGuildId;
config.isInternal = (id) => id === config.internalGuildId;
config.isExternal = (id) => id === config.externalGuildId;

module.exports = config;
