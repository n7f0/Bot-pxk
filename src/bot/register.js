'use strict';

const { REST, Routes } = require('discord.js');
const legacyCommands = require('./commands');
const { loadBridgedCommands } = require('../official/bridge');

function allCommands() {
  const official = loadBridgedCommands().map((command) => command.data);
  const commands = [...legacyCommands, ...official];
  const names = new Set();

  for (const command of commands) {
    if (!command || typeof command.name !== 'string') throw new Error('Comando sem nome válido.');
    if (names.has(command.name)) throw new Error('Comando duplicado no registro: /' + command.name);
    names.add(command.name);
  }
  return commands;
}

async function registerCommands({ token, clientId, guildIds, log = console }) {
  if (!token) throw new Error('DISCORD_TOKEN não definido.');
  if (!clientId) throw new Error('CLIENT_ID não definido.');
  const ids = [...new Set((guildIds || []).filter(Boolean))];
  if (!ids.length) throw new Error('Nenhum servidor configurado para registrar comandos.');

  const rest = new REST({ version: '10' }).setToken(token);
  const body = allCommands();
  let failures = 0;

  for (const guildId of ids) {
    try {
      const result = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
      log.log(result.length + ' comando(s) registrados no servidor ' + guildId + '.');
    } catch (error) {
      failures += 1;
      log.error('Falha ao registrar comandos no servidor ' + guildId + ': ' + error.message);
    }
  }
  return { ok: failures === 0, failures, count: body.length };
}

module.exports = { allCommands, registerCommands };
