const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { addUserXP, getUserLevel, setUserLevel, getTop, addOpenTicket, countTicketsLastHours, logStaffCall, addWarning, countWarnings, removeOpenTicket } = require('./database');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildPresences]
});

const CONFIG_FILE = path.join(__dirname, '../data/config.json');
const getConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } };

const cooldowns = new Map();
const tempVerify = new Map();
const emojiMap = { 'bemvindo': '✨', 'regras': '📜', 'avisos': '📢', 'chat': '💬', 'ticket': '🎫', 'suporte': '🛠️', 'sugestao': '💡', 'feedback': '⭐', 'bot': '🤖', 'call': '🔊', 'membros': '👥', 'logs': '📋', 'rank': '🏆' };

client.once('ready', async () => {
    console.log(`🤖 Bot logado como ${client.user.tag}`);
    await client.application.commands.set([
        { name: 'painel', description: '🖤 Envia o painel administrativo' },
        { name: 'painelticket', description: '🎫 Envia o painel de tickets' },
        { name: 'painelverificacao', description: '✅ Envia o painel de verificação' },
        { name: 'rank', description: '🏆 Ver seu rank' },
        { name: 'top', description: '🏆 Ranking de membros' },
        { name: 'sincronizaremojis', description: '✨ Sincroniza emojis dos canais' },
        { name: 'mutar', description: '🔇 Muta membro', options: [{ name: 'usuario', type: 6, description: 'Usuário', required: true }, { name: 'minutos', type: 4, description: 'Minutos', required: false }] },
        { name: 'castigar', description: '⚡ Aviso', options: [{ name: 'usuario', type: 6, description: 'Usuário', required: true }, { name: 'motivo', type: 3, description: 'Motivo', required: false }] }
    ]);

    const cfg = getConfig();
    if (cfg.activity_rotate_enabled) {
        let index = 0;
        setInterval(() => {
            const msgs = cfg.activity_messages || [`🖤 PXKK System`];
            if(msgs.length === 0) return;
            client.user.setActivity(msgs[index], { type: ActivityType.Watching });
            index = (index + 1) % msgs.length;
        }, (cfg.activity_rotate_seconds || 30) * 1000);
    }
});

client.on('interactionCreate', async interaction => {
    const cfg = getConfig();
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'painel') {
            const embed = new EmbedBuilder().setTitle('⚙️ Central de Controle PXKK').setDescription('Gerencie o servidor pelo painel web!').setColor(cfg.brand_color_primary || 0x8A4FFF);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        if (interaction.commandName === 'painelticket') {
            const embed = new EmbedBuilder().setTitle('🎫 Central de Tickets').setDescription('Selecione uma opção').setColor(cfg.brand_color_primary || 0x8A4FFF);
            const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_menu').setPlaceholder('Selecione o tipo...').addOptions([
                { label: 'MOV CALL', value: 'movcall', emoji: '🎙️' }, { label: 'MOV CHAT', value: 'movchat', emoji: '💬' }, { label: 'RECRUTE-S', value: 'recrute', emoji: '📢' }, { label: 'SUPORTE', value: 'support', emoji: '🛠️' }, { label: 'OUTROS', value: 'others', emoji: '❓' }
            ]));
            await interaction.reply({ embeds: [embed], components: [row] });
        }
        if (interaction.commandName === 'painelverificacao') {
            const embed = new EmbedBuilder().setTitle('✅ Verificação').setDescription('Clique no botão abaixo para se verificar.').setColor(cfg.brand_color_secondary || 0x5B2A8E);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_start').setLabel('Verificar Agora').setStyle(ButtonStyle.Success).setEmoji('✅'));
            await interaction.reply({ embeds: [embed], components: [row] });
        }
        if (interaction.commandName === 'rank') {
            const data = getUserLevel(interaction.user.id, interaction.guild.id);
            if (!data) return interaction.reply({ content: 'Você ainda não tem XP.', ephemeral: true });
            const embed = new EmbedBuilder().setTitle(`🏆 Rank de ${interaction.user.username}`).setColor(0x8A4FFF).addFields({ name: '⭐ Nível', value: `**${data.level}**`, inline: true }, { name: '💎 XP', value: `**${data.xp}**`, inline: true }, { name: '💬 Msgs', value: `**${data.messages}**`, inline: true });
            await interaction.reply({ embeds: [embed] });
        }
        if (interaction.commandName === 'top') {
            const rows = getTop(interaction.guild.id, 10);
            let desc = rows.map((r, i) => `**${i+1}.** <@${r.user_id}> — Nível ${r.level} (${r.xp} XP)`).join('\n');
            if (!desc) desc = 'Sem dados.';
            const embed = new EmbedBuilder().setTitle('🏆 Top Níveis').setDescription(desc).setColor(0xFFD700);
            await interaction.reply({ embeds: [embed] });
        }
        if (interaction.commandName === 'mutar') {
            const user = interaction.options.getMember('usuario');
            const mins = interaction.options.getInteger('minutos') || 10;
            await user.timeout(mins * 60000, 'Mute').catch(()=>{});
            await interaction.reply({ content: `✅ ${user} mutado por ${mins} minutos.`, ephemeral: true });
        }
        if (interaction.commandName === 'castigar') {
            const user = interaction.options.getUser('usuario');
            const reason = interaction.options.getString('motivo') || 'Sem motivo';
            addWarning(user.id, interaction.guild.id, reason, interaction.user.id);
            await interaction.reply({ content: `✅ Aviso aplicado em ${user}.`, ephemeral: true });
        }
        if (interaction.commandName === 'sincronizaremojis') {
            await interaction.deferReply({ ephemeral: true });
            let count = 0;
            interaction.guild.channels.cache.forEach(ch => {
                if (ch.type === 0 || ch.type === 2) {
                    let currentName = ch.name.replace(/^[^\w\s]+\s*/, '');
                    for (const [key, emoji] of Object.entries(emojiMap)) {
                        if (currentName.toLowerCase().includes(key)) { ch.setName(`${emoji}・${currentName}`).catch(()=>{}); count++; break; }
                    }
                }
            });
            await interaction.editReply({ content: `✅ ${count} canais atualizados!` });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_menu') {
        const type = interaction.values[0];
        if (countTicketsLastHours(interaction.user.id, 8) >= 3) return interaction.reply({ content: '❌ Limite de 3 tickets em 8h.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });
        const catId = cfg[`ticket_category_${type}_id`];
        if (!catId) return interaction.editReply({ content: '❌ Categoria não configurada.' });
        try {
            const channel = await interaction.guild.channels.create({ name: `ticket-${type}-${interaction.user.username}`, type: 0, parent: catId, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] });
            addOpenTicket(interaction.user.id, channel.id);
            const embed = new EmbedBuilder().setTitle(`Ticket ${type.toUpperCase()}`).setDescription(`Olá ${interaction.user}, aguarde.`).setColor(0x8A4FFF);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'));
            await channel.send({ content: `${interaction.user}`, embeds: [embed], components: [row] });
            await interaction.editReply({ content: `✅ Ticket criado em ${channel}` });
        } catch (e) { await interaction.editReply({ content: '❌ Erro.' }); }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'ticket_close') {
            await interaction.reply({ content: '🔒 Fechando ticket em 5 segundos...' });
            removeOpenTicket(interaction.channel.id);
            setTimeout(() => interaction.channel.delete().catch(()=>{}), 5000);
        }
        if (interaction.customId === 'verify_start') {
            const answer = Math.floor(Math.random() * 90) + 10;
            tempVerify.set(interaction.user.id, answer);
            const modal = new ModalBuilder().setCustomId('verify_modal').setTitle('Verificação');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('verify_answer').setLabel(`Quanto é ${answer-5} + 5?`).setStyle(TextInputStyle.Short).setRequired(true)));
            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
        const expected = tempVerify.get(interaction.user.id);
        if (parseInt(interaction.fields.getTextInputValue('verify_answer')) === expected) {
            tempVerify.delete(interaction.user.id);
            for (const rid of (cfg.verified_role_ids || [])) await interaction.member.roles.add(rid).catch(()=>{});
            await interaction.reply({ content: '✅ Verificado!', ephemeral: true });
        } else { await interaction.reply({ content: '❌ Incorreto.', ephemeral: true }); }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const cfg = getConfig();
    
    if (cfg.antibot_channel_id && message.channel.id === cfg.antibot_channel_id) {
        await message.delete().catch(()=>{});
        if (cfg.antibot_punish_ban) await message.member.ban({ reason: 'AntiBot' }).catch(()=>{});
        return;
    }
    if (cfg.filters_enabled) {
        let punish = false;
        const blocked = cfg.filters_blocked_words || [];
        if (blocked.some(w => message.content.toLowerCase().includes(w))) punish = true;
        if (!punish && /(https?:\/\/[^\s]+)/g.test(message.content)) {
            const hasRole = message.member.roles.cache.some(r => (cfg.filters_links_allowed_role_ids || []).includes(r.id));
            if (!hasRole) punish = true;
        }
        if (punish) {
            await message.delete().catch(()=>{});
            addWarning(message.author.id, message.guild.id, 'Filtro', 'BOT');
            const warns = countWarnings(message.author.id, message.guild.id);
            message.channel.send(`⚠️ ${message.author}, aviso! (${warns})`).then(m => setTimeout(()=>m.delete(), 5000));
            if (warns >= (cfg.filters_punish_after_warnings || 3)) await message.member.timeout(3600000, 'Muitos avisos').catch(()=>{});
            return;
        }
    }
    if (cfg.levels_enabled) {
        const now = Date.now(), cdKey = `${message.guild.id}-${message.author.id}`;
        if (!cooldowns.has(cdKey) || now - cooldowns.get(cdKey) > (cfg.levels_xp_cooldown_seconds || 60) * 1000) {
            cooldowns.set(cdKey, now);
            addUserXP(message.author.id, message.guild.id, cfg.levels_xp_per_message || 15);
            const data = getUserLevel(message.author.id, message.guild.id);
            const newLevel = Math.floor(data.xp / 100);
            if (newLevel > data.level) {
                setUserLevel(message.author.id, message.guild.id, newLevel);
                message.reply(`🎉 ${message.author} subiu para o **Nível ${newLevel}**!`).catch(()=>{});
            }
        }
    }
});

client.on('guildMemberAdd', async member => {
    const cfg = getConfig();
    if (cfg.auto_role_id) await member.roles.add(cfg.auto_role_id).catch(()=>{});
    if (cfg.welcome_channel_id) {
        const ch = member.guild.channels.cache.get(cfg.welcome_channel_id);
        if (ch) ch.send({ embeds: [new EmbedBuilder().setTitle('✨ Novo Membro').setDescription(`Bem-vindo ${member}!`).setColor(0x8A4FFF).setThumbnail(member.user.displayAvatarURL())] }).catch(()=>{});
    }
});

client.on('guildMemberRemove', async member => {
    const cfg = getConfig();
    if (cfg.leave_channel_id) {
        const ch = member.guild.channels.cache.get(cfg.leave_channel_id);
        if (ch) ch.send({ embeds: [new EmbedBuilder().setTitle('🔒 Até Logo').setDescription(`**${member.user.username}** saiu.`).setColor(0xFF3366)] }).catch(()=>{});
    }
});

client.on('voiceStateUpdate', (oldState, newState) => {
    const member = newState.member;
    if (!member || member.user.bot) return;
    const cfg = getConfig();
    if (!oldState.channelId && newState.channelId && cfg.voice_join_log_channel_id) {
        const ch = member.guild.channels.cache.get(cfg.voice_join_log_channel_id);
        if (ch) ch.send(`🔊 ${member} entrou em **${newState.channel.name}**`).catch(()=>{});
    }
    if (oldState.channelId && !newState.channelId && cfg.voice_leave_log_channel_id) {
        const ch = member.guild.channels.cache.get(cfg.voice_leave_log_channel_id);
        if (ch) ch.send(`🔇 ${member} saiu de **${oldState.channel.name}**`).catch(()=>{});
    }
    const isStaff = member.roles.cache.some(r => (cfg.staff_role_ids || []).includes(r.id));
    if (isStaff) {
        if (!oldState.channelId && newState.channelId) logStaffCall(member.id, member.guild.id, newState.channelId, 'join');
        else if (oldState.channelId && !newState.channelId) logStaffCall(member.id, member.guild.id, oldState.channelId, 'leave');
    }
});

client.login(process.env.DISCORD_TOKEN);