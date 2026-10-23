'use strict';

const fs = require('fs');
const path = require('path');

/** Carrega automaticamente todos os arquivos de comando desta pasta. */
function loadCommands() {
  const commands = [];
  const names = new Set();
  for (const file of fs.readdirSync(__dirname)) {
    if (file === 'index.js' || !file.endsWith('.js')) continue;
    const mod = require(path.join(__dirname, file));
    if (!mod.data || typeof mod.execute !== 'function') {
      console.warn(`[commands] ${file} ignorado (precisa exportar data e execute).`);
      continue;
    }
    const name = mod.data.name;
    if (names.has(name)) throw new Error(`Comando duplicado: /${name} (${file})`);
    names.add(name);
    commands.push({ name, scope: mod.scope || 'both', data: mod.data, execute: mod.execute, file });
  }
  return commands;
}

module.exports = { loadCommands };
