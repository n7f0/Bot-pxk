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

// Exporta o io para que o bot possa usá-lo se precisar
module.exports.io = io;

// Confia no proxy (importante para Cloudflare / Docker)
app.set('trust proxy', 1);

// Configurações do Express
app.use(express.static(path.join(__dirname, '../public'))); 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ 
    secret: process.env.PANEL_SECRET || 'pxk_secret_super_seguro', 
    resave: false, 
    saveUninitialized: false, 
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } // 24 horas
}));

// ================= APIs DO SITE =================

// Retorna os dados do usuário logado para o frontend (Avatar, Nome, ID)
app.get('/api/me', (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Não autenticado' });
    }
});

// Busca as configurações no MongoDB
app.get('/api/config', async (req, res) => {
    try {
        const cfg = await Config.findOne({ key: 'main' }).lean();
        res.json(cfg?.data || {});
    } catch (e) { 
        res.status(500).json({ error: 'Erro ao carregar.' }); 
    }
});

// Salva as configurações no MongoDB e avisa o bot via WebSocket
app.post('/api/config', async (req, res) => {
    try {
        await Config.findOneAndUpdate({ key: 'main' }, { $set: { data: req.body } }, { upsert: true });
        io.emit('config_updated', req.body); // Avisa o bot em tempo real
        res.json({ success: true });
    } catch (e) { 
        res.status(500).json({ error: 'Erro ao salvar.' }); 
    }
});

// Busca canais e cargos do Discord
app.get('/api/discord-data', async (req, res) => {
    try {
        const cfg = await Config.findOne({ key: 'main' }).lean();
        const guildId = cfg?.data?.guild_id || process.env.SERVER_PRINCIPAL_ID || process.env.EXTERNAL_GUILD_ID;
        
        if (!guildId || !process.env.DISCORD_TOKEN) {
            return res.json({ ch: [], vc: [], cat: [], role: [] });
        }

        const headers = { Authorization: `Bot ${process.env.DISCORD_TOKEN}` };
        const [chsRes, rolesRes] = await Promise.all([
            axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
            axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers })
        ]);
        
        const data = { ch: [], vc: [], cat: [], role: [] };
        
        // Organiza Canais
        chsRes.data.forEach(c => {
            if (c.type === 0 || c.type === 5) data.ch.push({ id: c.id, name: `# ${c.name}` });
            if (c.type === 2) data.vc.push({ id: c.id, name: `🔊 ${c.name}` });
            if (c.type === 4) data.cat.push({ id: c.id, name: c.name });
        });
        
        // Organiza Cargos
        rolesRes.data.sort((a,b) => b.position - a.position).forEach(r => { 
            if (r.name !== '@everyone') data.role.push({ id: r.id, name: `@${r.name}` }); 
        });
        
        res.json(data);
    } catch (e) { 
        console.error('[API Discord]', e.message);
        res.json({ ch: [], vc: [], cat: [], role: [] }); 
    }
});

// ================= AUTENTICAÇÃO =================

// Serve a página de login estática
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Redireciona para o Discord OAuth2
app.get('/auth', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauth_state = state;
    const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
    
    const params = new URLSearchParams({ 
        client_id: process.env.DISCORD_CLIENT_ID, 
        redirect_uri: `${baseUrl}/callback`, 
        response_type: 'code', 
        scope: 'identify guilds', 
        state 
    });
    
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

// Callback do Discord após o login
app.get('/callback', async (req, res) => {
    if (req.query.state !== req.session.oauth_state) {
        return res.redirect('/login');
    }
    
    const baseUrl = process.env.BASE_URL || 'http://localhost:8080';
    
    try {
        // Troca o código pelo token
        const token = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ 
            client_id: process.env.DISCORD_CLIENT_ID, 
            client_secret: process.env.DISCORD_CLIENT_SECRET, 
            grant_type: 'authorization_code', 
            code: req.query.code, 
            redirect_uri: `${baseUrl}/callback` 
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        
        // Busca os dados do usuário
        const user = await axios.get('https://discord.com/api/users/@me', { 
            headers: { Authorization: `Bearer ${token.data.access_token}` } 
        });
        
        // Verifica permissões (OWNER_IDS e DEV_IDS)
        const owners = (process.env.OWNER_IDS || '').split(',').map(i => i.trim()).filter(i => i);
        const devs = (process.env.DEV_IDS || '').split(',').map(i => i.trim()).filter(i => i);
        const allowedIds = [...new Set([...owners, ...devs])]; // Junta e remove duplicados

        if (!allowedIds.includes(user.data.id)) {
            // Se não tem permissão, manda para a página de acesso negado com o ID na URL
            return res.redirect(`/acesso-negado.html?id=${user.data.id}`);
        }
        
        // Sucesso, salva na sessão e vai para o painel
        req.session.user = user.data; 
        req.session.save(() => res.redirect('/'));
        
    } catch (e) { 
        console.error('Erro no OAuth2:', e.message);
        res.status(400).send("Falha na autenticação com o Discord. Verifique as credenciais no .env"); 
    }
});

// Rota de logout
app.get('/logout', (req, res) => { 
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/login'); 
    });
});

// Middleware para proteger a rota principal
const requireAuth = (req, res, next) => { 
    if (!req.session.user) return res.redirect('/login'); 
    next(); 
};

// Rota principal do painel
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Inicia o servidor
server.listen(8080, '0.0.0.0', () => {
    console.log('🌐 Dashboard e WebSocket rodando na porta 8080');
    console.log('🔗 Acesse: http://localhost:8080');
});
