// src/official/settings.js
//
// ATENÇÃO: Este módulo é um bridge OPCIONAL entre o código que espera
// `settings.get(key)` síncrono (padrão SQLite) e a config do PXK (MongoDB).
//
// Na prática NINGUÉM importa este arquivo — todo o bot oficial usa
// `src/official/database/settings.js` (SQLite, síncrono). Este arquivo
// é mantido para evitar surpresas se algum código futuro resolver importá-lo.
//
// Originalmente era `async function get()`, o que quebraria QUALQUER
// chamador que esperasse valor síncrono. Agora é síncrono e compatível.

'use strict';

const { getCfg, setCfg } = require('../models');

/** Retorna o valor da config do PXK (MongoDB) de forma SÍNCRONA. */
function get(key) {
  const cfg = getCfg();
  return cfg[key] ?? null;
}

/** Atualiza o valor (assíncrono — escreve no MongoDB). */
async function set(key, value) {
  return await setCfg(key, value);
}

/** Mock mantido por compatibilidade. A config é carregada no boot do PXK. */
function loadCache() {
  return true;
}

module.exports = { get, set, loadCache };