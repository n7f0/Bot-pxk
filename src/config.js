const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../data/config.json');

const DEFAULT_CONFIG = {
    brand_name: "𝚙𝚡𝚔", brand_emoji: "🖤", brand_color_primary: 0x3D1A5C,
    levels_enabled: true, levels_xp_per_message: 15, levels_xp_cooldown_seconds: 60,
    verification_enabled: true, verification_method: "button",
    ticket_panel_title: "🎫 Central de Tickets",
    staff_role_ids: []
};

const loadConfig = () => {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 4));
            return DEFAULT_CONFIG;
        }
        const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        return { ...DEFAULT_CONFIG, ...data };
    } catch (e) { return DEFAULT_CONFIG; }
};

const saveConfig = (data) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 4));
    return data;
};

module.exports = { loadConfig, saveConfig };