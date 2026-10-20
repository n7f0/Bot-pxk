const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(path.join(dbDir, 'bot.db'));

function initDB() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_levels (user_id TEXT, guild_id TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 0, messages INTEGER DEFAULT 0, PRIMARY KEY (user_id, guild_id));
        CREATE TABLE IF NOT EXISTS level_rewards (guild_id TEXT, level INTEGER, role_id TEXT, PRIMARY KEY (guild_id, level));
        CREATE TABLE IF NOT EXISTS word_filters (guild_id TEXT, word TEXT, PRIMARY KEY (guild_id, word));
        CREATE TABLE IF NOT EXISTS link_whitelist (guild_id TEXT, domain TEXT, PRIMARY KEY (guild_id, domain));
        CREATE TABLE IF NOT EXISTS user_warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, guild_id TEXT, reason TEXT, warned_by TEXT, created_at TEXT);
        CREATE TABLE IF NOT EXISTS vip_roles (user_id TEXT, guild_id TEXT, role_id TEXT, color INTEGER, name TEXT, tag TEXT, PRIMARY KEY (user_id, guild_id));
        CREATE TABLE IF NOT EXISTS vip_members (owner_id TEXT, guild_id TEXT, member_id TEXT, PRIMARY KEY (owner_id, guild_id, member_id));
        CREATE TABLE IF NOT EXISTS staff_call_hours (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, guild_id TEXT, channel_id TEXT, joined_at TEXT, left_at TEXT, seconds INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS staff_message_counts (user_id TEXT, guild_id TEXT, date TEXT, count INTEGER DEFAULT 0, PRIMARY KEY (user_id, guild_id, date));
        CREATE TABLE IF NOT EXISTS punishments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, guild_id TEXT, type TEXT, reason TEXT, expires_at TEXT, created_by TEXT, created_at TEXT);
        CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT UNIQUE, channel_id TEXT, user_id TEXT, content TEXT, upvotes INTEGER DEFAULT 0, downvotes INTEGER DEFAULT 0, status TEXT DEFAULT 'open', created_at TEXT);
        CREATE TABLE IF NOT EXISTS suggestion_votes (suggestion_id INTEGER, user_id TEXT, vote_type TEXT, PRIMARY KEY (suggestion_id, user_id));
        CREATE TABLE IF NOT EXISTS open_tickets (user_id TEXT, channel_id TEXT, opened_at TEXT);
        CREATE TABLE IF NOT EXISTS antibot_punishments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, guild_id TEXT, reason TEXT, banned INTEGER, deleted_count INTEGER, created_at TEXT);
        CREATE TABLE IF NOT EXISTS member_count_history (guild_id TEXT, date TEXT, member_count INTEGER, PRIMARY KEY (guild_id, date));
        CREATE TABLE IF NOT EXISTS general_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, rating INTEGER, comment TEXT, created_at TEXT);
    `);
    console.log("✅ Banco de dados SQLite inicializado.");
}

module.exports = {
    initDB, db,
    addUserXP: (uid, gid, xp) => {
        db.prepare(`INSERT INTO user_levels (user_id, guild_id, xp, messages) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, guild_id) DO UPDATE SET xp = xp + excluded.xp, messages = messages + 1`).run(uid, gid, xp);
    },
    getUserLevel: (uid, gid) => db.prepare(`SELECT * FROM user_levels WHERE user_id = ? AND guild_id = ?`).get(uid, gid),
    setUserLevel: (uid, gid, lvl) => db.prepare(`UPDATE user_levels SET level = ? WHERE user_id = ? AND guild_id = ?`).run(lvl, uid, gid),
    getTop: (gid, limit=10) => db.prepare(`SELECT * FROM user_levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ?`).all(gid, limit),
    addWarning: (uid, gid, reason, by) => db.prepare(`INSERT INTO user_warnings (user_id, guild_id, reason, warned_by, created_at) VALUES (?, ?, ?, ?, ?)`).run(uid, gid, reason, by, new Date().toISOString()),
    countWarnings: (uid, gid) => db.prepare(`SELECT COUNT(*) as c FROM user_warnings WHERE user_id = ? AND guild_id = ?`).get(uid, gid).c,
    addSuggestion: (msgId, chId, uid, content) => db.prepare(`INSERT INTO suggestions (message_id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)`).run(msgId, chId, uid, content, new Date().toISOString()),
    getSuggestion: (id) => db.prepare(`SELECT * FROM suggestions WHERE id = ?`).get(id),
    addOpenTicket: (uid, chId) => db.prepare(`INSERT INTO open_tickets (user_id, channel_id, opened_at) VALUES (?, ?, ?)`).run(uid, chId, new Date().toISOString()),
    countTicketsLastHours: (uid, hours) => {
        const since = new Date(Date.now() - hours * 3600000).toISOString();
        return db.prepare(`SELECT COUNT(*) as c FROM open_tickets WHERE user_id = ? AND opened_at > ?`).get(uid, since).c;
    },
    logStaffCall: (uid, gid, chId, action) => {
        if (action === 'join') db.prepare(`INSERT INTO staff_call_hours (user_id, guild_id, channel_id, joined_at) VALUES (?, ?, ?, ?)`).run(uid, gid, chId, new Date().toISOString());
        else {
            const row = db.prepare(`SELECT id, joined_at FROM staff_call_hours WHERE user_id = ? AND guild_id = ? AND left_at IS NULL ORDER BY id DESC LIMIT 1`).get(uid, gid);
            if (row) {
                const sec = Math.floor((new Date() - new Date(row.joined_at)) / 1000);
                db.prepare(`UPDATE staff_call_hours SET left_at = ?, seconds = ? WHERE id = ?`).run(new Date().toISOString(), sec, row.id);
            }
        }
    },
    getStaffCallSeconds: (uid, gid) => db.prepare(`SELECT SUM(seconds) as s FROM staff_call_hours WHERE user_id = ? AND guild_id = ?`).get(uid, gid).s || 0,
    incStaffMsg: (uid, gid) => {
        const today = new Date().toISOString().split('T')[0];
        db.prepare(`INSERT INTO staff_message_counts (user_id, guild_id, date, count) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, guild_id, date) DO UPDATE SET count = count + 1`).run(uid, gid, today);
    },
    getStaffMsgs: (uid, gid) => db.prepare(`SELECT SUM(count) as c FROM staff_message_counts WHERE user_id = ? AND guild_id = ?`).get(uid, gid).c || 0
};