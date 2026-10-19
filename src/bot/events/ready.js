module.exports = {
    name: 'ready',
    once: true,
    async execute(client) {
        console.log(`🤖 Bot logado como ${client.user.tag}`);
        const commands = client.commands.map(c => c.data.toJSON());
        await client.application.commands.set(commands);
        console.log(`✅ Comandos Slash registrados.`);
    }
};