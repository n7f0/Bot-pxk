const { Events, AuditLogEvent } = require('discord.js');
const { sendLog, logEmbed, COLORS } = require('../core');
const { getCfg } = require('../../models');

module.exports = (client) => {
  // Entrada de Membro no Servidor
  client.on(Events.GuildMemberAdd, (member) => {
    const cfg = getCfg();
    if (!cfg.logs?.join) return;
    sendLog(client, 'join', logEmbed('🟢 Membro Entrou', `👤 <@${member.id}> (\`${member.user.tag}\`)\n📅 Conta criada <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, COLORS.ok));
  });

  // Saída de Membro do Servidor
  client.on(Events.GuildMemberRemove, async (member) => {
    const cfg = getCfg();
    if (!cfg.logs?.leave) return;
    try {
      const logs = await member.guild.fetchAuditLogs({ limit: 1 });
      const entry = logs.entries.first();
      if (entry && (entry.action === AuditLogEvent.MemberBanAdd || entry.action === AuditLogEvent.MemberKick) && entry.target.id === member.id && Date.now() - entry.createdTimestamp < 5000) return;
    } catch {}
    sendLog(client, 'leave', logEmbed('🔴 Membro Saiu', `👤 <@${member.id}> (\`${member.user.tag}\`)`, COLORS.bad));
  });

  // Banimento Aplicado e Removido
  client.on(Events.GuildBanAdd, (ban) => {
    const cfg = getCfg();
    if (!cfg.logs?.ban) return;
    sendLog(client, 'ban', logEmbed('🔨 Banimento Aplicado', `👤 **Usuário:** <@${ban.user.id}> (\`${ban.user.tag}\`)\n📝 **Motivo:** ${ban.reason || 'Não informado'}`, COLORS.bad));
  });
  client.on(Events.GuildBanRemove, (ban) => {
    const cfg = getCfg();
    if (!cfg.logs?.ban) return;
    sendLog(client, 'ban', logEmbed('🕊️ Banimento Removido', `👤 **Usuário:** <@${ban.user.id}> (\`${ban.user.tag}\`)`, COLORS.ok));
  });

  // Castigo (Timeout)
  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    const cfg = getCfg();
    if (!cfg.logs?.punish) return;
    const oldT = oldMember.communicationDisabledUntilTimestamp;
    const newT = newMember.communicationDisabledUntilTimestamp;

    if (oldT !== newT) {
      const isActive = newT && newT > Date.now();
      const title = isActive ? '🔇 Castigo Aplicado (Timeout)' : '🔊 Castigo Removido';
      const desc = isActive 
        ? `👤 **Membro:** <@${newMember.id}>\n⏳ **Até:** <t:${Math.floor(newT / 1000)}:f> (<t:${Math.floor(newT / 1000)}:R>)`
        : `👤 **Membro:** <@${newMember.id}> teve o castigo removido.`;
      sendLog(client, 'punish', logEmbed(title, desc, isActive ? COLORS.bad : COLORS.ok));
    }
  });
};