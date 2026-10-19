const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserLevel } = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('🏆 Ver seu nível e XP atual')
        .addUserOption(option => 
            option.setName('usuario')
                .setDescription('Ver o rank de outro usuário')
                .setRequired(false)
        ),
    async execute(interaction) {
        // Pega o usuário mencionado ou o autor do comando
        const target = interaction.options.getUser('usuario') || interaction.user;
        
        // Busca os dados no banco de dados
        const data = getUserLevel(target.id, interaction.guild.id);

        if (!data) {
            return interaction.reply({ 
                content: `❌ **${target.username}** ainda não possui XP registrado neste servidor.`, 
                ephemeral: true 
            });
        }

        // Lógica de progressão de nível (cada nível exige 100 XP * nível atual)
        // Ex: Nível 0 = 100 XP pro Nível 1; Nível 1 = 200 XP pro Nível 2...
        const currentLevel = data.level;
        const nextLevelXp = (currentLevel + 1) * 100;
        const currentLevelBaseXp = currentLevel * 100;
        
        // Calcula quanto XP falta e a porcentagem
        const xpNeeded = nextLevelXp - data.xp;
        const xpInCurrentLevel = data.xp - currentLevelBaseXp;
        const totalXpForNext = nextLevelXp - currentLevelBaseXp;
        
        let progressPercent = Math.floor((xpInCurrentLevel / totalXpForNext) * 100);
        if (progressPercent < 0) progressPercent = 0;
        if (progressPercent > 100) progressPercent = 100;

        // Cria a barra de progresso visual
        const barLength = 12;
        const filled = Math.floor((progressPercent / 100) * barLength);
        const empty = barLength - filled;
        const progressBar = `[${'█'.repeat(filled)}${'░'.repeat(empty)}] **${progressPercent}%**`;

        // Cria o Embed bonito
        const embed = new EmbedBuilder()
            .setTitle(`🏆 Rank de ${target.username}`)
            .setColor(0x8A4FFF) // Roxo PXKK
            .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields(
                { name: '⭐ Nível', value: `**${data.level}**`, inline: true },
                { name: '💎 XP Total', value: `**${data.xp}**`, inline: true },
                { name: '💬 Mensagens', value: `**${data.messages}**`, inline: true },
                { name: '📈 Progresso', value: `${progressBar}\n-# Faltam **${xpNeeded}** XP para o Nível ${currentLevel + 1}` }
            )
            .setFooter({ text: 'PXKK System • Níveis' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};