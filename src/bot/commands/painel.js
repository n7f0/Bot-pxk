const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('painel')
        .setDescription('Envia o painel principal'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('⚙️ Painel Administrativo')
            .setDescription('Gerencie seu servidor em um só lugar.')
            .setColor(0x8A4FFF);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_config').setLabel('Configurações').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('btn_tickets').setLabel('Tickets').setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};