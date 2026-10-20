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
    brand_color_primary: 0x3D1A5C, brand_color_secondary: 0x5B2A8E, brand_color_success: 0x00FF88, brand_color_danger: 0xFF3366,
    avatar_url: "", banner_painel_url: "", banner_ticket_url: "", banner_welcome_url: "",
    levels_enabled: true, levels_xp_per_message: 15, levels_xp_cooldown_seconds: 60, levels_announce_channel_id: "", levels_message_up: "🎉 {user} subiu para o **level {level}**!",
    verification_enabled: true, verification_method: "button", verification_difficulty: 1, verification_kick_minutes: 0,
    verified_role_ids: [], verification_unverified_role_ids: [], verification_channel_id: "", verification_panel_channel_id: "", verification_log_channel_id: "", verification_temp_category_id: "",
    ticket_panel_channel_id: "", ticket_logs_channel_id: "", ticket_category_movcall_id: "", ticket_category_movchat_id: "", ticket_category_recrute_id: "", ticket_category_support_id: "", ticket_category_others_id: "", ticket_support_role_ids: [],
    welcome_channel_id: "", welcome_message: "Seja muito bem-vindo(a)!", leave_channel_id: "", leave_message: "Até logo!", auto_role_id: "",
    staff_role_ids: [], staff_movchat_role_ids: [], staff_movchat_goal: 1000, staff_call_goal_hours: 30,
    vip_enabled: true, vip_role_base_id: "", vip_allow_custom_color: true, vip_allow_custom_name: true, vip_max_members: 5,
    activity_rotate_enabled: false, activity_type: "watching", activity_rotate_seconds: 30, activity_messages: [],
    antibot_channel_id: "", antibot_log_channel_id: "", antibot_punish_ban: true, antibot_delete_messages: true,
    filters_enabled: true, filters_punish_after_warnings: 3, filters_links_allowed_role_ids: [], filters_log_channel_id: "", filters_blocked_words: [], filters_allowed_domains: [],
    voice_channel_id: "", voice_mute: true, bot_status: "online", voice_join_log_channel_id: "", voice_leave_log_channel_id: "", moderation_logs_channel_id: "", guild_id: ""
};

const getConfig = () => {
    try {
        if (!fs.existsSync(CONFIG_FILE)) return DEFAULT_CONFIG;
        return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    } catch { return DEFAULT_CONFIG; }
};
const saveConfig = (cfg) => fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 4));

app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, '../public'))); 
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.PANEL_SECRET || 'secret', resave: false, saveUninitialized: false, cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } }));
app.use(flash());

let discordCache = { time: 0, data: { ch: [], vc: [], cat: [], role: [] } };
async function getDiscordData(guildId) {
    if (!guildId || !process.env.DISCORD_TOKEN) return discordCache.data;
    if (Date.now() - discordCache.time < 60000) return discordCache.data;
    try {
        const headers = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };
        const chs = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers });
        const roles = await axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers });
        const cats = {};
        chs.data.filter(c => c.type === 4).forEach(c => cats[c.id] = c.name);
        const data = { ch: [], vc: [], cat: [], role: [] };
        chs.data.sort((a,b) => a.position - b.position).forEach(c => {
            let label = c.name;
            if (c.parent_id && cats[c.parent_id]) label = `${cats[c.parent_id]} › ${label}`;
            if (c.type === 0 || c.type === 5) data.ch.push({ id: c.id, name: `# ${label}` });
            if (c.type === 2) data.vc.push({ id: c.id, name: `🔊 ${label}` });
            if (c.type === 4) data.cat.push({ id: c.id, name: c.name });
        });
        roles.data.sort((a,b) => b.position - a.position).forEach(r => { if (r.name !== '@everyone') data.role.push({ id: r.id, name: `@${r.name}` }); });
        discordCache = { time: Date.now(), data };
        return data;
    } catch (e) { return discordCache.data; }
}

app.get('/login', (req, res) => {
    res.send(`
    <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Login - PXKK</title>
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
    </style></head><body>
    <div class="container">
        <div class="hero"><h1>Gerencie seu<br>servidor com<br><span>precisão total.</span></h1><p>Toda a configuração do seu bot em um painel único, seguro e intuitivo.</p></div>
        <div class="card">
            <h2>Bem-vindo</h2><p>Autentique-se com sua conta do Discord para acessar o painel.</p>
            <a href="/auth" class="btn"><svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.3.5a14.7 14.7 0 0 1 4.3 2.2 15 15 0 0 0-12.8 0A14.6 14.6 0 0 1 10.9 3.5L10.6 3a19.7 19.7 0 0 0-4.9 1.4C2.6 8.6 1.9 12.7 2.3 16.7a19.8 19.8 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14 14 0 0 0 12.8 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.8 19.8 0 0 0 6-3c.5-4.6-.7-8.6-3.4-12.3ZM9 14.6c-1.2 0-2.2-1.1-2.2-2.4S7.8 9.8 9 9.8s2.2 1.1 2.2 2.4S10.2 14.6 9 14.6Zm6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg> Entrar com Discord</a>
        </div>
    </div></body></html>`);
});

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
        const devs = (process.env.DEV_IDS || '').split(',').map(i=>i.trim()).filter(i=>i);
        if (!owners.includes(user.data.id) && !devs.includes(user.data.id)) return res.status(403).send("Acesso Negado.");
        req.session.user = user.data; req.session.user.role = devs.includes(user.data.id) ? 'dev' : 'owner';
        req.session.save(() => res.redirect('/'));
    } catch (e) { res.status(400).send("Falha na autenticação."); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

const requireAuth = (req, res, next) => { if (!req.session.user) return res.redirect('/login'); next(); };

app.get('/', requireAuth, async (req, res) => {
    const cfg = getConfig();
    const dd = await getDiscordData(cfg.guild_id);
    const hexcolor = (n) => '#' + (n ? parseInt(n).toString(16).padStart(6, '0') : '000000');
    
    const renderField = (key, label, type) => {
        const val = cfg[key];
        if (type === 'bool') return `<div class="f full"><label class="sw"><input type="checkbox" name="${key}" ${val ? 'checked' : ''}><span>${label}</span></label></div>`;
        if (type === 'text') return `<div class="f"><label>${label}</label><input type="text" name="${key}" value="${val || ''}"></div>`;
        if (type === 'num') return `<div class="f"><label>${label}</label><input type="number" name="${key}" value="${val || 0}"></div>`;
        if (type === 'area') return `<div class="f full"><label>${label}</label><textarea name="${key}">${val || ''}</textarea></div>`;
        if (type === 'color') return `<div class="f"><label>${label}</label><div class="color-wrapper"><input type="color" name="${key}" value="${hexcolor(val)}"><span class="color-hex">${hexcolor(val)}</span></div></div>`;
        let opts = `<option value="">— nenhum —</option>`;
        if (type === 'ch') opts += dd.ch.map(o => `<option value="${o.id}" ${val == o.id ? 'selected' : ''}>${o.name}</option>`).join('');
        if (type === 'vc') opts += dd.vc.map(o => `<option value="${o.id}" ${val == o.id ? 'selected' : ''}>${o.name}</option>`).join('');
        if (type === 'cat') opts += dd.cat.map(o => `<option value="${o.id}" ${val == o.id ? 'selected' : ''}>${o.name}</option>`).join('');
        if (type === 'role_single') opts += dd.role.map(o => `<option value="${o.id}" ${val == o.id ? 'selected' : ''}>${o.name}</option>`).join('');
        if (type === 'role') {
            opts = dd.role.map(o => `<option value="${o.id}" ${(val||[]).includes(o.id) ? 'selected' : ''}>${o.name}</option>`).join('');
            return `<div class="f full"><label>${label}</label><select name="${key}" multiple size="5">${opts}</select><span class="hint">Segure Ctrl/Cmd para selecionar vários</span></div>`;
        }
        return `<div class="f"><label>${label}</label><select name="${key}">${opts}</select></div>`;
    };

    res.send(`
    <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Dashboard - PXKK</title>
    <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root { --purple: #8A4FFF; --purple-hi: #A370FF; --black: #040404; --white: #fff; --gray-hi: #B8B8C2; --gray-mid: #7A7A88; --border: rgba(255,255,255,0.08); --border-hi: rgba(138,79,255,0.35); }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: radial-gradient(circle at 15% 10%, rgba(138,79,255,0.15) 0%, transparent 40%), radial-gradient(circle at 85% 90%, rgba(138,79,255,0.1) 0%, transparent 40%), var(--black); color: var(--white); font-family: 'Inter', sans-serif; min-height: 100vh; display: flex; flex-direction: column; padding: 16px; padding-bottom: 100px; }
        .topbar { display: flex; justify-content: space-between; align-items: center; background: rgba(10,10,10,0.7); backdrop-filter: blur(24px); padding: 15px 30px; border-radius: 99px; border: 1px solid var(--border); margin-bottom: 24px; }
        .brand { display: flex; align-items: center; gap: 15px; font-family: 'Archivo Black'; font-size: 20px; }
        .brand img { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--border-hi); }
        .user-info { display: flex; align-items: center; gap: 15px; font-size: 14px; font-weight: 600; }
        .user-info img { width: 35px; height: 35px; border-radius: 50%; border: 1px solid var(--border-hi); }
        .user-info a { color: #f87171; text-decoration: none; }
        .layout { display: flex; gap: 24px; flex: 1; }
        .sidebar { width: 260px; background: rgba(10,10,10,0.6); backdrop-filter: blur(20px); border: 1px solid var(--border); border-radius: 32px; padding: 20px; display: flex; flex-direction: column; gap: 8px; height: calc(100vh - 120px); overflow-y: auto; position: sticky; top: 16px; }
        .nav-btn { display: flex; align-items: center; gap: 12px; padding: 14px 20px; color: var(--gray-hi); font-size: 14px; font-weight: 500; border-radius: 99px; cursor: pointer; transition: 0.2s; border: 1px solid transparent; background: transparent; text-align: left; width: 100%; }
        .nav-btn:hover { background: rgba(255,255,255,0.04); color: var(--white); }
        .nav-btn.active { background: linear-gradient(90deg, rgba(138,79,255,0.15), rgba(138,79,255,0.05)); color: var(--white); font-weight: 600; border-color: rgba(138,79,255,0.3); }
        .content { flex: 1; position: relative; }
        .section { display: none; background: rgba(10,10,10,0.6); backdrop-filter: blur(24px); border: 1px solid var(--border); border-radius: 32px; padding: 40px; animation: fadeIn 0.3s; }
        .section.active { display: block; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .section-head { margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .section-head h2 { font-family: 'Archivo Black'; font-size: 28px; text-transform: uppercase; margin-bottom: 8px; }
        .section-head p { color: var(--gray-mid); font-size: 14px; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        .f { display: flex; flex-direction: column; gap: 10px; }
        .f.full { grid-column: 1 / -1; }
        .f label { font-size: 11px; font-weight: 800; color: var(--gray-hi); text-transform: uppercase; letter-spacing: 0.05em; }
        .f input[type="text"], .f input[type="number"], .f select, .f textarea { width: 100%; padding: 16px 20px; background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 16px; color: var(--white); font: inherit; outline: none; transition: 0.2s; }
        .f input:focus, .f select:focus, .f textarea:focus { border-color: var(--purple); box-shadow: 0 0 0 4px rgba(138,79,255,0.25); }
        .f textarea { min-height: 100px; resize: vertical; }
        .f select[multiple] { padding: 8px; }
        .f select[multiple] option { padding: 12px; border-radius: 8px; margin-bottom: 4px; }
        .f select[multiple] option:checked { background: var(--purple); color: var(--white); }
        .hint { font-size: 11px; color: var(--gray-mid); }
        .sw { display: flex; align-items: center; gap: 15px; background: rgba(0,0,0,0.3); padding: 16px; border-radius: 16px; border: 1px solid var(--border); cursor: pointer; }
        .sw input[type="checkbox"] { width: 50px; height: 26px; appearance: none; background: #4A4A55; border-radius: 99px; position: relative; cursor: pointer; transition: 0.2s; flex-shrink: 0; }
        .sw input[type="checkbox"]::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; background: #fff; border-radius: 50%; transition: 0.2s; }
        .sw input[type="checkbox"]:checked { background: var(--purple); }
        .sw input[type="checkbox"]:checked::after { transform: translateX(24px); }
        .color-wrapper { display: flex; align-items: center; gap: 15px; background: rgba(0,0,0,0.3); padding: 10px 20px; border-radius: 99px; border: 1px solid var(--border); }
        .color-wrapper input[type="color"] { width: 35px; height: 35px; border: none; background: none; cursor: pointer; padding: 0; }
        .color-wrapper input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
        .color-wrapper input[type="color"]::-webkit-color-swatch { border: 2px solid rgba(255,255,255,0.2); border-radius: 50%; }
        .color-hex { font-family: monospace; font-size: 14px; font-weight: bold; text-transform: uppercase; }
        .save-bar { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: rgba(15,15,15,0.95); backdrop-filter: blur(20px); border: 1px solid var(--border-hi); padding: 16px 32px; border-radius: 99px; display: flex; justify-content: space-between; align-items: center; gap: 30px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); z-index: 100; }
        .save-btn { background: var(--purple); color: #fff; padding: 16px 36px; border: none; border-radius: 99px; font-weight: 800; font-size: 14px; text-transform: uppercase; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 10px; }
        .save-btn:hover { background: var(--purple-hi); transform: translateY(-2px); box-shadow: 0 8px 20px rgba(138,79,255,0.5); }
        @media(max-width: 900px) { body { padding-bottom: 120px; } .layout { flex-direction: column; } .sidebar { width: 100%; height: auto; flex-direction: row; overflow-x: auto; padding: 10px; position: relative; top: 0; } .nav-btn { white-space: nowrap; width: auto; padding: 10px 15px; } .form-grid { grid-template-columns: 1fr; } .save-bar { width: calc(100% - 32px); bottom: 16px; padding: 12px; border-radius: 20px; } .save-btn { width: 100%; justify-content: center; } }
    </style></head><body>
    <header class="topbar">
        <div class="brand"><img src="/logo.gif" onerror="this.style.display='none';"> PXKK Dashboard</div>
        <div class="user-info"><img src="https://cdn.discordapp.com/avatars/${req.session.user.id}/${req.session.user.avatar}.png"> ${req.session.user.username} <a href="/logout">Sair</a></div>
    </header>
    <div class="layout">
        <aside class="sidebar">
            <button class="nav-btn active" data-target="s0">🎨 Identidade</button>
            <button class="nav-btn" data-target="s1">🌈 Cores</button>
            <button class="nav-btn" data-target="s2">✅ Verificação</button>
            <button class="nav-btn" data-target="s3">🎫 Tickets</button>
            <button class="nav-btn" data-target="s4">🏆 Níveis</button>
            <button class="nav-btn" data-target="s5">👋 Boas-vindas</button>
            <button class="nav-btn" data-target="s6">👮 Staff</button>
            <button class="nav-btn" data-target="s7">💎 VIP</button>
            <button class="nav-btn" data-target="s8">🔊 Voz e Status</button>
            <button class="nav-btn" data-target="s9">🛡️ Filtros