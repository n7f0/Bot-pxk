// src/dashboard.js
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const { Config } = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

module.exports.io = io;

app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, '../public'))); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.PANEL_SECRET || 'secret', resave: false, saveUninitialized: false, cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } }));

// ================= API DO SITE =================
app.get('/api/config', async (req, res) => {
    try {
        const cfg = await Config.findOne({ key: 'main' }).lean();
        res.json(cfg?.data || {});
    } catch (e) {
        res.status(500).json({ error: 'Erro ao carregar configurações.' });
    }
});

app.post('/api/config', async (req, res) => {
    try {
        await Config.findOneAndUpdate({ key: 'main' }, { $set: { data: req.body } }, { upsert: true });
        // Avisa o bot em tempo real (WebSocket)
        io.emit('config_updated', req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao salvar.' });
    }
});

// ================= AUTENTICAÇÃO DISCORD =================
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.get('/auth', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauth_state = state;
    const params = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, redirect_uri: `${process.env.BASE_URL}/callback`, response_type: 'code', scope: 'identify guilds', state });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/callback', async (req, res) => {
    if (req.query.state !== req.session.oauth_state) return res.redirect('/');
    try {
        const token = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: req.query.code, redirect_uri: `${process.env.BASE_URL}/callback` }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const user = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.data.access_token}` } });
        
        const owners = (process.env.OWNER_IDS || '').split(',').map(i=>i.trim()).filter(i=>i);
        if (!owners.includes(user.data.id)) {
            return res.status(403).send(`<body style="background:#050308; color:#fff; text-align:center; padding-top:20vh; font-family:sans-serif;"><h1>Acesso Negado</h1><p>Seu ID é: <b>${user.data.id}</b></p><p>Coloque este ID na variável OWNER_IDS no .env</p></body>`);
        }
        req.session.user = user.data; 
        req.session.save(() => res.redirect('/'));
    } catch (e) { res.status(400).send("Falha na autenticação."); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });
const requireAuth = (req, res, next) => { if (!req.session.user) return res.redirect('/login'); next(); };

// ================= ROTA PRINCIPAL =================
app.get('/', requireAuth, async (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Busca canais e cargos do Discord para preencher os menus no site
app.get('/api/discord-data', requireAuth, async (req, res) => {
    try {
        const cfg = await Config.findOne({ key: 'main' }).lean();
        const guildId = cfg?.data?.guild_id;
        if (!guildId || !process.env.DISCORD_TOKEN) return res.json({ ch: [], vc: [], cat: [], role: [] });

        const headers = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };
        const [chs, roles] = await Promise.all([
            axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
            axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers })
        ]);
        
        const data = { ch: [], vc: [], cat: [], role: [] };
        chs.data.forEach(c => {
            if (c.type === 0 || c.type === 5) data.ch.push({ id: c.id, name: `# ${c.name}` });
            if (c.type === 2) data.vc.push({ id: c.id, name: `🔊 ${c.name}` });
            if (c.type === 4) data.cat.push({ id: c.id, name: c.name });
        });
        roles.data.forEach(r => { if (r.name !== '@everyone') data.role.push({ id: r.id, name: `@${r.name}` }); });
        res.json(data);
    } catch (e) {
        res.json({ ch: [], vc: [], cat: [], role: [] });
    }
});

server.listen(8080, '0.0.0.0', () => console.log('🌐 Dashboard e WebSocket rodando na porta 8080'));
