'use strict';

const { Events } = require('discord.js');
const config = require('../config');
const seasons = require('../seasons/service');
const seasonScheduler = require('../seasons/scheduler');
const bpScheduler = require('../bateponto/scheduler');
const tracker = require('../bateponto/tracker');
const backup = require('../database/backup');
const publisher = require('../ranking/publisher');
const ctx = require('../utils/context');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log('🤖 [bot oficial] online como ' + client.user.tag);

    if (!ctx.client) {
      ctx.client = client;
      console.log('🔗 ctx.client definido pelo ready.js');
    }

    for (const [label, id] of [
      ['externo', config.externalGuildId],
      ['interno', config.internalGuildId],
    ]) {
      if (!id) {
        console.warn('[bot oficial] ID do servidor ' + label + ' não configurado.');
        continue;
      }
      const guild = client.guilds.cache.get(id);
      if (guild) console.log('[bot oficial] servidor ' + label + ': ' + guild.name + ' (' + id + ')');
      else console.warn('[bot oficial] bot não está no servidor ' + label + ' (' + id + ').');
    }

    try {
      const season = seasons.requireCurrent();
      console.log('[bot oficial] temporada atual: #' + String(season.number).padStart(2, '0'));
    } catch (error) {
      console.error('[bot oficial] erro ao carregar temporada:', error.message);
    }

    try {
      await tracker.recoverActive(client);
    } catch (error) {
      console.error('[bot oficial] erro ao recuperar bate-pontos:', error.message);
    }

    try { bpScheduler.start(client); } catch (error) {
      console.error('[bot oficial] bpScheduler:', error.message);
    }
    try { seasonScheduler.start(); } catch (error) {
      console.error('[bot oficial] seasonScheduler:', error.message);
    }
    try {
      if (typeof backup.startAutoBackup === 'function') backup.startAutoBackup();
    } catch (error) {
      console.error('[bot oficial] backup:', error.message);
    }
    try { publisher.start(); } catch (error) {
      console.error('[bot oficial] publisher:', error.message);
    }
  },
};
