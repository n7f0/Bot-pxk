const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();

router.get('/login', (req, res) => res.render('login'));

router.get('/auth', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauth_state = state;
    const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        redirect_uri: `${process.env.BASE_URL}/callback`,
        response_type: 'code',
        scope: 'identify guilds',
        state: state
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

router.get('/callback', async (req, res) => {
    // Se o usuário cancelou no Discord
    if (req.query.error) return res.redirect('/login');
    
    if (req.query.state !== req.session.oauth_state) {
        console.log("❌ Erro: State inválido.");
        return res.redirect('/login');
    }
    
    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: req.query.code,
            redirect_uri: `${process.env.BASE_URL}/callback`
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
        });

        const userId = userRes.data.id;
        
        // Limpa e separa os IDs configurados no Portainer (Remove espaços em branco)
        const ownerIds = (process.env.OWNER_IDS || '').split(',').map(id => id.trim());
        const devIds = (process.env.DEV_IDS || '').split(',').map(id => id.trim());

        // Verifica se o usuário logado está na lista
        if (!ownerIds.includes(userId) && !devIds.includes(userId)) {
            console.log(`⛔ Acesso negado para o ID: ${userId}. Configure o OWNER_IDS no Portainer.`);
            return res.status(403).send(`<body style="background:#040404; color:#fff; font-family:sans-serif; display:grid; place-items:center; height:100vh;"><div style="text-align:center"><h1>Acesso Negado 🚫</h1><p>Seu ID do Discord (${userId}) não tem permissão.</p></div></body>`);
        }

        req.session.user = userRes.data;
        req.session.user.role = devIds.includes(userId) ? 'dev' : 'owner';
        
        // Força o salvamento da sessão antes de redirecionar
        req.session.save((err) => {
            if (err) console.error("Erro ao salvar sessão:", err);
            res.redirect('/');
        });

    } catch (e) { 
        console.error("Erro no OAuth:", e.response ? e.response.data : e.message);
        res.status(400).send("Falha na autenticação. Verifique os logs do servidor."); 
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

module.exports = router;