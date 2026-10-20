require('dotenv').config();
const { initDB } = require('./database');

console.log("⏳ Iniciando PXKK System...");

// 1. Inicia o banco de dados
initDB();

// 2. Inicia o Painel Web
require('./dashboard');

// 3. Inicia o Bot do Discord
require('./bot');