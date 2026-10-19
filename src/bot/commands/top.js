const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { db } = require('../../database'); // Usamos a instância do banco direto para flexibilidade

module.exports = {
    data: new SlashCommandBuilder()
        .setName('top')
        .setDescription('🏆 Ranking de membros mais ativos')
        .addStringOption(option =>
            option.setName('categoria')
                .setDescription('Escolha a categoria do ranking')
                .setRequired(true)
                .addChoices(
                    { name: 'Nível (XP)', value: 'level' },
                    { name: 'Mensagens', value: 'messages' }
                )
        ),
    async execute(interaction) {
        const categoria = interaction.options.getString('categoria');
        
        let query = '';
        let title = '';

        // Define a query SQL com base na escolha do usuário
        if (categoria === 'level') {
            query = 'SELECT user_id, xp, level FROM user_levels WHERE guild_id = ? ORDER BY xp DESC LIMIT 10';
            title = '🏆 Top 10 — Níveis (XP)';
        } else {
            query = 'SELECT user_id, messages FROM user_levels WHERE guild_id = ? ORDER BY messages DESC LIMIT 10';
            title = '🏆 Top 10 — Mensagens';
        }

        // Executa a busca no banco de dados
        const rows = db.prepare(query).all(interaction.guild.id);

        if (rows.length === 0) {
            return interaction.reply({ 
                content: '❌ Ainda não há dados suficientes para gerar o ranking.', 
                ephemeral: true 
            });
        }

        const medals = ['🥇', '🥈', '🥉'];
        let description = '';

        // Monta a lista do ranking
        rows.forEach((row, index) => {
            const medal = index < 3 ? medals[index] : `**#${index + 1}**`;
            
            if (categoria === 'level') {
                description += `${medal} <@${row.user_id}> — Nível **${row.level}** (${row.xp} XP)\n`;
            } else {
                description += `${medal} <@${row.user_id}> — **${row.messages}** mensagens\n`;
            }
        });

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(0x8A4FFF) // Roxo PXKK
            .setFooter({ text: `${interaction.guild.name} • PXKK System` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};