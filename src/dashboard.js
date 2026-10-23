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
app.use(session({ secret: process.env.PANEL_SECRET || 'pxk_secret_super_seguro', resave: false, saveUninitialized: false, cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } }));

// ================= API DO SITE =================
app.get('/api/config', async (req, res) => {
    try {
        const cfg = await Config.findOne({ key: 'main' }).lean();
        res.json(cfg?.data || {});
    } catch (e) { res.status(500).json({ error: 'Erro ao carregar.' }); }
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
        const guildId = cfg?.data?.guild_id || process.env.SERVER_PRINCIPAL_ID || process.env.EXTERNAL_GUILD_ID;
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
        rolesRes.data.sort((a,b) => b.position - a.position).forEach(r => { 
            if (r.name !== '@everyone') data.role.push({ id: r.id, name: `@${r.name}` }); 
        });
        res.json(data);
    } catch (e) { res.json({ ch: [], vc: [], cat: [], role: [] }); }
});

// ================= AUTENTICAÇÃO =================
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));

app.get('/auth', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauth_state = state;
    const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
    const params = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, redirect_uri: `${baseUrl}/callback`, response_type: 'code', scope: 'identify guilds', state });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/callback', async (req, res) => {
    if (req.query.state !== req.session.oauth_state) return res.redirect('/login');
    const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
    try {
        const token = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: req.query.code, redirect_uri: `${baseUrl}/callback` }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const user = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.data.access_token}` } });
        
        // CORREÇÃO AQUI: Lendo OWNER_IDS e DEV_IDS
        const owners = (process.env.OWNER_IDS || '').split(',').map(i => i.trim()).filter(i => i);
        const devs = (process.env.DEV_IDS || '').split(',').map(i => i.trim()).filter(i => i);
        const allowedIds = [...new Set([...owners, ...devs])]; // Junta os dois e remove duplicados

        if (!allowedIds.includes(user.data.id)) {
            // TELA DE ACESSO NEGADO BONITA
            return res.status(403).send(`
                <!DOCTYPE html>
                <html lang="pt-BR">
                <head>
                    <meta charset="UTF-8">
                    <title>Acesso Negado - PXK</title>
                    <style>
                        @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;600&display=swap');
                        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
                        body { 
                            background: radial-gradient(circle at 50% 50%, rgba(255, 51, 102, 0.15) 0%, transparent 50%), #050308; 
                            color: #fff; height: 100vh; display: flex; align-items: center; justify-content: center; 
                        }
                        .card { 
                            background: rgba(20, 10, 15, 0.7); backdrop-filter: blur(20px); 
                            border: 1px solid rgba(255, 51, 102, 0.3); border-top: 3px solid #FF3366; 
                            padding: 50px; border-radius: 24px; text-align: center; max-width: 500px; width: 100%;
                            box-shadow: 0 20px 50px rgba(0,0,0,0.8), 0 0 20px rgba(255,51,102,0.2);
                        }
                        h1 { font-family: 'Archivo Black'; font-size: 32px; color: #FF3366; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 1px; }
                        p { color: #B8B8C2; font-size: 15px; margin-bottom: 10px; line-height: 1.6; }
                        .id-box { 
                            background: rgba(0,0,0,0.5); border: 1px dashed rgba(255, 51, 102, 0.5); 
                            padding: 15px; border-radius: 12px; font-family: monospace; font-size: 18px; color: #fff; 
                            margin: 20px 0; user-select: all; cursor: pointer; transition: 0.2s;
                        }
                        .id-box:hover { background: rgba(255, 51, 102, 0.1); border-color: #FF3366; }
                        .btn { 
                            display: inline-block; margin-top: 20px; padding: 14px 32px; background: rgba(255,255,255,0.05); 
                            border: 1px solid rgba(255,255,255,0.1); color: #fff; text-decoration: none; border-radius: 99px; 
                            font-weight: 600; transition: 0.2s; 
                        }
                        .btn:hover { background: #fff; color: #000; transform: translateY(-2px); }
                        .hint { font-size: 12px; color: #7A7A88; margin-top: 20px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>Acesso Negado 🚫</h1>
                        <p>Você não tem permissão para acessar este painel.</p>
                        <p>Seu ID do Discord é:</p>
                        <div class="id-box" title="Clique para selecionar">${user.data.id}</div>
                        <p>Copie o ID acima e adicione-o à variável <b>DEV_IDS</b> ou <b>OWNER_IDS</b> no seu arquivo <code>.env</code>.</p>
                        <a href="/login" class="btn">Tentar Novamente</a>
                        <div class="hint">Após adicionar, reinicie o bot para aplicar as mudanças.</div>
                    </div>
                </body>
                </html>
            `);
        }
        
        req.session.user = user.data; 
        req.session.save(() => res.redirect('/'));
    } catch (e) { 
        console.error('Erro OAuth:', e.message);
        res.status(400).send("Falha na autenticação."); 
    }
});

app.get('/logout', (req, res) => { 
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/login'); 
    });
});

const requireAuth = (req, res, next) => { if (!req.session.user) return res.redirect('/login'); next(); };

app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

server.listen(8080, '0.0.0.0', () => console.log('🌐 Dashboard e WebSocket rodando na porta 8080'));
