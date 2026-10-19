const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        // Slash Commands
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;
            try { await command.execute(interaction); } catch (error) {
                console.error(error);
                await interaction.reply({ content: 'Erro ao executar comando.', ephemeral: true });
            }
        }

        // Botões (Tickets / Verificação)
        if (interaction.isButton()) {
            if (interaction.customId === 'verify_button') {
                await interaction.reply({ content: '✅ Você foi verificado com sucesso!', ephemeral: true });
            }
            if (interaction.customId === 'ticket_close') {
                await interaction.reply({ content: '🔒 Fechando ticket em 5 segundos...', ephemeral: true });
                setTimeout(() => interaction.channel.delete(), 5000);
            }
        }
    }
};