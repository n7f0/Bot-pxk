'use strict';

const fs = require('fs');
const { AttachmentBuilder } = require('discord.js');
const db = require('../database');
const settings = require('../database/settings');
const backup = require('../database/backup');
const config = require('../config');
const { requirePermission } = require('../permissions');
const { baseEmbed, errorEmbed, COLORS } = require('../utils/embeds');
const { SEP, num } = require('../utils/format');
const { isValidTimezone } = require('../utils/time');
const { row, button, buildModal, updateOrReply, EPHEMERAL } = require('../utils/interaction');
const { menuButton, adminLog } = require('./util');

function count(table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

function render(client) {
  const guildLine = (id, label) => {
    const g = client.guilds.cache.get(id);
    return g ? `${label}: **${g.name}** (\`${id}\`) • ${num(g.memberCount)} membros` : `${label}: ⚠️ bot **não está** no servidor \`${id}\``;
  };
  let size = 0;
  try {
    size = fs.statSync(config.dbPath).size;
  } catch {
    /* ignora */
  }
  const up = Math.floor(process.uptime());
  const embed = baseEmbed({
    title: 'Sistema',
    color: COLORS.brand,
    description: [
      '**🌐 Servidores**',
      guildLine(config.externalGuildId, '🌍 Externo'),
      guildLine(config.internalGuildId, '🔒 Interno'),
      SEP,
      '**🗄️ Banco de dados (SQLite)**',
      `📦 Tamanho: **${(size / 1024).toFixed(1)} KB**`,
      `👤 Usuários: **${num(count('users'))}** • 🏅 Temporadas: **${num(count('seasons'))}**`,
      `📜 Histórico de pontos: **${num(count('point_history'))}** • 📝 Logs: **${num(count('logs'))}**`,
      `⏱️ Bate-pontos: **${num(count('bateponto_sessions'))}** • 💬 Mensagens contadas: **${num(count('bateponto_messages'))}**`,
      SEP,
      '**🔧 Configurações**',
      `🌎 Fuso horário: **${settings.get('timezone')}**`,
      `🕒 Online há: **${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}min** • Node ${process.version}`,
    ].join('\n'),
  });
  return {
    embeds: [embed],
    components: [
      row(button('panel:system:cfg', 'Configurações', { emoji: '🔧' }), button('panel:system:backup', 'Backup do banco', { emoji: '💾' }), button('panel:system:view', 'Atualizar', { emoji: '🔄' }), menuButton()),
    ],
  };
}

async function handle(interaction, action) {
  if (!(await requirePermission(interaction, 'change_settings'))) return;

  if (action === 'view') return interaction.update(render(interaction.client));

  if (action === 'cfg') {
    return interaction.showModal(
      buildModal('panel:system:cfgsub', 'Configurações gerais', [{ id: 'tz', label: 'Fuso horário (IANA)', value: settings.get('timezone'), placeholder: 'America/Sao_Paulo', max: 60 }])
    );
  }

  if (action === 'cfgsub') {
    const tz = interaction.fields.getTextInputValue('tz').trim();
    if (!isValidTimezone(tz)) return updateOrReply(interaction, { embeds: [errorEmbed('Fuso horário inválido. Exemplo: `America/Sao_Paulo`.')], components: render(interaction.client).components });
    const old = settings.get('timezone');
    settings.set('timezone', tz);
    await adminLog(interaction, 'config_system', 'Configuração geral alterada', `🌎 Fuso horário: **${old}** → **${tz}**`);
    return updateOrReply(interaction, render(interaction.client));
  }

  if (action === 'backup') {
    await interaction.deferReply({ flags: EPHEMERAL });
    try {
      const file = await backup.runBackup();
      const size = fs.statSync(file).size;
      await adminLog(interaction, 'backup', 'Backup do banco gerado', `💾 \`${file.split(/[\\/]/).pop()}\` (${(size / 1024).toFixed(1)} KB)`);
      if (size < 8 * 1024 * 1024) {
        return interaction.editReply({ content: '💾 Backup gerado com sucesso. **Guarde em local seguro** (contém dados internos).', files: [new AttachmentBuilder(file)] });
      }
      return interaction.editReply({ content: `💾 Backup gerado (${(size / 1048576).toFixed(1)} MB), grande demais para anexar. Arquivo salvo em \`data/backups/\`.` });
    } catch (err) {
      return interaction.editReply({ content: `❌ Falha ao gerar backup: ${err.message}` });
    }
  }
}

module.exports = { render, handle };
