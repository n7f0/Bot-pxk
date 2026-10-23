'use strict';

const { loadCommands } = require('./commands');

// Names used by the original bot that collide with existing PXK slash commands.
const ALIASES = Object.freeze({
  ranking: 'pxk-ranking',
  pontos: 'pxk-pontos',
});

function loadBridgedCommands() {
  return loadCommands().map((command) => {
    const originalName = command.name;
    const name = ALIASES[originalName] || originalName;
    const data = { ...command.data, name };
    return { ...command, originalName, name, data };
  });
}

module.exports = { ALIASES, loadBridgedCommands };
