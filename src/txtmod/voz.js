// Mantém o bot conectado (mudo/ensurdecido) em uma call de cada servidor — o canal é escolhido em /admin → Call do bot.
const { ChannelType } = require('discord.js');
let voiceApiCache = null;
const voiceApi = () => (voiceApiCache ||= require('@discordjs/voice')); // carregamento tardio: os módulos sem voz continuam iniciando se o codec nativo estiver indisponível.
const { getCfg } = require('./db');
const { MAIN_ID, INTERNAL_ID } = require('./core');

const GUILDS = { main: MAIN_ID, internal: INTERNAL_ID };
const retry = new Map(); // guildId → timeout de reconexão

function connect(guild, channel) {
  const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState } = voiceApi();
  const current = getVoiceConnection(guild.id);
  if (current && current.joinConfig.channelId === channel.id && current.state.status !== VoiceConnectionStatus.Destroyed) return current;
  if (current) current.destroy();

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true,
  });

  // Se cair (kick, troca de região, queda de rede): tenta se reconectar; se não der, entra de novo
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      clearTimeout(retry.get(guild.id));
      retry.set(guild.id, setTimeout(() => ensure(guild.client, guild.id).catch(() => {}), 5_000));
    }
  });
  connection.on('error', (e) => console.error('[voz]', e.message));
  return connection;
}

// Garante que o bot está na call configurada de um servidor (ou fora dela, se nenhuma foi definida)
async function ensure(client, guildId) {
  const gk = guildId === MAIN_ID ? 'main' : guildId === INTERNAL_ID ? 'internal' : null;
  if (!gk) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const cfg = await getCfg();
  const channelId = cfg.voice?.[gk];
  if (!channelId) {
    try { voiceApi().getVoiceConnection(guildId)?.destroy(); } catch (e) { console.warn('[voz] módulo de voz indisponível:', e.message); }
    return;
  }
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) return;
  const me = guild.members.me;
  if (!channel.permissionsFor(me)?.has(['ViewChannel', 'Connect'])) {
    console.warn(`[voz] Sem permissão de ver/conectar em #${channel.name} (${guild.name})`);
    return;
  }
  connect(guild, channel);
}

const ensureAll = (client) => Promise.all(Object.values(GUILDS).map((id) => ensure(client, id).catch((e) => console.error('[voz]', e.message))));

function start(client) {
  ensureAll(client);
  setInterval(() => ensureAll(client), 60_000); // vigia: volta para a call se o bot for removido/desconectado

  // Se o bot for desconectado da call manualmente, entra de novo em alguns segundos
  client.on('voiceStateUpdate', (oldState, newState) => {
    if (newState.id !== client.user.id) return;
    if (oldState.channelId && !newState.channelId) {
      clearTimeout(retry.get(newState.guild.id));
      retry.set(newState.guild.id, setTimeout(() => ensure(client, newState.guild.id).catch(() => {}), 3_000));
    }
  });
}

module.exports = { start, ensure };
