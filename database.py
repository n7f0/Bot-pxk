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
    # NOVAS: sugestões + votos + feedback geral
    c.execute('''CREATE TABLE IF NOT EXISTS suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER UNIQUE,
        channel_id INTEGER,
        user_id INTEGER,
        content TEXT,
        upvotes INTEGER DEFAULT 0,
        downvotes INTEGER DEFAULT 0,
        status TEXT DEFAULT 'open',
        created_at TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS suggestion_votes (
        suggestion_id INTEGER,
        user_id INTEGER,
        vote_type TEXT,
        PRIMARY KEY (suggestion_id, user_id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS general_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, rating INTEGER,
        comment TEXT, created_at TEXT)''')
    conn.commit(); conn.close()

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

def add_ticket_feedback(ticket_channel_id, user_id, rating, comment):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO ticket_feedback (ticket_channel_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?)",
              (ticket_channel_id, user_id, rating, comment, datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

def log_moderation(action, moderator_id, target_id, reason):
    conn = get_db(); c = conn.cursor()
    c.execute("INSERT INTO moderation_logs (action, moderator_id, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
              (action, moderator_id, target_id, reason, datetime.datetime.now().isoformat()))
    conn.commit(); conn.close()

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
    c.execute(
        "INSERT INTO antibot_punishments (user_id, guild_id, reason, banned, deleted_count, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, guild_id, reason, 1 if banned else 0, deleted_count, datetime.datetime.now().isoformat())
    )
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

def get_suggestion_by_message(message_id):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM suggestions WHERE message_id = ?", (message_id,))
    row = c.fetchone(); conn.close()
    return row

def vote_suggestion(suggestion_id, user_id, vote_type):
    """Retorna (up, down, acao) onde acao ∈ {'added','changed','removed'}."""
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
            c.execute("UPDATE suggestions SET upvotes = upvotes + 1, downvotes = MAX(0, downvotes - 1) WHERE id = ?",
                      (suggestion_id,))
        else:
            c.execute("UPDATE suggestions SET downvotes = downvotes + 1, upvotes = MAX(0, upvotes - 1) WHERE id = ?",
                      (suggestion_id,))
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

def get_user_vote(suggestion_id, user_id):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT vote_type FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?",
              (suggestion_id, user_id))
    row = c.fetchone(); conn.close()
    return row["vote_type"] if row else None

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