'use strict';

require('dotenv').config();
const { registerCommands } = require('./register');
const { commandGuildIds } = require('./core');

const { DISCORD_TOKEN, CLIENT_ID } = process.env;
const missing = ['DISCORD_TOKEN', 'CLIENT_ID'].filter((key) => !process.env[key]);
if (missing.length) {
  console.error('Variáveis ausentes no .env: ' + missing.join(', '));
  process.exit(1);
}

registerCommands({
  token: DISCORD_TOKEN,
  clientId: CLIENT_ID,
  guildIds: commandGuildIds(),
})
  .then((result) => process.exit(result.ok ? 0 : 1))
  .catch((error) => {
    console.error('Falha ao registrar comandos:', error.message);
    process.exit(1);
  });
