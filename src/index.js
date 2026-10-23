// src/index.js
require('dotenv').config();
const mongoose = require('mongoose');

console.log("⏳ Iniciando PXK System Unificado...");

(async () => {
  try {
    // 1. Conecta ao MongoDB PRIMEIRO (O banco único de tudo)
    await mongoose.connect(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 20000 });
    console.log('✅ MongoDB conectado com sucesso (Banco Único).');

    // 2. Inicia o Painel Web (Socket.IO + Express)
    require('./dashboard');
    console.log('✅ Painel Web (Dashboard) iniciado.');

    // 3. Inicia a lógica do bot do Discord
    require('./bot/index'); 
    console.log('✅ Bot do Discord inicializado.');
    
  } catch (e) {
    console.error('❌ Falha ao conectar no MongoDB:', e.message);
    process.exit(1);
  }
})();
