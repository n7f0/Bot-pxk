import sqlite3
import datetime
import os

DB_PATH = "/app/data/bot.db"

def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db(); c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS welcome_messages (
        user_id INTEGER PRIMARY KEY, message TEXT, image_url TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS scheduled_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT, channel_id INTEGER,
        message TEXT, schedule_time TEXT, repeat_interval INTEGER, active INTEGER DEFAULT 1)''')
    c.execute('''CREATE TABLE IF NOT EXISTS ticket_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_channel_id INTEGER, user_id INTEGER,
        rating INTEGER, comment TEXT, created_at TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS moderation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, moderator_id INTEGER,
        target_id INTEGER, reason TEXT, created_at TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS open_tickets (
        user_id INTEGER, channel_id INTEGER, opened_at TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS antibot_punishments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, guild_id INTEGER,
        reason TEXT, banned INTEGER, deleted_count INTEGER, created_at TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER UNIQUE, channel_id INTEGER, user_id INTEGER,
        content TEXT, upvotes INTEGER DEFAULT 0, downvotes INTEGER DEFAULT 0,
        status TEXT DEFAULT 'open', created_at TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS suggestion_votes (
        suggestion_id INTEGER, user_id INTEGER, vote_type TEXT,
        PRIMARY KEY (suggestion_id, user_id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS general_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, rating INTEGER,
        comment TEXT, created_at TEXT)''')

    # ===== NÍVEIS (tipo MEE6) =====
    c.execute('''CREATE TABLE IF NOT EXISTS user_levels (
        user_id INTEGER, guild_id INTEGER, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 0,
        messages INTEGER DEFAULT 0, last_xp_at TEXT,
        PRIMARY KEY (user_id, guild_id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS level_rewards (
        guild_id INTEGER, level INTEGER, role_id INTEGER,
        PRIMARY KEY (guild_id, level))''')

    # ===== FILTROS DE PALAVRAS/LINKS =====
    c.execute('''CREATE TABLE IF NOT EXISTS word_filters (
        guild_id INTEGER, word TEXT, created_at TEXT,
        PRIMARY KEY (guild_id, word))''')
    c.execute('''CREATE TABLE IF NOT EXISTS link_whitelist (
        guild_id INTEGER, domain TEXT,
        PRIMARY KEY (guild_id, domain))''')
    c.execute('''CREATE TABLE IF NOT EXISTS user_warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, guild_id INTEGER,
        reason TEXT, warned_by INTEGER, created_at TEXT)''')

    # ===== VIP =====
    c.execute('''CREATE TABLE IF NOT EXISTS vip_roles (
        user_id INTEGER, guild_id INTEGER, role_id INTEGER,
        color INTEGER, name TEXT, tag TEXT,
        PRIMARY KEY (user_id, guild_id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS vip_members (
        owner_id INTEGER, guild_id INTEGER, member_id INTEGER,
        added_at TEXT, PRIMARY KEY (owner_id, guild_id, member_id))''')

    # ===== STAFF =====
    c.execute('''CREATE TABLE IF NOT EXISTS staff_call_hours (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER, guild_id INTEGER, channel_id INTEGER,
        joined_at TEXT, left_at TEXT, seconds INTEGER DEFAULT 0)''')
    c.execute('''CREATE TABLE IF NOT EXISTS staff_message_counts (
        user_id INTEGER, guild_id INTEGER, date TEXT, count INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, guild_id, date))''')
    c.execute('''CREATE TABLE IF NOT EXISTS staff_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER, guild_id INTEGER, action TEXT,
        target_id INTEGER, reason TEXT, created_at TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS punishments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER, guild_id INTEGER, type TEXT,
        reason TEXT, expires_at TEXT, created_by INTEGER, created_at TEXT)''')

    conn.commit(); conn.close()

# ===================== WELCOME LEGACY =====================
def get_welcome_message(user_id):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT message, image_url FROM welcome_messages WHERE user_id = ?", (user_id,))
    row = c.fetchone(); conn.close()
    return row if row else None

def set_welcome_message(user_id, message, image_url=None):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO welcome_messages (user_id, message, image_url) VALUES (?, ?, ?)",
              (user_id, message, image_url))
    conn.commit(); conn.close()

# ===================== SCHEDULED =====================
def add_scheduled_event(event_type, channel_id, message, schedule_time, repeat_interval=None):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO scheduled_events (event_type, channel_id, message, schedule_time, repeat_interval, active) VALUES (?, ?, ?, ?, ?, ?)",
              (event_type, channel_id, message, schedule_time, repeat_interval, 1))
    conn.commit(); conn.close()

def get_active_events():
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM scheduled_events WHERE active = 1")
    rows = c.fetchall(); conn.close()
    return rows

def deactivate_event(event_id):
    conn = get_db(); c = conn.cursor()
    c.execute("UPDATE scheduled_events SET active = 0 WHERE id = ?", (event_id,))
    conn.commit(); conn.close()

# ===================== FEEDBACKS =====================
def add_ticket_feedback(ticket_channel_id, user_id, rating, comment):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO ticket_feedback (ticket_channel_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?)",
              (ticket_channel_id, user_id, rating, comment, datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

def add_general_feedback(user_id, rating, comment):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO general_feedback (user_id, rating, comment, created_at) VALUES (?, ?, ?, ?)",
              (user_id, rating, comment, datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

def count_general_feedback():
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM general_feedback")
    n = c.fetchone()[0]; conn.close()
    return n

# ===================== LOGS =====================
def log_moderation(action, moderator_id, target_id, reason):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO moderation_logs (action, moderator_id, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
              (action, moderator_id, target_id, reason, datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

def log_staff_action(staff_id, guild_id, action, target_id=0, reason=""):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO staff_actions (staff_id, guild_id, action, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
              (staff_id, guild_id, action, target_id, reason, datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

def get_staff_actions(staff_id, guild_id, days=30):
    conn = get_db(); c = conn.cursor()
    since = (datetime.datetime.now() - datetime.timedelta(days=days)).isoformat()
    c.execute("SELECT COUNT(*) FROM staff_actions WHERE staff_id = ? AND guild_id = ? AND created_at > ?",
              (staff_id, guild_id, since))
    n = c.fetchone()[0]; conn.close()
    return n

def get_staff_actions_by_type(staff_id, guild_id, action, days=30):
    conn = get_db(); c = conn.cursor()
    since = (datetime.datetime.now() - datetime.timedelta(days=days)).isoformat()
    c.execute("SELECT COUNT(*) FROM staff_actions WHERE staff_id = ? AND guild_id = ? AND action = ? AND created_at > ?",
              (staff_id, guild_id, action, since))
    n = c.fetchone()[0]; conn.close()
    return n

# ===================== TICKETS ABERTOS =====================
def add_open_ticket(user_id, channel_id):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO open_tickets (user_id, channel_id, opened_at) VALUES (?, ?, ?)",
              (user_id, channel_id, datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

def remove_open_ticket(channel_id):
    conn = get_db(); c = conn.cursor()
    c.execute("DELETE FROM open_tickets WHERE channel_id = ?", (channel_id,))
    conn.commit(); conn.close()

def count_user_tickets_last_hours(user_id, hours=8):
    conn = get_db(); c = conn.cursor()
    since = (datetime.datetime.now() - datetime.timedelta(hours=hours)).isoformat()
    c.execute("SELECT COUNT(*) FROM open_tickets WHERE user_id = ? AND opened_at > ?", (user_id, since))
    count = c.fetchone()[0]; conn.close()
    return count

# ===================== ANTIBOT =====================
def add_antibot_punishment(user_id, guild_id, reason, banned=True, deleted_count=0):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO antibot_punishments (user_id, guild_id, reason, banned, deleted_count, created_at) VALUES (?, ?, ?, ?, ?, ?)",
              (user_id, guild_id, reason, 1 if banned else 0, deleted_count, datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

def get_antibot_count(guild_id=None):
    conn = get_db(); c = conn.cursor()
    if guild_id:
        c.execute("SELECT COUNT(*) FROM antibot_punishments WHERE guild_id = ?", (guild_id,))
    else:
        c.execute("SELECT COUNT(*) FROM antibot_punishments")
    n = c.fetchone()[0]; conn.close()
    return n

# ===================== SUGESTÕES =====================
def add_suggestion(message_id, channel_id, user_id, content):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO suggestions (message_id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
              (message_id, channel_id, user_id, content, datetime.datetime.now().isoformat()))
    sid = c.lastrowid
    conn.commit(); conn.close()
    return sid

def get_suggestion(sid):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM suggestions WHERE id = ?", (sid,))
    row = c.fetchone(); conn.close()
    return row

def vote_suggestion(suggestion_id, user_id, vote_type):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT vote_type FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?",
              (suggestion_id, user_id))
    row = c.fetchone()
    prev = row["vote_type"] if row else None

    if prev == vote_type:
        c.execute("DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?",
                  (suggestion_id, user_id))
        if vote_type == "up":
            c.execute("UPDATE suggestions SET upvotes = MAX(0, upvotes - 1) WHERE id = ?", (suggestion_id,))
        else:
            c.execute("UPDATE suggestions SET downvotes = MAX(0, downvotes - 1) WHERE id = ?", (suggestion_id,))
        acao = "removed"
    elif prev:
        c.execute("UPDATE suggestion_votes SET vote_type = ? WHERE suggestion_id = ? AND user_id = ?",
                  (vote_type, suggestion_id, user_id))
        if vote_type == "up":
            c.execute("UPDATE suggestions SET upvotes = upvotes + 1, downvotes = MAX(0, downvotes - 1) WHERE id = ?", (suggestion_id,))
        else:
            c.execute("UPDATE suggestions SET downvotes = downvotes + 1, upvotes = MAX(0, upvotes - 1) WHERE id = ?", (suggestion_id,))
        acao = "changed"
    else:
        c.execute("INSERT INTO suggestion_votes (suggestion_id, user_id, vote_type) VALUES (?, ?, ?)",
                  (suggestion_id, user_id, vote_type))
        if vote_type == "up":
            c.execute("UPDATE suggestions SET upvotes = upvotes + 1 WHERE id = ?", (suggestion_id,))
        else:
            c.execute("UPDATE suggestions SET downvotes = downvotes + 1 WHERE id = ?", (suggestion_id,))
        acao = "added"

    c.execute("SELECT upvotes, downvotes FROM suggestions WHERE id = ?", (suggestion_id,))
    r = c.fetchone()
    up = r["upvotes"] if r else 0
    down = r["downvotes"] if r else 0
    conn.commit(); conn.close()
    return up, down, acao

# ===================== NÍVEIS =====================
def get_user_level(user_id, guild_id):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM user_levels WHERE user_id = ? AND guild_id = ?", (user_id, guild_id))
    row = c.fetchone(); conn.close()
    return dict(row) if row else None

def add_user_xp(user_id, guild_id, xp):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO user_levels (user_id, guild_id, xp, level, messages, last_xp_at) VALUES (?, ?, ?, 0, 1, ?)",
              (user_id, guild_id, xp, datetime.datetime.now().isoformat()))
    c.execute("UPDATE user_levels SET xp = xp + ?, messages = messages + 1, last_xp_at = ? WHERE user_id = ? AND guild_id = ?",
              (xp, datetime.datetime.now().isoformat(), user_id, guild_id))
    conn.commit(); conn.close()

def set_user_level(user_id, guild_id, level):
    conn = get_db(); c = conn.cursor()
    c.execute("UPDATE user_levels SET level = ? WHERE user_id = ? AND guild_id = ?", (level, user_id, guild_id))
    conn.commit(); conn.close()

def get_level_rewards(guild_id):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT level, role_id FROM level_rewards WHERE guild_id = ? ORDER BY level ASC", (guild_id,))
    rows = c.fetchall(); conn.close()
    return {r["level"]: r["role_id"] for r in rows}

def set_level_reward(guild_id, level, role_id):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO level_rewards (guild_id, level, role_id) VALUES (?, ?, ?)",
              (guild_id, level, role_id))
    conn.commit(); conn.close()

def remove_level_reward(guild_id, level):
    conn = get_db(); c = conn.cursor()
    c.execute("DELETE FROM level_rewards WHERE guild_id = ? AND level = ?", (guild_id, level))
    conn.commit(); conn.close()

def get_level_leaderboard(guild_id, limit=10):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM user_levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ?", (guild_id, limit))
    rows = [dict(r) for r in c.fetchall()]; conn.close()
    return rows

# ===================== FILTROS =====================
def add_word_filter(guild_id, word):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO word_filters (guild_id, word, created_at) VALUES (?, ?, ?)",
              (guild_id, word.lower(), datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

def remove_word_filter(guild_id, word):
    conn = get_db(); c = conn.cursor()
    c.execute("DELETE FROM word_filters WHERE guild_id = ? AND word = ?", (guild_id, word.lower()))
    conn.commit(); conn.close()

def get_word_filters(guild_id):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT word FROM word_filters WHERE guild_id = ?", (guild_id,))
    rows = [r["word"] for r in c.fetchall()]; conn.close()
    return rows

def add_link_whitelist(guild_id, domain):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO link_whitelist (guild_id, domain) VALUES (?, ?)",
              (guild_id, domain.lower()))
    conn.commit(); conn.close()

def remove_link_whitelist(guild_id, domain):
    conn = get_db(); c = conn.cursor()
    c.execute("DELETE FROM link_whitelist WHERE guild_id = ? AND domain = ?", (guild_id, domain.lower()))
    conn.commit(); conn.close()

def get_link_whitelist(guild_id):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT domain FROM link_whitelist WHERE guild_id = ?", (guild_id,))
    rows = [r["domain"] for r in c.fetchall()]; conn.close()
    return rows

def add_user_warning(user_id, guild_id, reason, warned_by):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO user_warnings (user_id, guild_id, reason, warned_by, created_at) VALUES (?, ?, ?, ?, ?)",
              (user_id, guild_id, reason, warned_by, datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

def count_user_warnings(user_id, guild_id, days=30):
    conn = get_db(); c = conn.cursor()
    since = (datetime.datetime.now() - datetime.timedelta(days=days)).isoformat()
    c.execute("SELECT COUNT(*) FROM user_warnings WHERE user_id = ? AND guild_id = ? AND created_at > ?",
              (user_id, guild_id, since))
    n = c.fetchone()[0]; conn.close()
    return n

# ===================== VIP =====================
def get_vip_role(user_id, guild_id):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM vip_roles WHERE user_id = ? AND guild_id = ?", (user_id, guild_id))
    row = c.fetchone(); conn.close()
    return dict(row) if row else None

def set_vip_role(user_id, guild_id, role_id, color=None, name=None, tag=None):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO vip_roles (user_id, guild_id, role_id, color, name, tag) VALUES (?, ?, ?, ?, ?, ?)",
              (user_id, guild_id, role_id, color, name, tag))
    conn.commit(); conn.close()

def update_vip_role(user_id, guild_id, color=None, name=None, tag=None):
    conn = get_db(); c = conn.cursor()
    if color is not None:
        c.execute("UPDATE vip_roles SET color = ? WHERE user_id = ? AND guild_id = ?", (color, user_id, guild_id))
    if name is not None:
        c.execute("UPDATE vip_roles SET name = ? WHERE user_id = ? AND guild_id = ?", (name, user_id, guild_id))
    if tag is not None:
        c.execute("UPDATE vip_roles SET tag = ? WHERE user_id = ? AND guild_id = ?", (tag, user_id, guild_id))
    conn.commit(); conn.close()

def add_vip_member(owner_id, guild_id, member_id):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO vip_members (owner_id, guild_id, member_id, added_at) VALUES (?, ?, ?, ?)",
              (owner_id, guild_id, member_id, datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

def remove_vip_member(owner_id, guild_id, member_id):
    conn = get_db(); c = conn.cursor()
    c.execute("DELETE FROM vip_members WHERE owner_id = ? AND guild_id = ? AND member_id = ?",
              (owner_id, guild_id, member_id))
    conn.commit(); conn.close()

def get_vip_members(owner_id, guild_id):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT member_id FROM vip_members WHERE owner_id = ? AND guild_id = ?", (owner_id, guild_id))
    rows = [r["member_id"] for r in c.fetchall()]; conn.close()
    return rows

# ===================== STAFF =====================
def start_staff_call(user_id, guild_id, channel_id):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO staff_call_hours (user_id, guild_id, channel_id, joined_at) VALUES (?, ?, ?, ?)",
              (user_id, guild_id, channel_id, datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

def end_staff_call(user_id, guild_id):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT id, joined_at FROM staff_call_hours WHERE user_id = ? AND guild_id = ? AND left_at IS NULL ORDER BY id DESC LIMIT 1",
              (user_id, guild_id))
    row = c.fetchone()
    if row:
        joined = datetime.datetime.fromisoformat(row["joined_at"])
        seconds = int((datetime.datetime.now() - joined).total_seconds())
        c.execute("UPDATE staff_call_hours SET left_at = ?, seconds = ? WHERE id = ?",
                  (datetime.datetime.now().isoformat(), seconds, row["id"]))
    conn.commit(); conn.close()

def get_staff_call_seconds(user_id, guild_id, days=30):
    conn = get_db(); c = conn.cursor()
    since = (datetime.datetime.now() - datetime.timedelta(days=days)).isoformat()
    c.execute("SELECT COALESCE(SUM(seconds), 0) FROM staff_call_hours WHERE user_id = ? AND guild_id = ? AND joined_at > ?",
              (user_id, guild_id, since))
    n = c.fetchone()[0]; conn.close()
    return n or 0

def increment_staff_messages(user_id, guild_id):
    today = datetime.date.today().isoformat()
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO staff_message_counts (user_id, guild_id, date, count) VALUES (?, ?, ?, 0)",
              (user_id, guild_id, today))
    c.execute("UPDATE staff_message_counts SET count = count + 1 WHERE user_id = ? AND guild_id = ? AND date = ?",
              (user_id, guild_id, today))
    conn.commit(); conn.close()

def get_staff_message_count(user_id, guild_id, days=30):
    since = (datetime.date.today() - datetime.timedelta(days=days)).isoformat()
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT COALESCE(SUM(count), 0) FROM staff_message_counts WHERE user_id = ? AND guild_id = ? AND date >= ?",
              (user_id, guild_id, since))
    n = c.fetchone()[0]; conn.close()
    return n or 0

# ===================== PUNIÇÕES =====================
def add_punishment(user_id, guild_id, ptype, reason, expires_at=None, created_by=None):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO punishments (user_id, guild_id, type, reason, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
              (user_id, guild_id, ptype, reason, expires_at, created_by, datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

def get_active_punishments(user_id, guild_id):
    conn = get_db(); c = conn.cursor()
    now = datetime.datetime.now().isoformat()
    c.execute("SELECT * FROM punishments WHERE user_id = ? AND guild_id = ? AND (expires_at IS NULL OR expires_at > ?)",
              (user_id, guild_id, now))
    rows = [dict(r) for r in c.fetchall()]; conn.close()
    return rows
