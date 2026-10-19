const express = require('express');
const session = require('express-session');
const path = require('path');
const authRoutes = require('./routes/auth');
const { loadConfig, saveConfig } = require('../config');
const flash = require('connect-flash');

const app = express();
app.set('trust proxy', 1); // Importante para funcionar com Cloudflare/HTTPS

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.PANEL_SECRET || 'segredo_pxkk',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.BASE_URL.startsWith('https'), // Só exige HTTPS se o BASE_URL for HTTPS
        maxAge: 1000 * 60 * 60 * 24 // 24 horas de login
    }
}));
app.use(flash());

const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

app.use('/', authRoutes);

app.get('/', requireAuth, (req, res) => {
    const config = loadConfig();
    res.render('dashboard', { user: req.session.user, cfg: config, messages: req.flash('success') });
});

app.post('/', requireAuth, (req, res) => {
    const currentConfig = loadConfig();
    const newConfig = { ...currentConfig, ...req.body };
    
    if (!req.body.levels_enabled) newConfig.levels_enabled = false;
    if (!req.body.verification_enabled) newConfig.verification_enabled = false;
    
    saveConfig(newConfig);
    req.flash('success', 'Configurações salvas com sucesso!');
    res.redirect('/');
});

const startWebServer = () => {
    app.listen(8080, '0.0.0.0', () => console.log('🌐 Painel Web rodando na porta 8080'));
};

module.exports = { startWebServer };