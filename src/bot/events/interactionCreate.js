const { guildKey, deny } = require('../core');
const { E } = require('../emojis');
const { adminCommand, handleAdmin } = require('../admin');
const { rankingCommand, handleRankingNav } = require('../ranking');
const { monitorCommand, handleMonitor } = require('../monitoria');
const { metasCommand } = require('../metas');
const { iniciarMovCommand, movHistoricoCommand, handleMovCall } = require('../iniciarmov');
const { handleLista, pararListaCommand } = require('../movlista');
const { atividadeCommand, movcallCommand, movCommand, pontosCommand, relatorioCommand } = require('../comandos');

const COMMANDS = {
  admin: adminCommand,
  ranking: rankingCommand,
  atividade: atividadeCommand,
  movcall: movcallCommand,
  metas: metasCommand,
  monitoria: monitorCommand,
  pontos: pontosCommand,
  relatorio: relatorioCommand,
  mov: movCommand,
  iniciarmov: iniciarMovCommand,
  movhistorico: movHistoricoCommand,
  pararlista: pararListaCommand,
};

module.exports = (client) => {
  client.on('interactionCreate', async (i) => {
    try {
      if (!guildKey(i.guildId)) {
        if (i.isRepliable()) await i.reply(deny(`${E('bad')} Este servidor não está autorizado.`));
        return;
      }
      if (i.isChatInputCommand()) return await COMMANDS[i.commandName]?.(i);
      const id = i.customId;
      if (!id) return;
      if (id.startsWith('adm:')) return await handleAdmin(i);
      if (id.startsWith('mon:')) return await handleMonitor(i);
      if (id.startsWith('mc:')) return await handleMovCall(i);
      if (id.startsWith('ml:')) return await handleLista(i);
      if (id.startsWith('rk:')) return await handleRankingNav(i);
    } catch (err) {
      console.error('[interaction]', err);
      const detail = `${err?.code ? `${err.code} • ` : ''}${String(err?.rawError?.message || err?.message || err).slice(0, 120)}`;
      const msg = deny(`${E('bad')} Ocorreu um erro. Tente novamente.\n-# Detalhe técnico: ${detail}`);
      try {
        if (i.replied || i.deferred) await i.followUp(msg);
        else if (i.isRepliable()) await i.reply(msg);
      } catch {}
    }
  });
};