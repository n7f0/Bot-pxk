'use strict';

const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const { Config, DEFAULTS } = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  serveClient: false,
  maxHttpBufferSize: 1e6,
});

const isProduction = process.env.NODE_ENV === 'production';
const publicDir = path.join(__dirname, '../public');
const port = Number(process.env.PORT || 8080);
const sessionSecret = process.env.PANEL_SECRET || process.env.DISCORD_CLIENT_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error('Defina PANEL_SECRET com pelo menos 32 caracteres antes de iniciar o dashboard.');
}
if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
  throw new Error('DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET são obrigatórios para o login OAuth.');
}

if (isProduction) app.set('trust proxy', 1);

class MongoSessionStore extends session.Store {
  constructor() {
    super();
    this.collection = mongoose.connection.collection('dashboard_sessions');
    this.ready = this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  _run(operation, callback) {
    this.ready
      .then(operation)
      .then((value) => callback && callback(null, value))
      .catch((error) => {
        if (callback) callback(error);
        else console.error('[session-store]', error.message);
      });
  }

  get(sid, callback) {
    this._run(async () => {
      const row = await this.collection.findOne({ _id: sid });
      if (!row || row.expiresAt <= new Date()) return null;
      return row.session;
    }, callback);
  }

  set(sid, sess, callback) {
    this._run(async () => {
      const expiresAt = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires)
        : new Date(Date.now() + Number((sess.cookie && sess.cookie.maxAge) || 86400000));
      await this.collection.updateOne(
        { _id: sid },
        { $set: { session: sess, expiresAt } },
        { upsert: true }
      );
    }, callback);
  }

  touch(sid, sess, callback) {
    this.set(sid, sess, callback);
  }

  destroy(sid, callback) {
    this._run(async () => {
      await this.collection.deleteOne({ _id: sid });
    }, callback);
  }
}

const store = new MongoSessionStore();
const sessionMiddleware = session({
  name: 'pxk.sid',
  secret: sessionSecret,
  store,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12,
    path: '/',
  },
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(sessionMiddleware);

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado.' });
    return res.redirect('/login');
  }
  next();
}

function timingSafeEqualText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireCsrf(req, res, next) {
  const supplied = req.get('X-CSRF-Token');
  if (!req.session || !timingSafeEqualText(supplied, req.session.csrfToken)) {
    return res.status(403).json({ error: 'Token de segurança inválido. Atualize a página e tente novamente.' });
  }
  next();
}

function validateConfigPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('O corpo da configuração precisa ser um objeto.');
  }

  let visited = 0;
  function inspect(node, depth) {
    visited += 1;
    if (visited > 8000 || depth > 12) throw new Error('Configuração muito grande ou profunda.');
    if (node === null || typeof node === 'boolean') return;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) throw new Error('A configuração contém um número inválido.');
      return;
    }
    if (typeof node === 'string') {
      if (node.length > 10000) throw new Error('Um campo de texto excede o limite permitido.');
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > 500) throw new Error('Uma lista excede o limite permitido.');
      for (const item of node) inspect(item, depth + 1);
      return;
    }
    if (typeof node !== 'object' || Object.getPrototypeOf(node) !== Object.prototype) {
      throw new Error('A configuração contém um tipo de dado inválido.');
    }
    for (const key of Object.keys(node)) {
      if (!key || key.length > 120 || key.startsWith('$') || key.includes('.') ||
          key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new Error('A configuração contém uma chave não permitida.');
      }
      inspect(node[key], depth + 1);
    }
  }

  inspect(value, 0);
  const allowedRoots = new Set([
    ...Object.keys(DEFAULTS),
    'bot_status', 'bp_area', 'bp_channel_id', 'bp_duration_min', 'bp_enabled', 'bp_goal', 'bp_reward',
    'presence_interval', 'presence_rotation', 'presences', 'per_page', 'rank_max',
    'roles_clear_on_reset', 'roles_enabled', 'timezone', 'ui_bar_empty', 'ui_bar_full',
    'ui_color', 'ui_sep_char', 'ui_sep_len',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedRoots.has(key)) throw new Error('Campo de configuração desconhecido: ' + key);
  }
  return value;
}

function getBaseUrl(req) {
  const configured = String(process.env.BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (isProduction) throw new Error('BASE_URL precisa ser configurada em produção.');
  return req.protocol + '://' + req.get('host');
}

module.exports.io = io;
module.exports.sessionMiddleware = sessionMiddleware;

io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const auth = socket.handshake.auth || {};
  const botSecret = process.env.PANEL_SECRET || process.env.DISCORD_CLIENT_SECRET;
  if (auth.role === 'bot' && timingSafeEqualText(auth.token, botSecret)) {
    socket.data.isBot = true;
    return next();
  }
  if (socket.request.session && socket.request.session.user) return next();
  return next(new Error('Não autorizado.'));
});

app.get('/healthz', (req, res) => {
  res.json({
    ok: mongoose.connection.readyState === 1,
    service: 'pxk-dashboard',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.get('/auth', (req, res) => {
  try {
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauthState = state;
    const baseUrl = getBaseUrl(req);
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: baseUrl + '/callback',
      response_type: 'code',
      scope: 'identify',
      state,
    });
    res.redirect('https://discord.com/oauth2/authorize?' + params.toString());
  } catch (error) {
    console.error('[oauth]', error.message);
    res.status(500).send('O login ainda não está configurado corretamente.');
  }
});

app.get('/callback', async (req, res) => {
  const expectedState = req.session.oauthState;
  delete req.session.oauthState;
  if (!timingSafeEqualText(String(req.query.state || ''), expectedState)) {
    return res.status(400).send('Solicitação de login inválida. Volte e tente novamente.');
  }
  if (typeof req.query.code !== 'string' || !req.query.code) {
    return res.status(400).send('O Discord não retornou um código de autorização.');
  }

  try {
    const baseUrl = getBaseUrl(req);
    const tokenResponse = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: baseUrl + '/callback',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );

    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: 'Bearer ' + tokenResponse.data.access_token },
      timeout: 15000,
    });
    const profile = userResponse.data;
    const allowedIds = [...new Set(
      [...(process.env.OWNER_IDS || '').split(','), ...(process.env.DEV_IDS || '').split(',')]
        .map((id) => id.trim())
        .filter(Boolean)
    )];

    if (!allowedIds.includes(profile.id)) {
      return res.status(403).send('Sua conta Discord não está autorizada a acessar este painel.');
    }

    req.session.regenerate((regenerateError) => {
      if (regenerateError) {
        console.error('[oauth] falha ao renovar sessão:', regenerateError.message);
        return res.status(500).send('Não foi possível criar uma sessão segura.');
      }
      req.session.user = {
        id: profile.id,
        username: profile.username,
        global_name: profile.global_name || null,
        avatar: profile.avatar || null,
      };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.save((saveError) => {
        if (saveError) {
          console.error('[oauth] falha ao salvar sessão:', saveError.message);
          return res.status(500).send('Não foi possível salvar sua sessão.');
        }
        res.redirect('/');
      });
    });
  } catch (error) {
    console.error('[oauth]', error.response && error.response.data ? error.response.data : error.message);
    res.status(400).send('Falha na autenticação com o Discord. Verifique as credenciais e a URL de retorno.');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) console.error('[session] falha ao encerrar sessão:', error.message);
    res.clearCookie('pxk.sid', {
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
    });
    res.redirect('/login');
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...req.session.user, csrfToken: req.session.csrfToken });
});

app.get('/api/config', requireAuth, async (req, res) => {
  try {
    const cfg = await Config.findOne({ key: 'main' }).lean();
    res.setHeader('Cache-Control', 'no-store');
    res.json(cfg && cfg.data ? cfg.data : {});
  } catch (error) {
    console.error('[api/config]', error.message);
    res.status(500).json({ error: 'Erro ao carregar as configurações.' });
  }
});

app.post('/api/config', requireAuth, requireCsrf, async (req, res) => {
  try {
    const safeConfig = validateConfigPayload(req.body);
    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { data: safeConfig } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    io.emit('config_updated', safeConfig);
    res.json({ success: true });
  } catch (error) {
    console.error('[api/config] atualização recusada:', error.message);
    res.status(400).json({ error: error.message || 'Erro ao salvar as configurações.' });
  }
});

app.get('/api/discord-data', requireAuth, async (req, res) => {
  try {
    const cfg = await Config.findOne({ key: 'main' }).lean();
    const guildId =
      (cfg && cfg.data && cfg.data.guild_id) ||
      process.env.SERVER_PRINCIPAL_ID ||
      process.env.EXTERNAL_GUILD_ID;

    if (!guildId || !process.env.DISCORD_TOKEN) {
      return res.json({ ch: [], vc: [], cat: [], role: [] });
    }

    const headers = { Authorization: 'Bot ' + process.env.DISCORD_TOKEN };
    const [channelsResponse, rolesResponse] = await Promise.all([
      axios.get('https://discord.com/api/v10/guilds/' + encodeURIComponent(guildId) + '/channels', { headers, timeout: 15000 }),
      axios.get('https://discord.com/api/v10/guilds/' + encodeURIComponent(guildId) + '/roles', { headers, timeout: 15000 }),
    ]);

    const data = { ch: [], vc: [], cat: [], role: [] };
    channelsResponse.data.forEach((channel) => {
      const item = { id: channel.id, name: channel.name };
      if (channel.type === 0 || channel.type === 5) data.ch.push(item);
      if (channel.type === 2) data.vc.push(item);
      if (channel.type === 4) data.cat.push(item);
    });
    rolesResponse.data
      .sort((a, b) => b.position - a.position)
      .forEach((role) => {
        if (role.name !== '@everyone') data.role.push({ id: role.id, name: role.name });
      });
    res.json(data);
  } catch (error) {
    console.error('[api/discord-data]', error.response && error.response.status ? error.response.status : error.message);
    res.status(502).json({ error: 'Não foi possível carregar os dados do Discord.' });
  }
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.get('/index.html', requireAuth, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(express.static(publicDir, { index: false, dotfiles: 'deny', fallthrough: true }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada.' });
  res.status(404).send('Página não encontrada.');
});

server.listen(port, '0.0.0.0', () => {
  console.log('Dashboard PXK protegido e disponível na porta ' + port);
});

server.on('error', (error) => {
  console.error('[dashboard] falha no servidor HTTP:', error);
  process.exitCode = 1;
});
