const express = require('express');
const session = require('express-session');
const path = require('path');
const authRoutes = require('./routes/auth');
const { loadConfig } = require('../config');
const flash = require('connect-flash');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.PANEL_SECRET || 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.BASE_URL.startsWith('https') }
}));
app.use(flash());

// Guard de Autenticação
const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

// Rotas de Auth (Login/Callback)
app.use('/', authRoutes);

// Rota Principal (Dashboard)
app.get('/', requireAuth, (req, res) => {
    const config = loadConfig();
    res.render('dashboard', { user: req.session.user, cfg: config, messages: req.flash('success') });
});

app.post('/', requireAuth, (req, res) => {
    const currentConfig = loadConfig();
    const newConfig = { ...currentConfig, ...req.body };
    
    // Tratamento de checkboxes (que não enviam 'false' se desmarcados)
    if (!req.body.levels_enabled) newConfig.levels_enabled = false;
    
    require('../config').saveConfig(newConfig);
    req.flash('success', 'Configurações salvas!');
    res.redirect('/');
});

const startWebServer = () => {
    app.listen(8080, '0.0.0.0', () => console.log('🌐 Painel Web rodando na porta 8080'));
};

module.exports = { startWebServer };