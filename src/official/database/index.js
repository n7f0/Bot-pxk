'use strict';
// Compatibilidade de import: este módulo agora expõe o repositório MongoDB,
// não abre mais um segundo banco SQLite para operações normais.
module.exports = require('./store');
