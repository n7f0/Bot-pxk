'use strict';

const { loadCommands } = require('./commands');

const ALIASES = Object.freeze({
  ranking: 'pxk-ranking',
  pontos: 'pxk-pontos',
});

function loadBridgedCommands() {
  return loadCommands().map((command) => {
    const originalName = command.name;
    const name = ALIASES[originalName] || originalName;

    // CORREÇÃO: SlashCommandBuilder precisa virar JSON puro.
    // O spread anterior ({ ...command.data, name }) copiava propriedades internas
    // do builder, e o REST.put quebrava ao serializar.
    const data = command.data.toJSON();
    data.name = name;

    return { ...command, originalName, name, data };
  });
}

module.exports = { ALIASES, loadBridgedCommands };