// src/bot/index.js
const { Client, GatewayIntentBits, ActivityType, Collection, Events } = require('discord.js');
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const { isKnownGuild } = require('./core');
const { loadCfg } = require('../models');

// 1) Validação de config
try {
  require('../official/config').validate({ needToken: false });
  console.log('✅ Config oficial validada.');
} catch (e) {
  console.error('❌ Config oficial inválida:', e.message);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
});

// 2) Coleção e comandos do bot oficial
client.commands = new Collection();
try {
  const { loadBridgedCommands } = require('../official/bridge');
  const bridged = loadBridgedCommands();
  for (const cmd of bridged) client.commands.set(cmd.name, cmd);
  console.log(`✅ ${client.commands.size} comando(s) do bot oficial carregado(s).`);
} catch (e) {
  console.warn('⚠️ Não consegui carregar comandos oficiais:', e.message);
}

// 3) ctx.client
require('../official/utils/context').client = client;

// 4) Eventos PXK
require('./events/ready')(client);
require('./events/voiceStateUpdate')(client);
require('./events/interactionCreate')(client);
require('./events/messageCreate')(client);
require('./events/guildLogs')(client); // <--- NOVO AQUI

// 5) Eventos do bot oficial
function loadOfficialEvents(client) {
  const dir = path.join(__dirname, '..', 'official', 'events');
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    try {
      const ev = require(path.join(dir, file));
      if (!ev.name || typeof ev.execute !== 'function') continue;
      const handler = (...args) => Promise.resolve(ev.execute(...args)).catch((err) => console.error(`[official:${file}]`, err));
      if (ev.once) client.once(ev.name, handler);
      else client.on(ev.name, handler);
    } catch (err) { }
  }
}
loadOfficialEvents(client);

client.on('guildCreate', (guild) => {
  if (!isKnownGuild(guild.id)) guild.leave().catch(() => {});
});

client.on('error', (e) => console.error('[client]', e));
process.on('unhandledRejection', (err) => console.error('Rejeição não tratada:', err));

let presenceInterval = null;
function updateBotPresence(cfg) {
  if (!client.user) return;
  if (presenceInterval) clearInterval(presenceInterval);
  if (cfg.bot_status) client.user.setStatus(cfg.bot_status);
  const presets = cfg.presences || [];
  const valid = presets.filter(p => p && p.text);
  if (!valid.length) return;
  let idx = 0;
  const apply = () => {
    const p = valid[idx];
    let type = ActivityType.Playing;
    if (p.type === 'STREAMING') type = ActivityType.Streaming;
    if (p.type === 'LISTENING') type = ActivityType.Listening;
    if (p.type === 'WATCHING') type = ActivityType.Watching;
    const opt = { type, name: p.text };
    if (type === ActivityType.Streaming) opt.url = p.url || 'https://twitch.tv/discord';
    client.user.setActivity(opt);
  };
  apply();
  if (cfg.presence_rotation && valid.length > 1) {
    presenceInterval = setInterval(() => { idx = (idx + 1) % valid.length; apply(); }, (cfg.presence_interval || 30) * 1000);
  }
}

client.once('ready', async () => {
  try { updateBotPresence(await loadCfg() || {}); } catch (e) {}
});

const socket = io(process.env.DASHBOARD_URL || 'http://localhost:8080');
socket.on('config_updated', async (newCfg) => {
  await loadCfg();
  updateBotPresence(newCfg);
});

client.login(process.env.DISCORD_TOKEN).catch(e => console.error('Erro login:', e));
module.exports = client;