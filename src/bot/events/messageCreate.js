const { addUserXP, getUserLevel } = require('../../database');
const { loadConfig } = require('../../config');
const cooldowns = new Map();

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        if (message.author.bot || !message.guild) return;
        const config = loadConfig();

        // Sistema de Níveis
        if (config.levels_enabled) {
            const now = Date.now();
            const cdKey = `${message.guild.id}-${message.author.id}`;
            const cdTime = (config.levels_xp_cooldown_seconds || 60) * 1000;

            if (!cooldowns.has(cdKey) || now - cooldowns.get(cdKey) > cdTime) {
                cooldowns.set(cdKey, now);
                addUserXP(message.author.id, message.guild.id, config.levels_xp_per_message);
                
                const data = getUserLevel(message.author.id, message.guild.id);
                // Exemplo de Level Up simples (a cada 100 xp)
                const newLevel = Math.floor(data.xp / 100); 
                if (newLevel > data.level) {
                    require('../../database').db.prepare('UPDATE user_levels SET level = ? WHERE user_id = ? AND guild_id = ?').run(newLevel, message.author.id, message.guild.id);
                    message.reply(`🎉 ${message.author} subiu para o **Nível ${newLevel}**!`);
                }
            }
        }
    }
};