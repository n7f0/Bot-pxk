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
app.get('/login', (req, res) => {
    // HTML EMBUTIDO DA TELA DE LOGIN
    res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PXK - Login</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;600;800&display=swap');
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
            
            body { 
                background: #050308; 
                height: 100vh; display: flex; align-items: center; justify-content: center; 
                overflow: hidden; position: relative;
            }

            /* Fundo animado com degradê */
            body::before {
                content: ''; position: absolute; width: 200vw; height: 200vh;
                background: radial-gradient(circle at 20% 30%, rgba(138,79,255,0.25) 0%, transparent 40%),
                            radial-gradient(circle at 80% 70%, rgba(255,51,102,0.15) 0%, transparent 40%),
                            radial-gradient(circle at 50% 50%, rgba(138,79,255,0.1) 0%, transparent 50%);
                animation: rotateBg 20s linear infinite;
                z-index: -1;
            }

            @keyframes rotateBg {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            .login-card { 
                background: rgba(15, 12, 20, 0.6); 
                backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
                border: 1px solid rgba(255,255,255,0.08); border-top: 1px solid rgba(138,79,255,0.6); 
                padding: 50px 40px; border-radius: 32px; text-align: center; 
                width: 100%; max-width: 420px; 
                box-shadow: 0 30px 60px rgba(0,0,0,0.8), 0 0 40px rgba(138,79,255,0.1);
                animation: fadeIn 0.8s ease-out;
            }

            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }

            .logo { width: 80px; height: 80px; border-radius: 16px; margin-bottom: 20px; box-shadow: 0 10px 20px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); }
            
            h1 { font-family: 'Archivo Black'; font-size: 28px; text-transform: uppercase; margin-bottom: 8px; letter-spacing: -1px; }
            p { color: #B8B8C2; font-size: 14px; margin-bottom: 35px; line-height: 1.5; }
            
            .btn-discord { 
                display: flex; align-items: center; justify-content: center; gap: 12px; 
                width: 100%; padding: 18px; 
                background: linear-gradient(135deg, #8A4FFF, #6B2EE0); 
                color: #fff; text-decoration: none; border-radius: 16px; 
                font-weight: 800; font-size: 15px; text-transform: uppercase; letter-spacing: 1px;
                transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); 
                box-shadow: 0 10px 20px rgba(138,79,255,0.3);
                border: 1px solid rgba(255,255,255,0.2);
                position: relative; overflow: hidden;
            }

            .btn-discord::after {
                content: ''; position: absolute; top: 0; left: -100%; width: 100%; height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
                transition: 0.5s;
            }

            .btn-discord:hover { 
                transform: translateY(-3px); 
                box-shadow: 0 15px 30px rgba(138,79,255,0.5); 
                background: linear-gradient(135deg, #A370FF, #8A4FFF);
            }

            .btn-discord:hover::after { left: 100%; }
            .btn-discord svg { width: 24px; height: 24px; fill: currentColor; }

            .footer-text { margin-top: 30px; font-size: 12px; color: #7A7A88; }
            .footer-text b { color: #8A4FFF; }
        </style>
    </head>
    <body>
        <div class="login-card">
            <img src="/logo.gif" alt="PXK Logo" class="logo" onerror="this.style.display='none'">
            <h1>PXK System</h1>
            <p>Autentique-se com sua conta do Discord para acessar o painel administrativo.</p>
            
            <a href="/auth" class="btn-discord">
                <svg viewBox="0 0 24 24"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.3.5a14.7 14.7 0 0 1 4.3 2.2 15 15 0 0 0-12.8 0A14.6 14.6 0 0 1 10.9 3.5L10.6 3a19.7 19.7 0 0 0-4.9 1.4C2.6 8.6 1.9 12.7 2.3 16.7a19.8 19.8 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14 14 0 0 0 12.8 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.8 19.8 0 0 0 6-3c.5-4.6-.7-8.6-3.4-12.3ZM9 14.6c-1.2 0-2.2-1.1-2.2-2.4S7.8 9.8 9 9.8s2.2 1.1 2.2 2.4S10.2 14.6 9 14.6Zm6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
                Entrar com Discord
            </a>

            <div class="footer-text">
                &copy; 2026 <b>PXK</b> - Todos os direitos reservados.
            </div>
        </div>
    </body>
    </html>
    `);
});

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

        console.log('IDs permitidos (OWNER_IDS + DEV_IDS):', allowedIds);
        console.log('Seu ID:', user.data.id);

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
