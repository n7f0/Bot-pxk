require('dotenv').config();
const { initDB } = require('./database');
const { startBot } = require('./bot/client');
const { startWebServer } = require('./web/server');

console.log("⏳ Iniciando PXKK System...");
initDB();
startWebServer();
startBot();