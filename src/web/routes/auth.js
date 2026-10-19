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
    if (req.query.state !== req.session.oauth_state) return res.redirect('/login');
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

        if (!process.env.OWNER_IDS.includes(userRes.data.id)) return res.status(403).send("Acesso Negado");
        
        req.session.user = userRes.data;
        res.redirect('/');
    } catch (e) { res.status(400).send("Falha na autenticação."); }
});

router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

module.exports = router;