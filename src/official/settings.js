// src/official/settings.js
const { getCfg, setCfg } = require('../models');

// Tradutor: pega os dados do MongoDB e entrega para o painel do official
async function get(key) {
    const cfg = await getCfg();
    return cfg[key];
}

async function set(key, value) {
    return await setCfg(key, value);
}

async function loadCache() {
    // Apenas um mock para não quebrar se o código antigo chamar
    return true;
}

module.exports = { get, set, loadCache };
