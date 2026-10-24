'use strict';

const { Events, REST, Routes } = require('discord.js');
const config = require('../config');
const seasons = require('../seasons/service');
const seasonScheduler = require('../seasons/scheduler');
const bpScheduler = require('../bateponto/scheduler');
const tracker = require('../bateponto/tracker');
const backup = require('../database/backup');
const publisher = require('../ranking/publisher');
const { loadBridgedCommands } = require('../bridge');
const ctx = require('../utils/context');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`🤖 [bot oficial] online como ${client.user.tag}`);

    // Defensivo: se por algum motivo ctx.client não foi setado no boot,
    // garante que está setado agora (log/publisher/roles dependem disso).
    if (!ctx.client) {
      ctx.client = client;
      console.log('🔗 ctx.client definido pelo ready.js');
    }

    // 1) Registro dos slash commands do bot oficial
    try {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
      const body = loadBridgedCommands().map((c) => c.data);
      for (const gid of [config.externalGuildId, config.internalGuildId]) {
        try {
          const res = await rest.put(Routes.applicationGuildCommands(config.clientId, gid), { body });
          console.log(`[bot oficial] ${res.length} comando(s) registrados no servidor ${gid}`);
        } catch (e) {
          console.error(`[bot oficial] falha ao registrar no servidor ${gid}: ${e.message}`);
        }
      }
    } catch (e) {
      console.error('[bot oficial] falha ao registrar comandos:', e.message);
    }

    // 2) Check de presença nos servidores
    for (const [label, id] of [
      ['externo', config.externalGuildId],
      ['interno', config.internalGuildId],
    ]) {
      const g = client.guilds.cache.get(id);
      if (g) console.log(`[bot oficial] servidor ${label}: ${g.name} (${id})`);
      else console.warn(`[bot oficial] ⚠️ NÃO está no servidor ${label} (${id}) — convide o bot.`);
    }

    // 3) Temporada atual (SQLite)
    try {
      const season = seasons.requireCurrent();
      console.log(`[bot oficial] temporada atual: #${String(season.number).padStart(2, '0')}`);
    } catch (e) {
      console.error('[bot oficial] erro ao carregar temporada:', e.message);
    }

    // 4) Recuperação de bate-pontos ativos (recontabiliza mensagens do offline)
    try {
      await tracker.recoverActive(client);
    } catch (e) {
      console.error('[bot oficial] erro ao recuperar bate-pontos:', e.message);
    }

    // 5) Schedulers (cada um em try/catch individual)
    try { bpScheduler.start(client); } catch (e) { console.error('[bot oficial] bpScheduler:', e.message); }
    try { seasonScheduler.start(); } catch (e) { console.error('[bot oficial] seasonScheduler:', e.message); }

    // 6) Backup (método pode não existir em versões antigas)
    try {
      if (typeof backup.startAutoBackup === 'function') {
        backup.startAutoBackup();
      } else {
        console.warn('[bot oficial] backup.startAutoBackup não disponível — pulando.');
      }
    } catch (e) {
      console.error('[bot oficial] backup:', e.message);
    }

    // 7) Ranking publisher
    try { publisher.start(); } catch (e) { console.error('[bot oficial] publisher:', e.message); }
  },
};