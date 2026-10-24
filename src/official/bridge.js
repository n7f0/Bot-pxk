// src/official/bridge.js
'use strict';
const { loadCommands } = require('./commands');

const ALIASES = Object.freeze({ ranking: 'pxk-ranking', pontos: 'pxk-pontos' });

function loadBridgedCommands() {
  return loadCommands().map((command) => {
    const originalName = command.name;
    const name = ALIASES[originalName] || originalName;
    const data = command.data.toJSON(); // CORRIGIDO
    data.name = name;
    return { ...command, originalName, name, data };
  });
}
module.exports = { ALIASES, loadBridgedCommands };