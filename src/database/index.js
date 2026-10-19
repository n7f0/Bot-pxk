const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(path.join(dbDir, 'bot.db'));

function initDB() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_levels (
            user_id TEXT, guild_id TEXT, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 0,
            messages INTEGER DEFAULT 0, last_xp_at TEXT,
            PRIMARY KEY (user_id, guild_id)
        );
        CREATE TABLE IF NOT EXISTS staff_call_hours (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, guild_id TEXT, channel_id TEXT,
            joined_at TEXT, left_at TEXT, seconds INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS suggestions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT UNIQUE, channel_id TEXT, user_id TEXT,
            content TEXT, upvotes INTEGER DEFAULT 0, downvotes INTEGER DEFAULT 0, status TEXT DEFAULT 'open'
        );
    `);
    console.log("✅ Banco de dados SQLite inicializado.");
}

module.exports = {
    initDB,
    db,
    addUserXP: (uid, gid, xp) => db.prepare(`INSERT INTO user_levels (user_id, guild_id, xp, messages, last_xp_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(user_id, guild_id) DO UPDATE SET xp = xp + excluded.xp, messages = messages + 1`).run(uid, gid, xp, new Date().toISOString()),
    getUserLevel: (uid, gid) => db.prepare(`SELECT * FROM user_levels WHERE user_id = ? AND guild_id = ?`).get(uid, gid),
    getTop: (gid, limit=10) => db.prepare(`SELECT * FROM user_levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ?`).all(gid, limit)
};