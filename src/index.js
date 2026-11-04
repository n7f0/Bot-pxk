'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { initDb } = require('./models');

console.log('⏳ Iniciando PXK System...');

(async () => {
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não foi definida.');

    await mongoose.connect(process.env.DATABASE_URL, {
      serverSelectionTimeoutMS: 20000,
      autoIndex: true,
    });
    console.log('✅ MongoDB conectado.');

    await initDb();
    console.log('✅ Modelos, índices e configurações do MongoDB inicializados.');

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
