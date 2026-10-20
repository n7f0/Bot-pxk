require('dotenv').config();
const { registerCommands } = require('./src/register');

const { DISCORD_TOKEN, CLIENT_ID, SERVER_PRINCIPAL_ID, SERVER_INTERNO_ID } = process.env;
const missing = ['DISCORD_TOKEN', 'CLIENT_ID', 'SERVER_PRINCIPAL_ID', 'SERVER_INTERNO_ID'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Faltam variáveis no .env: ${missing.join(', ')}`);
  process.exit(1);
}

registerCommands({ token: DISCORD_TOKEN, clientId: CLIENT_ID, guildIds: [SERVER_PRINCIPAL_ID, SERVER_INTERNO_ID] }).then((r) =>
  process.exit(r.ok ? 0 : 1),
);
