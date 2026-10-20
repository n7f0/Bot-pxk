require('dotenv').config();
const mongoose = require('mongoose');

console.log("⏳ Iniciando PXK System...");

// 1. Inicia o Painel Web
require('./dashboard');

// 2. Conecta ao MongoDB e inicia o Bot
(async () => {
  try {
    await mongoose.connect(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 20000 });
    console.log('✅ MongoDB conectado com sucesso.');
    
    // Inicia a lógica do bot
    require('./bot/index'); 
  } catch (e) {
    console.error('❌ Falha ao conectar no MongoDB:', e.message);
    process.exit(1);
  }
})();