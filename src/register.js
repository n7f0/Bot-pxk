const { REST, Routes } = require('discord.js');
const commands = require('./commands');

async function registerCommands({ token, clientId, guildIds, log = console }) {
  const rest = new REST({ version: '10' }).setToken(token);
  let falhas = 0;
  for (const gid of guildIds) {
    try {
      const res = await rest.put(Routes.applicationGuildCommands(clientId, gid), { body: commands });
      log.log(`${res.length} comando(s) registrado(s) no servidor ${gid}: ${res.map((c) => '/' + c.name).join(', ')}`);
    } catch (e) {
      falhas++;
      log.error(
        `Não consegui registrar comandos no servidor ${gid}: ${e.message} (o bot foi convidado com o escopo applications.commands?)`,
      );
    }
  }
  return { ok: falhas === 0, falhas };
}

module.exports = { registerCommands };
