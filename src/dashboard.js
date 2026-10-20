const express = require('express');
const session = require('express-session');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const flash = require('connect-flash');

const app = express();
const CONFIG_FILE = path.join(__dirname, '../data', 'config.json');

if (!fs.existsSync(path.join(__dirname, '../data'))) fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });

const DEFAULT_CONFIG = {
    brand_name: "𝚙𝚡𝚔", brand_emoji: "🖤", brand_footer: "🖤 𝚙𝚡𝚔 • Sistema Oficial",
    levels_enabled: true, levels_xp_per_message: 15, levels_xp_cooldown_seconds: 60,
    verification_enabled: true, ticket_panel_title: "🎫 Central de Tickets"
};

const getConfig = () => {
    try {
        if (!fs.existsSync(CONFIG_FILE)) return DEFAULT_CONFIG;
        return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    } catch { return DEFAULT_CONFIG; }
};
const saveConfig = (cfg) => fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 4));

app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public'))); 
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.PANEL_SECRET || 'secret', resave: false, saveUninitialized: false, cookie: { secure: process.env.BASE_URL.startsWith('https') } }));
app.use(flash());

// ================= AUTH E LOGIN =================
app.get('/login', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
        <meta name="theme-color" content="#000000">
        <title>PXKK — Dashboard</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
            :root {
                --black: #050505; --black-soft: #0a0a0a; --purple: #8A4FFF;
                --purple-hi: #A370FF; --purple-lo: #6B2EE0; --purple-glow: rgba(138,79,255,0.4);
                --white: #FFFFFF; --white-soft: #F5F5F5; --gray-hi: #B8B8C2;
                --gray-mid: #7A7A88; --border: rgba(255,255,255,0.08); --border-hi: rgba(138,79,255,0.35);
                --radius: 24px; --radius-lg: 32px; --radius-pill: 99px;
                --ease: cubic-bezier(0.4, 0, 0.2, 1); --shadow-soft: 0 10px 40px -10px rgba(0,0,0,0.8);
            }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { background: var(--black); color: var(--white-soft); font-family: 'Inter', sans-serif; font-size: 15px; line-height: 1.6; -webkit-font-smoothing: antialiased; min-height: 100vh; overflow-x: hidden; }
            a { color: var(--purple-hi); text-decoration: none; transition: color .18s var(--ease); }
            img { display: block; max-width: 100%; }

            .login-page {
                min-height: 100vh; display: grid; grid-template-columns: 1.2fr 1fr;
                background: radial-gradient(circle at 15% 10%, rgba(138,79,255,0.15) 0%, transparent 50%), radial-gradient(circle at 85% 90%, rgba(138,79,255,0.08) 0%, transparent 50%), #040404;
                position: relative; gap: 0;
            }
            .login-page::before {
                content: ''; position: absolute; inset: 0;
                background-image: linear-gradient(rgba(255,255,255,.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.02) 1px, transparent 1px);
                background-size: 64px 64px;
                mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, #000 20%, transparent 90%);
                -webkit-mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, #000 20%, transparent 90%);
                pointer-events: none; z-index: 0;
            }

            .hero { position: relative; padding: 80px 10%; display: flex; flex-direction: column; justify-content: space-between; z-index: 1; }
            .hero-brand { display: flex; align-items: center; gap: 16px; font-family: 'Archivo Black', sans-serif; font-size: 28px; letter-spacing: -0.04em; color: var(--white); }
            .hero-brand .mark { width: 68px; height: 68px; display: grid; place-items: center; background: radial-gradient(circle at 30% 30%, rgba(138,79,255,.15), transparent 70%); border-radius: var(--radius); overflow: hidden; }
            .hero-mid { max-width: 700px; margin: 40px 0; }
            .hero-mid h1 { font-family: 'Archivo Black', sans-serif; font-size: clamp(36px, 5vw, 72px); line-height: 0.95; color: var(--white); margin-bottom: 28px; letter-spacing: -0.045em; text-transform: uppercase; }
            .hero-mid h1 .accent { color: var(--purple); text-shadow: 0 0 40px var(--purple-glow); }
            .hero-mid p { font-size: 16px; color: var(--gray-hi); line-height: 1.7; max-width: 500px; }
            .hero-bottom { display: flex; align-items: center; gap: 24px; font-size: 12px; color: var(--gray-mid); font-weight: 600; }
            .divider { width: 1px; height: 12px; background: var(--border); }

            .login-panel { display: flex; align-items: center; justify-content: center; padding: 48px 32px; z-index: 1; }
            .login-card { position: relative; width: 100%; max-width: 440px; padding: 56px 48px; border: 1px solid var(--border); border-top: 1px solid var(--border-hi); background: rgba(10, 10, 10, 0.6); backdrop-filter: blur(24px); border-radius: var(--radius-lg); box-shadow: var(--shadow-soft); }
            .login-card::before { content: ''; position: absolute; top: -1px; left: 40px; right: 40px; height: 1px; background: linear-gradient(90deg, transparent, var(--purple), transparent); opacity: .8; border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
            
            .card-head { margin-bottom: 40px; text-align: center; }
            .mini-tag { display: inline-block; font-size: 10px; font-weight: 800; color: var(--white); background: rgba(138,79,255,0.15); border: 1px solid rgba(138,79,255,0.3); padding: 6px 14px; border-radius: var(--radius-pill); letter-spacing: .2em; margin-bottom: 20px; text-transform: uppercase; }
            .card-head h2 { font-family: 'Archivo Black', sans-serif; font-size: 34px; color: var(--white); margin-bottom: 12px; text-transform: uppercase; line-height: 1.1; }
            .card-head p { font-size: 14px; color: var(--gray-hi); }

            .btn-discord { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 18px 28px; background: linear-gradient(135deg, var(--purple) 0%, #6B2EE0 100%); color: var(--white); font-weight: 700; font-size: 15px; border-radius: var(--radius-pill); box-shadow: 0 12px 30px -8px rgba(138,79,255,0.5); transition: all .25s var(--ease); position: relative; overflow: hidden; }
            .btn-discord:hover { background: linear-gradient(135deg, #A370FF 0%, #8A4FFF 100%); box-shadow: 0 16px 40px -8px rgba(138,79,255,0.7); transform: translateY(-2px); color: var(--white); }
            
            .login-foot { margin-top: 32px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; font-size: 10px; font-weight: 700; text-transform: uppercase; }
            .status-pill { display: flex; align-items: center; gap: 6px; color: #86efac; }
            .status-dot { width: 6px; height: 6px; background: #4ade80; border-radius: 50%; box-shadow: 0 0 10px #4ade80; }
            .secure-pill { display: flex; align-items: center; gap: 6px; color: var(--gray-hi); }

            @media(max-width: 960px) {
                .login-page { grid-template-columns: 1fr; }
                .hero { padding: 40px 24px 20px; }
                .hero-mid h1 { font-size: clamp(32px, 8vw, 48px); }
                .hero-bottom { display: none; }
                .login-panel { padding: 20px 24px 40px; }
                .login-card { padding: 40px 28px; }
            }
        </style>
    </head>
    <body>
        <main class="login-page">
            <section class="hero">
                <div class="hero-brand">
                    <span class="mark"><img src="/logo.gif" alt="Logo"></span>
                    <span class="name">PXKK</span>
                </div>
                <div class="hero-mid">
                    <h1>Gerencie seu<br>servidor com<br><span class="accent">precisão total.</span></h1>
                    <p>Toda a configuração do seu bot em um painel único, seguro e intuitivo. Controle tickets, verificação, níveis e muito mais.</p>
                </div>
                <div class="hero-bottom">
                    <div><b>OAuth2</b> Discord</div><span class="divider"></span>
                    <div><b>Cloudflare</b></div><span class="divider"></span>
                    <div><b>100%</b> real-time</div>
                </div>
            </section>
            <section class="login-panel">
                <div class="login-card">
                    <div class="card-head">
                        <span class="mini-tag">Autenticação</span>
                        <h2>Bem-vindo<br>de volta</h2>
                        <p>Autentique-se com sua conta do Discord para acessar o painel administrativo.</p>
                    </div>
                    <a href="/auth" class="btn-discord">
                        <span style="display: flex; align-items: center; gap: 10px;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.3.5a14.7 14.7 0 0 1 4.3 2.2 15 15 0 0 0-12.8 0A14.6 14.6 0 0 1 10.9 3.5L10.6 3a19.7 19.7 0 0 0-4.9 1.4C2.6 8.6 1.9 12.7 2.3 16.7a19.8 19.8 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14 14 0 0 0 12.8 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.8 19.8 0 0 0 6-3c.5-4.6-.7-8.6-3.4-12.3ZM9 14.6c-1.2 0-2.2-1.1-2.2-2.4S7.8 9.8 9 9.8s2.2 1.1 2.2 2.4S10.2 14.6 9 14.6Zm6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
                            Entrar com Discord
                        </span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                    </a>
                    <div class="login-foot">
                        <div class="status-pill"><span class="status-dot"></span> Online</div>
                        <div class="secure-pill">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg> Seguro
                        </div>
                    </div>
                </div>
            </section>
        </main>
    </body>
    </html>`;
    res.send(html);
});

app.get('/auth', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauth_state = state;
    const params = new URLSearchParams({ 
        client_id: process.env.DISCORD_CLIENT_ID, 
        redirect_uri: `${process.env.BASE_URL}/callback`, 
        response_type: 'code', 
        scope: 'identify guilds', 
        state 
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/callback', async (req, res) => {
    if (req.query.state !== req.session.oauth_state) return res.redirect('/login');
    try {
        const token = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ 
            client_id: process.env.DISCORD_CLIENT_ID, 
            client_secret: process.env.DISCORD_CLIENT_SECRET, 
            grant_type: 'authorization_code', 
            code: req.query.code, 
            redirect_uri: `${process.env.BASE_URL}/callback` 
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        
        const user = await axios.get('https://discord.com/api/users/@me', { 
            headers: { Authorization: `Bearer ${token.data.access_token}` } 
        });
        
        const userId = user.data.id;
        const owners = (process.env.OWNER_IDS || '').split(',').map(i => i.trim()).filter(i => i);
        const devs = (process.env.DEV_IDS || '').split(',').map(i => i.trim()).filter(i => i);

        console.log(`[LOGIN] Tentativa do ID: ${userId}`);

        if (!owners.includes(userId) && !devs.includes(userId)) {
            return res.status(403).send(`
                <body style="background:#040404; color:#fff; font-family:sans-serif; display:grid; place-items:center; height:100vh; text-align:center;">
                    <div>
                        <h1 style="color:#f87171; font-size: 40px;">Acesso Negado 🚫</h1>
                        <p>O ID <b>${userId}</b> não tem permissão.</p>
                        <p style="color:#7A7A88;">Se este é o seu ID, copie e coloque no campo <b>OWNER_IDS</b> no Portainer.</p>
                        <a href="/login" style="color:#8A4FFF; margin-top: 20px; display: block;">Voltar</a>
                    </div>
                </body>
            `);
        }

        req.session.user = user.data;
        req.session.user.role = devs.includes(userId) ? 'dev' : 'owner';
        req.session.save(() => res.redirect('/'));

    } catch (e) { 
        res.status(400).send("Falha na autenticação."); 
    }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// ================= DASHBOARD =================
const requireAuth = (req, res, next) => { if (!req.session.user) return res.redirect('/login'); next(); };

app.get('/', requireAuth, (req, res) => {
    const cfg = getConfig();
    const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dashboard - PXKK</title>
    <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        body { background: #040404; color: #fff; font-family: 'Inter', sans-serif; margin: 0; padding: 20px; background-image: radial-gradient(circle at 15% 10%, rgba(138,79,255,0.15) 0%, transparent 50%); }
        .nav { display: flex; justify-content: space-between; align-items: center; background: rgba(10,10,10,0.8); padding: 15px 30px; border-radius: 99px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 40px; }
        .container { max-width: 900px; margin: 0 auto; background: rgba(10,10,10,0.6); padding: 40px; border-radius: 32px; border: 1px solid rgba(255,255,255,0.1); }
        h1 { font-family: 'Archivo Black', sans-serif; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 30px; }
        .field { display: flex; flex-direction: column; gap: 8px; }
        label { font-size: 12px; font-weight: 700; color: #B8B8C2; text-transform: uppercase; }
        input[type="text"], input[type="number"] { width: 100%; padding: 16px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; color: #fff; outline: none; box-sizing: border-box; }
        input:focus { border-color: #8A4FFF; }
        .btn { background: #8A4FFF; color: #fff; padding: 18px 32px; border: none; border-radius: 99px; font-weight: 800; cursor: pointer; width: 100%; margin-top: 30px; transition: 0.2s; }
        .btn:hover { background: #A370FF; transform: translateY(-2px); }
        .switch { display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.3); padding: 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; }
        @media(max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    </style></head><body>
    <div class="nav">
        <div style="display: flex; align-items: center; gap: 15px;">
            <img src="/logo.gif" width="40" style="border-radius: 50%;">
            <b style="font-family: 'Archivo Black';">PXKK Dashboard</b>
        </div>
        <div style="display: flex; align-items: center; gap: 15px;">
            <img src="https://cdn.discordapp.com/avatars/${req.session.user.id}/${req.session.user.avatar}.png" width="35" style="border-radius: 50%;">
            <b>${req.session.user.username}</b>
            <a href="/logout" style="color: #f87171; text-decoration: none; font-weight: 700;">Sair</a>
        </div>
    </div>

    <div class="container">
        <h1>Configurações do Bot</h1>
        <p style="color: #7A7A88;">As alterações são aplicadas em tempo real no bot.</p>
        
        ${req.flash('success').length ? `<div style="background: rgba(74,222,128,0.1); border: 1px solid #4ade80; padding: 15px; border-radius: 10px; color: #4ade80; margin-bottom: 20px;">Configurações salvas!</div>` : ''}

        <form method="POST">
            <div class="grid">
                <div class="field">
                    <label>Nome da Marca</label>
                    <input type="text" name="brand_name" value="${cfg.brand_name}">
                </div>
                <div class="field">
                    <label>Emoji da Marca</label>
                    <input type="text" name="brand_emoji" value="${cfg.brand_emoji}">
                </div>
                
                <div class="field">
                    <label>XP por Mensagem</label>
                    <input type="number" name="levels_xp_per_message" value="${cfg.levels_xp_per_message}">
                </div>
                <div class="field">
                    <label>Cooldown XP (Segundos)</label>
                    <input type="number" name="levels_xp_cooldown_seconds" value="${cfg.levels_xp_cooldown_seconds}">
                </div>

                <div class="field" style="grid-column: span 2;">
                    <label>Categoria: MOV CALL (ID)</label>
                    <input type="text" name="ticket_category_movcall_id" value="${cfg.ticket_category_movcall_id || ''}">
                </div>
                <div class="field" style="grid-column: span 2;">
                    <label>Categoria: SUPORTE (ID)</label>
                    <input type="text" name="ticket_category_support_id" value="${cfg.ticket_category_support_id || ''}">
                </div>
                
                <div class="field" style="grid-column: span 2;">
                    <label class="switch">
                        <input type="checkbox" name="levels_enabled" ${cfg.levels_enabled ? 'checked' : ''}> 
                        Ativar Sistema de Níveis
                    </label>
                </div>
                <div class="field" style="grid-column: span 2;">
                    <label class="switch">
                        <input type="checkbox" name="verification_enabled" ${cfg.verification_enabled ? 'checked' : ''}> 
                        Ativar Sistema de Verificação
                    </label>
                </div>
            </div>
            <button type="submit" class="btn">Salvar Alterações</button>
        </form>
    </div></body></html>`;
    res.send(html);
});

app.post('/', requireAuth, (req, res) => {
    const cfg = getConfig();
    for (const key in req.body) {
        if (key === 'levels_enabled' || key === 'verification_enabled') continue;
        cfg[key] = req.body[key];
    }
    cfg.levels_enabled = !!req.body.levels_enabled;
    cfg.verification_enabled = !!req.body.verification_enabled;
    saveConfig(cfg);
    req.flash('success', 'ok');
    res.redirect('/');
});

app.listen(8080, '0.0.0.0', () => console.log('🌐 Dashboard rodando na porta 8080'));