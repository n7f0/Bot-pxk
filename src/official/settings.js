// src/official/settings.js
'use strict';
const { getCfg, setCfg } = require('../models');

function get(key) {
  const cfg = getCfg();
  return cfg[key] ?? null;
}
async function set(key, value) {
  return await setCfg(key, value);
}
function loadCache() { return true; }

module.exports = { get, set, loadCache };