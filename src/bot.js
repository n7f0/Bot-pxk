const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { addUserXP, getUserLevel, setUserLevel, getTop, addOpenTicket, countTicketsLastHours, logStaffCall } = require('./database');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates]
});

const CONFIG_FILE = path.join(__dirname, '../data', 'config.json');
const getConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } };

const cooldowns = new Map();
const tempVerify = new Map();

client.once('ready', async () => {
    console.log(`🤖 Bot logado como ${client.user.tag}`);
    
    await client.application.commands.set([
        { name: 'painel', description: '🖤 Envia o painel administrativo' },
        { name: 'painelticket', description: '🎫 Envia o painel de tickets' },
        { name: 'painelverificacao', description: '✅ Envia o painel de verificação' },
        { name: 'rank', description: '🏆 Ver seu rank' },
        { name: 'top', description: '🏆 Ranking de membros' }
    ]);
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const cfg = getConfig();
        
        if (interaction.commandName === 'painel') {
            const embed = new EmbedBuilder().setTitle('⚙️ Central de Controle PXKK').setDescription('Gerencie o servidor pelo painel web!').setColor(0x8A4FFF);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (interaction.commandName === 'painelticket') {
            const embed = new EmbedBuilder().setTitle(cfg.ticket_panel_title || '🎫 Central de Tickets').setDescription(cfg.ticket_panel_desc || 'Selecione uma opção').setColor(0x8A4FFF);
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('ticket_menu').setPlaceholder('Selecione o tipo...').addOptions([
                    { label: 'MOV CALL', value: 'movcall', emoji: '🎙️' },
                    { label: 'MOV CHAT', value: 'movchat', emoji: '💬' },
                    { label: 'RECRUTE-S', value: 'recrute', emoji: '📢' },
                    { label: 'SUPORTE', value: 'support', emoji: '🛠️' },
                    { label: 'OUTROS', value: 'others', emoji: '❓' }
                ])
            );
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (interaction.commandName === 'painelverificacao') {
            const embed = new EmbedBuilder().setTitle('✅ Verificação').setDescription('Clique no botão abaixo para se verificar.').setColor(0x5B2A8E);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_start').setLabel('Verificar Agora').setStyle(ButtonStyle.Success).setEmoji('✅'));
            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (interaction.commandName === 'rank') {
            const data = getUserLevel(interaction.user.id, interaction.guild.id);
            if (!data) return interaction.reply({ content: 'Você ainda não tem XP.', ephemeral: true });
            const embed = new EmbedBuilder().setTitle(`🏆 Rank de ${interaction.user.username}`).setColor(0x8A4FFF)
                .addFields({ name: '⭐ Nível', value: `**${data.level}**`, inline: true }, { name: '💎 XP', value: `**${data.xp}**`, inline: true }, { name: '💬 Msgs', value: `**${data.messages}**`, inline: true });
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'top') {
            const rows = getTop(interaction.guild.id, 10);
            let desc = rows.map((r, i) => `**${i+1}.** <@${r.user_id}> — Nível ${r.level} (${r.xp} XP)`).join('\n');
            if (!desc) desc = 'Sem dados.';
            const embed = new EmbedBuilder().setTitle('🏆 Top Níveis').setDescription(desc).setColor(0xFFD700);
            await interaction.reply({ embeds: [embed] });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_menu') {
        const type = interaction.values[0];
        if (countTicketsLastHours(interaction.user.id, 8) >= 3) {
            return interaction.reply({ content: '❌ Você já abriu 3 tickets nas últimas 8 horas.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        
        const cfg = getConfig();
        const catId = cfg[`ticket_category_${type}_id`];
        if (!catId) return interaction.editReply({ content: '❌ Categoria não configurada pelo ADM.' });

        try {
            const channel = await interaction.guild.channels.create({
                name: `ticket-${type}-${interaction.user.username}`,
                type: 0,
                parent: catId,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
            });
            addOpenTicket(interaction.user.id, channel.id);
            
            const embed = new EmbedBuilder().setTitle(`Ticket ${type.toUpperCase()}`).setDescription(`Olá ${interaction.user}, aguarde o suporte.`).setColor(0x8A4FFF);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'));
            await channel.send({ content: `${interaction.user}`, embeds: [embed], components: [row] });
            await interaction.editReply({ content: `✅ Ticket criado em ${channel}` });
        } catch (e) { await interaction.editReply({ content: '❌ Erro ao criar ticket.' }); }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'ticket_close') {
            await interaction.reply({ content: '🔒 Fechando ticket em 5 segundos...' });
            setTimeout(() => interaction.channel.delete().catch(()=>{}), 5000);
        }
        if (interaction.customId === 'verify_start') {
            const answer = Math.floor(Math.random() * 90) + 10;
            tempVerify.set(interaction.user.id, answer);
            const modal = new ModalBuilder().setCustomId('verify_modal').setTitle('Verificação');
            const input = new TextInputBuilder().setCustomId('verify_answer').setLabel(`Quanto é ${answer-5} + 5?`).setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
        const expected = tempVerify.get(interaction.user.id);
        const given = parseInt(interaction.fields.getTextInputValue('verify_answer'));
        if (given === expected) {
            tempVerify.delete(interaction.user.id);
            const cfg = getConfig();
            for (const rid of (cfg.verified_role_ids || [])) {
                await interaction.member.roles.add(rid).catch(()=>{});
            }
            await interaction.reply({ content: '✅ Verificado com sucesso!', ephemeral: true });
        } else {
            await interaction.reply({ content: '❌ Resposta incorreta.', ephemeral: true });
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const cfg = getConfig();

    if (cfg.levels_enabled) {
        const now = Date.now();
        const cdKey = `${message.guild.id}-${message.author.id}`;
        const cdTime = (cfg.levels_xp_cooldown_seconds || 60) * 1000;

        if (!cooldowns.has(cdKey) || now - cooldowns.get(cdKey) > cdTime) {
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

client.on('voiceStateUpdate', (oldState, newState) => {
    const member = newState.member;
    if (!member || member.user.bot) return;
    const cfg = getConfig();
    const isStaff = member.roles.cache.some(r => (cfg.staff_role_ids || []).includes(r.id));

    if (isStaff) {
        if (!oldState.channelId && newState.channelId) logStaffCall(member.id, member.guild.id, newState.channelId, 'join');
        else if (oldState.channelId && !newState.channelId) logStaffCall(member.id, member.guild.id, oldState.channelId, 'leave');
    }
});

client.login(process.env.DISCORD_TOKEN);