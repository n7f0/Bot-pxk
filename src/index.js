'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { initDb, loadCfg, ensureSeason } = require('./models');

console.log('⏳ Iniciando PXK System com MongoDB unificado...');

(async () => {
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não foi definida.');

    await mongoose.connect(process.env.DATABASE_URL, {
      serverSelectionTimeoutMS: 20000,
      autoIndex: true,
    });
    console.log('✅ MongoDB conectado.');

    // Primeiro cria/valida os índices sem iniciar caches ou temporadas.
    await initDb({ deferData: true });
    console.log('✅ Modelos e índices MongoDB inicializados.');

    // Preserva também os dados do banco legado do bot antes de iniciar qualquer serviço.
    const botDbMigration = require('./official/database/migrate-bot-db');
    const botDbResult = await botDbMigration.runBotDbMigration();
    if (!botDbResult.skipped) console.log('✅ Migração bot.db -> MongoDB validada:', botDbResult.report);

    // Migração executa antes do bot/dashboard. O SQLite antigo é copiado e nunca apagado.
    const migration = require('./official/database/migrate-sqlite');
    const migrationResult = await migration.runSqliteMigration();
    if (!migrationResult.skipped) console.log('✅ Migração SQLite -> MongoDB validada:', migrationResult.report);

    const store = require('./official/database/store');
    const counts = await store.loadFeatureStore();
    console.log('✅ Repositório MongoDB carregado:', counts);

    const points = require('./official/points/service');
    const recoveredHistory = await points.recoverPendingHistory();
    if (recoveredHistory) console.log(`✅ ${recoveredHistory} evento(s) de pontos recuperado(s) no histórico.`);

    const settings = require('./official/database/settings');
    await settings.loadCache();
    await loadCfg();
    await ensureSeason();
    console.log('✅ Configurações e temporada do sistema legado carregadas.');

    const seasons = require('./official/seasons/service');
    await seasons.ensureCurrent();
    console.log('✅ Temporada oficial verificada.');

    const bateponto = require('./official/bateponto/service');
    const recoveredRewards = await bateponto.recoverPendingRewards();
    if (recoveredRewards) console.log(`✅ ${recoveredRewards} recompensa(s) de bate-ponto recuperada(s) após reinício.`);

    require('./dashboard');
    console.log('✅ Dashboard web iniciado.');

    require('./bot/index');
    console.log('✅ Inicialização do bot iniciada.');
  } catch (error) {
    console.error('❌ Falha fatal na inicialização do PXK:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
})();
