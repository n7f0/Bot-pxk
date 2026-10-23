'use strict';

/**
 * Migrações versionadas. Para evoluir o banco (V2+), basta ADICIONAR um novo item
 * ao final da lista com `version` maior. Nunca edite migrações já publicadas.
 */
module.exports = [
  {
    version: 1,
    name: 'schema inicial',
    sql: `
      CREATE TABLE settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE users (
        user_id     TEXT PRIMARY KEY,
        first_seen  INTEGER NOT NULL
      );

      CREATE TABLE seasons (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        number       INTEGER NOT NULL UNIQUE,
        status       TEXT NOT NULL DEFAULT 'active',
        started_at   INTEGER NOT NULL,
        ended_at     INTEGER,
        closed_by    TEXT,
        close_reason TEXT,
        stats        TEXT
      );
      CREATE UNIQUE INDEX one_active_season ON seasons(status) WHERE status = 'active';

      CREATE TABLE season_scores (
        season_id      INTEGER NOT NULL,
        user_id        TEXT NOT NULL,
        points         INTEGER NOT NULL DEFAULT 0,
        total_added    INTEGER NOT NULL DEFAULT 0,
        total_removed  INTEGER NOT NULL DEFAULT 0,
        changes        INTEGER NOT NULL DEFAULT 0,
        last_change_at INTEGER,
        PRIMARY KEY (season_id, user_id),
        FOREIGN KEY (season_id) REFERENCES seasons(id)
      );
      CREATE INDEX idx_scores_rank ON season_scores(season_id, points DESC, last_change_at);

      CREATE TABLE season_rankings (
        season_id INTEGER NOT NULL,
        position  INTEGER NOT NULL,
        user_id   TEXT NOT NULL,
        points    INTEGER NOT NULL,
        PRIMARY KEY (season_id, position),
        FOREIGN KEY (season_id) REFERENCES seasons(id)
      );

      CREATE TABLE point_history (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        season_id     INTEGER NOT NULL,
        user_id       TEXT NOT NULL,
        actor_id      TEXT,
        points_before INTEGER NOT NULL,
        delta         INTEGER NOT NULL,
        points_after  INTEGER NOT NULL,
        type          TEXT NOT NULL,
        reason        TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX idx_history_user ON point_history(user_id, id DESC);
      CREATE INDEX idx_history_season ON point_history(season_id, user_id);

      CREATE TABLE role_permissions (
        guild_id   TEXT NOT NULL,
        role_id    TEXT NOT NULL,
        permission TEXT NOT NULL,
        PRIMARY KEY (role_id, permission)
      );

      CREATE TABLE point_roles (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id        TEXT NOT NULL,
        role_id         TEXT NOT NULL,
        points          INTEGER NOT NULL UNIQUE,
        remove_previous INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE bateponto_sessions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         TEXT NOT NULL,
        guild_id        TEXT NOT NULL,
        area            TEXT NOT NULL,
        role_name       TEXT,
        status          TEXT NOT NULL DEFAULT 'active',
        started_at      INTEGER NOT NULL,
        ends_at         INTEGER NOT NULL,
        duration_ms     INTEGER NOT NULL,
        goal            INTEGER NOT NULL,
        reward          INTEGER NOT NULL,
        channel_id      TEXT NOT NULL,
        messages        INTEGER NOT NULL DEFAULT 0,
        goal_reached_at INTEGER,
        last_counted_at INTEGER,
        ended_at        INTEGER,
        points_awarded  INTEGER NOT NULL DEFAULT 0,
        result_note     TEXT
      );
      CREATE UNIQUE INDEX one_active_bp_per_user ON bateponto_sessions(user_id) WHERE status = 'active';
      CREATE INDEX idx_bp_status ON bateponto_sessions(status, ends_at);

      CREATE TABLE bateponto_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        user_id    TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES bateponto_sessions(id)
      );
      CREATE INDEX idx_bpmsg_session ON bateponto_messages(session_id);

      CREATE TABLE logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        category   TEXT NOT NULL,
        action     TEXT NOT NULL,
        guild_id   TEXT,
        actor_id   TEXT,
        target_id  TEXT,
        summary    TEXT,
        details    TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_logs_cat ON logs(category, id DESC);
    `,
  },
];
