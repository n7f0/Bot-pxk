'use strict';

const { Events } = require('discord.js');
const config = require('../config');
const seasons = require('../seasons/service');
const seasonScheduler = require('../seasons/scheduler');
const bpScheduler = require('../bateponto/scheduler');
const tracker = require('../bateponto/tracker');
const backup = require('../database/backup');
const publisher = require('../ranking/publisher');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`[bot] online como ${client.user.tag}`);

    for (const [label, id] of [['externo', config.externalGuildId], ['interno', config.internalGuildId]]) {
      const g = client.guilds.cache.get(id);
      if (g) console.log(`[bot] servidor ${label}: ${g.name} (${id})`);
      else console.warn(`[bot] ⚠️ o bot NÃO está no servidor ${label} (${id}). Convide-o.`);
    }

    const season = seasons.requireCurrent();
    console.log(`[bot] temporada atual: #${String(season.number).padStart(2, '0')}`);

    // Recupera os bate-pontos ativos do banco (e recontabiliza mensagens enviadas durante a queda).
    await tracker.recoverActive(client);
    bpScheduler.start(client);
    seasonScheduler.start();
    backup.startAutoBackup();
    publisher.start();
  },
};
