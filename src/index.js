require('dotenv').config();
const mongoose = require('mongoose');

console.log("⏳ Iniciando PXK System...");

// 1. Inicia o Painel Web
require('./dashboard');

// 2. Inicia o Bot
(async () => {
  try {
    await mongoose.connect(process.env.DATABASE_URL || 'mongodb://pxk-mongodb:27017/pxk', { serverSelectionTimeoutMS: 20000 });
    console.log('✅ MongoDB conectado com sucesso.');
    require('./bot/index'); 
  } catch (e) {
    console.error('❌ Falha ao conectar no MongoDB:', e.message);
  }
})();