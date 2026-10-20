const express = require('express');
const session = require('express-session');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const flash = require('connect-flash');

const app = express();
const CONFIG_FILE = path.join(__dirname, '../data', 'config.json');

// Garante que a pasta data existe na raiz
if (!fs.existsSync(path.join(__dirname, '../data'))) fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });

const DEFAULT_CONFIG = {
    brand_name: "𝚙𝚡𝚔", brand_emoji: "🖤", brand_footer: "🖤 𝚙𝚡𝚔 • Sistema Oficial",
    brand_color_primary: 0x3D1A5C, brand_color_secondary: 0x5B2A8E,
    brand_color_success: 0x00FF88, brand_color_danger: 0xFF3366,
    levels_enabled: true, levels_xp_per_message: 15, levels_xp_cooldown_seconds: 60,
    verification_enabled: true, verification_method: "button",
    ticket_panel_title: "🎫 Central de Tickets", ticket_panel_desc: "Selecione um tipo abaixo.",
    ticket_category_movcall_id: "", ticket_category_movchat_id: "", ticket_category_recrute_id: "",
    ticket_category_support_id: "", ticket_category_others_id: "",
    staff_role_ids: [], guild_id: ""
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
app.use(session({ 
    secret: process.env.PANEL_SECRET || 'secret', 
    resave: false, 
    saveUninitialized: false, 
    cookie: { secure: process.env.BASE_URL.startsWith('https') } 
}));
app.use(flash());

// ================= AUTH =================
app.get('/login', (req, res) => {
    const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Login - PXKK</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;600;800&display=swap');
        body { background: #040404; color: #fff; font-family: 'Inter', sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background-image: radial-gradient(circle at 15% 10%, rgba(138,79,255,0.15) 0%, transparent 50%); }
        .card { background: rgba(10,10,10,0.6); border: 1px solid rgba(255,255,255,0.1); border-top: 1px solid #8A4FFF; padding: 50px; border-radius: 32px; text-align: center; backdrop-filter: blur(24px); width: 100%; max-width: 400px; }
        h1 { font-family: 'Archivo Black', sans-serif; font-size: 32px; margin-bottom: 10px; }
        p { color: #B8B8C2; margin-bottom: 30px; font-size: 14px; }
        .btn { display: flex; align-items: center; justify-content: center; gap: 10px; background: linear-gradient(135deg, #8A4FFF, #6B2EE0); color: #fff; text-decoration: none; padding: 18px; border-radius: 99px; font-weight: 700; transition: 0.2s; }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(138,79,255,0.4); }
    </style></head><body>
    <div class="card">
        <h1>Bem-vindo</h1>
        <p>Autentique-se com sua conta do Discord para acessar o painel.</p>
        <a href="/auth" class="btn">
            <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.3.5a14.7 14.7 0 0 1 4.3 2.2 15 15 0 0 0-12.8 0A14.6 14.6 0 0 1 10.9 3.5L10.6 3a19.7 19.7 0 0 0-4.9 1.4C2.6 8.6 1.9 12.7 2.3 16.7a19.8 19.8 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14 14 0 0 0 12.8 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.8 19.8 0 0 0 6-3c.5-4.6-.7-8.6-3.4-12.3ZM9 14.6c-1.2 0-2.2-1.1-2.2-2.4S7.8 9.8 9 9.8s2.2 1.1 2.2 2.4S10.2 14.6 9 14.6Zm6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
            Entrar com Discord
        </a>
    </div></body></html>`;
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
    // Verifica o State para segurança
    if (req.query.state !== req.session.oauth_state) {
        console.log("❌ Erro: State inválido (Sessão expirou ou URL forçada).");
        return res.redirect('/login');
    }
    
    try {
        // Troca o Code pelo Token
        const token = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ 
            client_id: process.env.DISCORD_CLIENT_ID, 
            client_secret: process.env.DISCORD_CLIENT_SECRET, 
            grant_type: 'authorization_code', 
            code: req.query.code, 
            redirect_uri: `${process.env.BASE_URL}/callback` 
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        
        // Pega os dados do usuário
        const user = await axios.get('https://discord.com/api/users/@me', { 
            headers: { Authorization: `Bearer ${token.data.access_token}` } 
        });
        
        const userId = user.data.id;

        // ===== VERIFICAÇÃO DE PERMISSÃO =====
        // Lê os IDs do .env e limpa espaços
        const owners = (process.env.OWNER_IDS || '').split(',').map(i => i.trim()).filter(i => i);
        const devs = (process.env.DEV_IDS || '').split(',').map(i => i.trim()).filter(i => i);

        // LOG DE DEBUG (Aparece nos logs do Portainer)
        console.log(`[LOGIN] Tentativa do ID: ${userId}`);
        console.log(`[LOGIN] IDs Autorizados (OWNER): ${owners.join(', ')}`);

        if (!owners.includes(userId) && !devs.includes(userId)) {
            console.log(`❌ Acesso negado para o ID ${userId}. Ele não está no OWNER_IDS.`);
            return res.status(403).send(`
                <body style="background:#040404; color:#fff; font-family:sans-serif; display:grid; place-items:center; height:100vh; text-align:center;">
                    <div>
                        <h1 style="color:#f87171; font-size: 40px;">Acesso Negado 🚫</h1>
                        <p>O ID <b>${userId}</b> não tem permissão.</p>
                        <p style="color:#7A7A88;">Se este é o seu ID, copie-o e coloque no campo <b>OWNER_IDS</b> no Portainer.</p>
                        <a href="/login" style="color:#8A4FFF; margin-top: 20px; display: block;">Voltar</a>
                    </div>
                </body>
            `);
        }

        // Se passou, salva a sessão
        req.session.user = user.data;
        req.session.user.role = devs.includes(userId) ? 'dev' : 'owner';
        
        req.session.save((err) => {
            if (err) console.error("Erro ao salvar sessão:", err);
            res.redirect('/');
        });

    } catch (e) { 
        console.error("Erro no OAuth:", e.response ? e.response.data : e.message);
        res.status(400).send("Falha na autenticação. Verifique os logs do servidor."); 
    }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// ================= DASHBOARD =================
const requireAuth = (req, res, next) => { if (!req.session.user) return res.redirect('/login'); next(); };

app.get('/', requireAuth, (req, res) => {
    const cfg = getConfig();
    const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dashboard - PXKK</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;600;800&display=swap');
        body { background: #040404; color: #fff; font-family: 'Inter', sans-serif; margin: 0; padding: 20px; background-image: radial-gradient(circle at 15% 10%, rgba(138,79,255,0.15) 0%, transparent 50%); }
        .nav { display: flex; justify-content: space-between; align-items: center; background: rgba(10,10,10,0.8); padding: 15px 30px; border-radius: 99px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 40px; }
        .container { max-width: 900px; margin: 0 auto; background: rgba(10,10,10,0.6); padding: 40px; border-radius: 32px; border: 1px solid rgba(255,255,255,0.1); }
        h1 { font-family: 'Archivo Black', sans-serif; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 30px; }
        .field { display: flex; flex-direction: column; gap: 8px; }
        label { font-size: 12px; font-weight: 700; color: #B8B8C2; text-transform: uppercase; }
        input[type="text"], input[type="number"], select { width: 100%; padding: 16px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; color: #fff; outline: none; }
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
        <div>
            <img src="https://cdn.discordapp.com/avatars/${req.session.user.id}/${req.session.user.avatar}.png" width="35" style="border-radius: 50%; vertical-align: middle; margin-right: 10px;">
            <b>${req.session.user.username}</b>
            <a href="/logout" style="color: #f87171; margin-left: 15px; text-decoration: none;">Sair</a>
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
                    <input type="text" name="ticket_category_movcall_id" value="${cfg.ticket_category_movcall_id}">
                </div>
                <div class="field" style="grid-column: span 2;">
                    <label>Categoria: SUPORTE (ID)</label>
                    <input type="text" name="ticket_category_support_id" value="${cfg.ticket_category_support_id}">
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