const express = require('express');
const session = require('express-session');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const flash = require('connect-flash');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Exporta o io para o bot usar
module.exports.io = io;

const CONFIG_FILE = path.join(__dirname, '../data', 'config.json');
if (!fs.existsSync(path.join(__dirname, '../data'))) fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });

const DEFAULT_CONFIG = { brand_name: "𝚙𝚡𝚔", brand_emoji: "🖤", levels_enabled: true, guild_id: "" };
const getConfig = () => { try { if (!fs.existsSync(CONFIG_FILE)) return DEFAULT_CONFIG; return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch { return DEFAULT_CONFIG; } };
const saveConfig = (cfg) => fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 4));

app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, '../public'))); 
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.PANEL_SECRET || 'secret', resave: false, saveUninitialized: false, cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } }));
app.use(flash());

// ================= TELA DE LOGIN PREMIUM =================
app.get('/login', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PXKK — Dashboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
            :root { --purple: #8A4FFF; --black: #040404; --white: #fff; --gray: #B8B8C2; }
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
            body { background: radial-gradient(circle at 15% 10%, rgba(138,79,255,0.15) 0%, transparent 50%), radial-gradient(circle at 85% 90%, rgba(138,79,255,0.08) 0%, transparent 50%), var(--black); color: var(--white); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
            .container { display: flex; max-width: 1000px; width: 100%; padding: 20px; gap: 40px; align-items: center; flex-wrap: wrap; }
            .hero { flex: 1; min-width: 300px; }
            .hero h1 { font-family: 'Archivo Black', sans-serif; font-size: clamp(32px, 5vw, 64px); line-height: 1; text-transform: uppercase; margin-bottom: 20px; }
            .hero h1 span { color: var(--purple); }
            .hero p { color: var(--gray); font-size: 16px; line-height: 1.6; }
            .card { background: rgba(10,10,10,0.6); border: 1px solid rgba(255,255,255,0.1); border-top: 1px solid var(--purple); backdrop-filter: blur(24px); padding: 50px; border-radius: 32px; width: 100%; max-width: 400px; text-align: center; }
            .card h2 { font-family: 'Archivo Black', sans-serif; font-size: 28px; margin-bottom: 10px; text-transform: uppercase; }
            .card p { color: var(--gray); margin-bottom: 30px; font-size: 14px; }
            .btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 18px; background: linear-gradient(135deg, var(--purple), #6B2EE0); color: #fff; text-decoration: none; border-radius: 99px; font-weight: 700; transition: 0.2s; }
            .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(138,79,255,0.4); }
            @media(max-width: 768px) { .container { flex-direction: column; justify-content: center; text-align: center; } .hero { display: none; } }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="hero"><h1>Gerencie seu<br>servidor com<br><span>precisão total.</span></h1><p>Toda a configuração do seu bot em um painel único, seguro e intuitivo.</p></div>
            <div class="card">
                <h2>Bem-vindo</h2><p>Autentique-se com sua conta do Discord para acessar o painel.</p>
                <a href="/auth" class="btn"><svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.3.5a14.7 14.7 0 0 1 4.3 2.2 15 15 0 0 0-12.8 0A14.6 14.6 0 0 1 10.9 3.5L10.6 3a19.7 19.7 0 0 0-4.9 1.4C2.6 8.6 1.9 12.7 2.3 16.7a19.8 19.8 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14 14 0 0 0 12.8 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.8 19.8 0 0 0 6-3c.5-4.6-.7-8.6-3.4-12.3ZM9 14.6c-1.2 0-2.2-1.1-2.2-2.4S7.8 9.8 9 9.8s2.2 1.1 2.2 2.4S10.2 14.6 9 14.6Zm6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg> Entrar com Discord</a>
            </div>
        </div>
    </body>
    </html>`);
});

// ================= OAUTH =================
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
        const owners = (process.env.OWNER_IDS || '').split(',').map(i=>i.trim()).filter(i=>i);
        if (!owners.includes(user.data.id)) return res.status(403).send("Acesso Negado.");
        req.session.user = user.data; 
        req.session.save(() => res.redirect('/'));
    } catch (e) { res.status(400).send("Falha na autenticação."); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });
const requireAuth = (req, res, next) => { if (!req.session.user) return res.redirect('/login'); next(); };

// ================= DASHBOARD DE CONFIGURAÇÃO =================
app.get('/', requireAuth, (req, res) => {
    res.send(`<h1>Painel de Configuração</h1><p>Em breve.</p><a href="/chat">Ir para o Chat em Tempo Real</a>`);
});

// ================= CHAT EM TEMPO REAL =================
app.get('/chat', requireAuth, (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Live Chat - PXKK</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
            body { background: #040404; color: #fff; font-family: 'Inter', sans-serif; margin: 0; padding: 20px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; color: #8A4FFF; }
            .header a { color: #f87171; text-decoration: none; font-weight: bold; }
            #chat-box { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; padding-right: 10px; }
            .message { display: flex; gap: 15px; background: #111; padding: 15px; border-radius: 12px; border-left: 4px solid #8A4FFF; }
            .avatar { width: 40px; height: 40px; border-radius: 50%; border: 2px solid #333; }
            .content { display: flex; flex-direction: column; gap: 5px; }
            .author { font-weight: 800; font-size: 14px; color: #A370FF; display: flex; align-items: center; gap: 8px; }
            .time { font-size: 12px; color: #7A7A88; font-weight: 400; }
            .channel { background: #333; padding: 2px 8px; border-radius: 4px; font-size: 10px; color: #fff; }
            .text { font-size: 15px; line-height: 1.4; }
            /* Scrollbar */
            ::-webkit-scrollbar { width: 8px; }
            ::-webkit-scrollbar-track { background: #040404; }
            ::-webkit-scrollbar-thumb { background: #8A4FFF; border-radius: 4px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>📺 Live Chat do Servidor</h1>
            <a href="/logout">Sair</a>
        </div>
        <div id="chat-box"></div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            const chatBox = document.getElementById('chat-box');

            socket.on('discord_message', (data) => {
                const msgDiv = document.createElement('div');
                msgDiv.className = 'message';
                msgDiv.innerHTML = \`
                    <img src="\${data.avatar}" class="avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                    <div class="content">
                        <div class="author">
                            \${data.author} 
                            <span class="channel">#\${data.channel}</span>
                            <span class="time">\${data.time}</span>
                        </div>
                        <div class="text">\${data.content}</div>
                    </div>
                \`;
                chatBox.appendChild(msgDiv);
                chatBox.scrollTop = chatBox.scrollHeight; // Rola para o final automaticamente
            });
        </script>
    </body>
    </html>`);
});

server.listen(8080, '0.0.0.0', () => console.log('🌐 Dashboard e WebSocket rodando na porta 8080'));