const { Events, AuditLogEvent, EmbedBuilder } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../core');
const { getCfg } = require('../../models');

module.exports = (client) => {
  // 1. Entrada de Membro
  client.on(Events.GuildMemberAdd, (member) => {
    const cfg = getCfg();
    if (!cfg.logs.joinLeave) return;
    sendLog(client, 'joinLeave', logEmbed('🟢 Membro Entrou', `👤 <@${member.id}> (\`${member.user.tag}\`)\n📅 Conta criada <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, COLORS.ok));
  });

  // 2. Saída de Membro
  client.on(Events.GuildMemberRemove, async (member) => {
    const cfg = getCfg();
    if (!cfg.logs.joinLeave) return;
    
    // Verifica se foi kick/ban para não logar duas vezes
    try {
      const logs = await member.guild.fetchAuditLogs({ limit: 1 });
      const entry = logs.entries.first();
      if (entry && (entry.action === AuditLogEvent.MemberBanAdd || entry.action === AuditLogEvent.MemberKick) && entry.target.id === member.id && Date.now() - entry.createdTimestamp < 5000) return;
    } catch {}

    sendLog(client, 'joinLeave', logEmbed('🔴 Membro Saiu', `👤 <@${member.id}> (\`${member.user.tag}\`)`, COLORS.bad));
  });

  // 3. Banimento
  client.on(Events.GuildBanAdd, (ban) => {
    const cfg = getCfg();
    if (!cfg.logs.ban) return;
    sendLog(client, 'ban', logEmbed('🔨 Banimento Aplicado', `👤 **Usuário:** <@${ban.user.id}> (\`${ban.user.tag}\`)\n📝 **Motivo:** ${ban.reason || 'Não informado'}`, COLORS.bad));
  });

  // 4. Banimento Removido
  client.on(Events.GuildBanRemove, (ban) => {
    const cfg = getCfg();
    if (!cfg.logs.ban) return;
    sendLog(client, 'ban', logEmbed('🕊️ Banimento Removido', `👤 **Usuário:** <@${ban.user.id}> (\`${ban.user.tag}\`)`, COLORS.ok));
  });

  // 5. Castigo (Timeout)
  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    const cfg = getCfg();
    if (!cfg.logs.punish) return;

    const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
    const newTimeout = newMember.communicationDisabledUntilTimestamp;

    if (oldTimeout !== newTimeout) {
      const isActive = newTimeout && newTimeout > Date.now();
      const title = isActive ? '🔇 Castigo Aplicado (Timeout)' : '🔊 Castigo Removido';
      const desc = isActive 
        ? `👤 **Membro:** <@${newMember.id}>\n⏳ **Até:** <t:${Math.floor(newTimeout / 1000)}:f> (<t:${Math.floor(newTimeout / 1000)}:R>)`
        : `👤 **Membro:** <@${newMember.id}> teve o castigo removido.`;
      
      sendLog(client, 'punish', logEmbed(title, desc, isActive ? COLORS.bad : COLORS.ok));
    }
  });
};