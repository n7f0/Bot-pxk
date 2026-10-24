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
app.use(session({ secret: process.env.PANEL_SECRET || 'pxk_secret', resave: false, saveUninitialized: false, cookie: { maxAge: 86400000 } }));

app.get('/api/me', (req, res) => { if (req.session.user) res.json(req.session.user); else res.status(401).json({ error: 'Não autenticado' }); });

app.get('/api/config', async (req, res) => {
    try { const cfg = await Config.findOne({ key: 'main' }).lean(); res.json(cfg?.data || {}); } catch (e) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/api/config', async (req, res) => {
    try {
        await Config.findOneAndUpdate({ key: 'main' }, { $set: { data: req.body } }, { upsert: true });
        io.emit('config_updated', req.body);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Erro ao salvar.' }); }
});

app.get('/api/discord-data', async (req, res) => {
    try {
        const cfg = await Config.findOne({ key: 'main' }).lean();
        const guildId = cfg?.data?.guild_id || process.env.SERVER_PRINCIPAL_ID;
        if (!guildId || !process.env.DISCORD_TOKEN) return res.json({ ch: [], vc: [], cat: [], role: [] });
        const headers = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };
        const [chsRes, rolesRes] = await Promise.all([
            axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
            axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers })
        ]);
        const data = { ch: [], vc: [], cat: [], role: [] };
        chsRes.data.forEach(c => {
            if (c.type === 0 || c.type === 5) data.ch.push({ id: c.id, name: `# ${c.name}` });
            if (c.type === 2) data.vc.push({ id: c.id, name: `🔊 ${c.name}` });
            if (c.type === 4) data.cat.push({ id: c.id, name: c.name });
        });
        rolesRes.data.sort((a,b) => b.position - a.position).forEach(r => { if (r.name !== '@everyone') data.role.push({ id: r.id, name: `@${r.name}` }); });
        res.json(data);
    } catch (e) { res.json({ ch: [], vc: [], cat: [], role: [] }); }
});

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/auth', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauth_state = state;
    const params = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, redirect_uri: `${process.env.BASE_URL}/callback`, response_type: 'code', scope: 'identify guilds', state });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});
app.get('/callback', async (req, res) => {
    if (req.query.state !== req.session.oauth_state) return res.redirect('/login');
    try {
        const token = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: req.query.code, redirect_uri: `${process.env.BASE_URL}/callback` }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const user = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.data.access_token}` } });
        const allowed = [...(process.env.OWNER_IDS||'').split(','), ...(process.env.DEV_IDS||'').split(',')].map(i=>i.trim()).filter(Boolean);
        if (!allowed.includes(user.data.id)) return res.redirect(`/acesso-negado.html?id=${user.data.id}`);
        req.session.user = user.data; 
        req.session.save(() => res.redirect('/'));
    } catch (e) { res.status(400).send("Falha na autenticação."); }
});
app.get('/logout', (req, res) => { req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/login'); }); });

const requireAuth = (req, res, next) => { if (!req.session.user) return res.redirect('/login'); next(); };
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

server.listen(8080, '0.0.0.0', () => console.log('🌐 Dashboard rodando na porta 8080'));