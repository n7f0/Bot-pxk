// src/dashboard.js
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const { Config } = require('./models'); // Importa o modelo do Super Banco de Dados

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Exporta o 'io' para que o bot (src/bot/index.js) possa usá-lo se precisar
module.exports.io = io;

// Configurações do Express
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, '../public'))); // Serve a pasta public (logo.gif, index.html)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessão para o Login do Discord
app.use(session({ 
    secret: process.env.PANEL_SECRET || 'pxk_secret_super_seguro', 
    resave: false, 
    saveUninitialized: false, 
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } // 24 horas
}));

// ================= SOCKET.IO (TEMPO REAL) =================
io.on('connection', (socket) => {
    console.log('🔌 [Site] Novo cliente conectado ao WebSocket.');
});

// ================= API DO SITE (CONFIGURAÇÕES) =================
app.get('/api/config', async (req, res) => {
    try {
        const cfg = await Config.findOne({ key: 'main' }).lean();
        // Retorna o objeto 'data' (onde estão todas as configs) ou vazio
        res.json(cfg?.data || {});
    } catch (e) {
        console.error('[API] Erro ao buscar config:', e);
        res.status(500).json({ error: 'Erro ao carregar configurações.' });
    }
});

app.post('/api/config', async (req, res) => {
    try {
        // Salva o objeto no MongoDB.
        // O $set: { data: req.body } atualiza o objeto inteiro sem apagar as chaves que não foram enviadas (se o frontend cuidar disso)
        await Config.findOneAndUpdate(
            { key: 'main' }, 
            { $set: { data: req.body } }, 
            { upsert: true }
        );
        
        // MÁGICA DO TEMPO REAL: Avisa o bot que a configuração mudou
        io.emit('config_updated', req.body);
        
        res.json({ success: true });
    } catch (e) {
        console.error('[API] Erro ao salvar:', e);
        res.status(500).json({ error: 'Erro ao salvar.' });
    }
});

// ================= API DO DISCORD (CANAIS E CARGOS) =================
app.get('/api/discord-data', async (req, res) => {
    try {
        const cfg = await Config.findOne({ key: 'main' }).lean();
        // Tenta pegar o ID do servidor do banco de dados ou do .env
        const guildId = cfg?.data?.guild_id || process.env.SERVER_PRINCIPAL_ID || process.env.EXTERNAL_GUILD_ID;
        const token = process.env.DISCORD_TOKEN;

        if (!guildId || !token) {
            console.warn('[API Discord] Faltando DISCORD_TOKEN ou ID do Servidor.');
            return res.json({ ch: [], vc: [], cat: [], role: [] });
        }

        const headers = { Authorization: `Bot ${token}` };
        
        // Puxa canais e cargos direto da API do Discord
        const [chsRes, rolesRes] = await Promise.all([
            axios.get(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
            axios.get(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers })
        ]);
        
        const data = { ch: [], vc: [], cat: [], role: [] };
        
        // Organiza os Canais
        chsRes.data.forEach(c => {
            if (c.type === 0 || c.type === 5) data.ch.push({ id: c.id, name: `# ${c.name}` });
            if (c.type === 2) data.vc.push({ id: c.id, name: `🔊 ${c.name}` });
            if (c.type === 4) data.cat.push({ id: c.id, name: c.name });
        });

        // Organiza os Cargos (ignorando o @everyone)
        rolesRes.data.sort((a,b) => b.position - a.position).forEach(r => { 
            if (r.name !== '@everyone') data.role.push({ id: r.id, name: `@${r.name}` }); 
        });

        res.json(data);
    } catch (e) {
        console.error('[API Discord] Erro ao buscar dados:', e.message);
        // Se o bot não tiver permissão ou o ID estiver errado, retorna vazio para não quebrar o site
        res.json({ ch: [], vc: [], cat: [], role: [] });
    }
});

// ================= AUTENTICAÇÃO DISCORD (OAUTH2) =================
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.get('/auth', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauth_state = state;
    
    // Se BASE_URL não estiver no .env, usa localhost para testes
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

app.get('/callback', async (req, res) => {
    if (req.query.state !== req.session.oauth_state) {
        return res.redirect('/login');
    }
    
    const baseUrl = process.env.BASE_URL || 'http://localhost:8080';

    try {
        // Troca o código pelo Token de Acesso
        const token = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ 
            client_id: process.env.DISCORD_CLIENT_ID, 
            client_secret: process.env.DISCORD_CLIENT_SECRET, 
            grant_type: 'authorization_code', 
            code: req.query.code, 
            redirect_uri: `${baseUrl}/callback` 
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        
        // Busca os dados do usuário
        const user = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.data.access_token}` } });
        
        // Verifica quem tem permissão de entrar (Donos e Devs definidos no .env)
        const owners = (process.env.OWNER_IDS || '').split(',').map(i => i.trim()).filter(i => i);
        const devs = (process.env.DEV_IDS || '').split(',').map(i => i.trim()).filter(i => i);
        
        if (!owners.includes(user.data.id) && !devs.includes(user.data.id)) {
            return res.status(403).send(`
                <body style="background:#050308; color:#fff; font-family:sans-serif; display:grid; place-items:center; height:100vh; text-align:center; padding:20px;">
                    <div style="background:rgba(15,12,20,0.8); padding:40px; border-radius:24px; border:1px solid #f87171; max-width:500px;">
                        <h1 style="color:#f87171; margin-bottom:15px;">Acesso Negado 🚫</h1>
                        <p style="margin-bottom:10px;">O seu ID do Discord é:<br><b style="font-size:20px; color:#8A4FFF;">${user.data.id}</b></p>
                        <p style="margin-bottom:20px;">Copie o seu ID acima e cole na variável <b>OWNER_IDS</b> no seu arquivo .env</p>
                        <a href="/login" style="color:#8A4FFF; text-decoration:none; font-weight:bold; border:1px solid #8A4FFF; padding:10px 20px; border-radius:99px; display:inline-block;">Voltar ao Login</a>
                    </div>
                </body>
            `);
        }
        
        // Salva o usuário na sessão e entra no painel
        req.session.user = user.data; 
        req.session.save(() => res.redirect('/'));
    } catch (e) { 
        console.error('Erro no OAuth:', e.message);
        res.status(400).send("Falha na autenticação com o Discord. Verifique suas credenciais no .env."); 
    }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// Middleware que protege a rota principal (exige login)
const requireAuth = (req, res, next) => { 
    if (!req.session.user) return res.redirect('/login'); 
    next(); 
};

// ================= ROTA PRINCIPAL (O PAINEL) =================
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ================= INICIALIZAÇÃO DO SERVIDOR =================
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Dashboard e WebSocket rodando na porta ${PORT}`);
    console.log(`🔗 Acesse: http://localhost:${PORT}`);
});
