const { db } = require('../../database');
const { loadConfig } = require('../../config');

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState, newState) {
        const member = newState.member;
        if (!member || member.user.bot) return;
        
        const config = loadConfig();
        if (!config.staff_role_ids || !member.roles.cache.some(r => config.staff_role_ids.includes(r.id))) return;

        if (!oldState.channelId && newState.channelId) {
            db.prepare('INSERT INTO staff_call_hours (user_id, guild_id, channel_id, joined_at) VALUES (?, ?, ?, ?)').run(member.id, member.guild.id, newState.channelId, new Date().toISOString());
        } else if (oldState.channelId && !newState.channelId) {
            const row = db.prepare('SELECT id, joined_at FROM staff_call_hours WHERE user_id = ? AND guild_id = ? AND left_at IS NULL ORDER BY id DESC LIMIT 1').get(member.id, member.guild.id);
            if (row) {
                const seconds = Math.floor((new Date() - new Date(row.joined_at)) / 1000);
                db.prepare('UPDATE staff_call_hours SET left_at = ?, seconds = ? WHERE id = ?').run(new Date().toISOString(), seconds, row.id);
            }
        }
    }
};