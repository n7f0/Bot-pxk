"""
Dashboard público — pxkk.com.br
Sistema completo: níveis MEE6, VIP, staff, filtros, 5 tipos de ticket.
Visual: High Contrast Premium SaaS + Gradients + Layout Otimizado.
"""
import os, json, secrets, hmac, hashlib, time
import requests
from urllib.parse import urlencode
from flask import Flask, request, session, redirect, url_for, render_template_string, flash, jsonify

# ==================== CONFIG ====================
CONFIG_FILE           = "/app/data/config.json"
DISCORD_CLIENT_ID     = os.getenv("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET", "")
DISCORD_BOT_TOKEN     = os.getenv("DISCORD_TOKEN", "")
BASE_URL              = os.getenv("BASE_URL", "https://pxkk.com.br").rstrip("/")
FLASK_SECRET          = os.getenv("PANEL_SECRET") or secrets.token_hex(32)

def _parse_ids(env_name):
    raw = os.getenv(env_name, "") or ""
    return {int(x.strip()) for x in raw.split(",") if x.strip().isdigit()}

OWNER_IDS = _parse_ids("OWNER_IDS")
DEV_IDS   = _parse_ids("DEV_IDS")

STAFF_PERMS = {}
_raw_staff = os.getenv("STAFF_PERMS", "") or ""
try:
    if _raw_staff.strip():
        STAFF_PERMS = {int(k): v for k, v in json.loads(_raw_staff).items()}
except Exception as e:
    print(f"⚠️ STAFF_PERMS inválido: {e}")

if not DISCORD_CLIENT_ID or not DISCORD_CLIENT_SECRET:
    raise SystemExit("❌ Defina DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET.")
if not OWNER_IDS and not DEV_IDS:
    raise SystemExit("❌ Defina ao menos OWNER_IDS ou DEV_IDS.")

DISCORD_API     = "https://discord.com/api/v10"
OAUTH_AUTHORIZE = "https://discord.com/oauth2/authorize"
OAUTH_TOKEN     = "https://discord.com/api/oauth2/token"

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.secret_key = FLASK_SECRET
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=BASE_URL.startswith("https"),
)

# ==================== SEÇÕES ====================
SECTION_SLUGS = [
    "identity", "colors", "autoemoji", "activity", "verification", "antibot", "filters", 
    "tickets", "feedback", "welcome", "levels", "vip", "staff", "addcargo", "voice"
]

SECTIONS = [
    ("🎨 Identidade", [
        ("brand_name", "Nome da marca", "text"),
        ("brand_emoji", "Emoji da marca", "text"),
        ("brand_footer", "Rodapé padrão", "text"),
        ("brand_color_primary", "Cor primária", "color"),
        ("brand_color_secondary", "Cor secundária", "color"),
        ("brand_color_success", "Cor de sucesso", "color"),
        ("brand_color_danger", "Cor de erro", "color"),
        ("avatar_url", "URL do avatar do bot", "text"),
        ("banner_painel_url", "Banner do painel (URL)", "text"),
        ("banner_ticket_url", "Banner dos tickets (URL)", "text"),
        ("banner_welcome_url", "Banner de boas-vindas (URL)", "text"),
    ]),
    ("🌈 Cores dos Painéis", [
        ("panel_color_main", "Painel principal", "color"),
        ("panel_color_ticket", "Painel de tickets", "color"),
        ("panel_color_verification", "Verificação", "color"),
        ("panel_color_feedback", "Avaliações", "color"),
        ("panel_color_suggestions", "Sugestões", "color"),
        ("panel_color_levels", "Níveis", "color"),
        ("panel_color_staff", "Painel Staff", "color"),
        ("panel_color_vip", "Painel VIP", "color"),
    ]),
    ("✨ Auto-Emoji", [
        ("auto_emoji_channels", "Adicionar emoji automático nos canais", "bool"),
    ]),
    ("🎞️ Atividade do Bot", [
        ("activity_rotate_enabled", "Ativar rotação de atividade", "bool"),
        ("activity_type", "Tipo", "choice:watching=Assistindo,playing=Jogando,listening=Ouvindo,competing=Competindo"),
        ("activity_rotate_seconds", "Trocar a cada X segundos (mín 10)", "num"),
        ("activity_messages", "Mensagens (uma por linha — use {brand}, {emoji}, {members})", "list"),
    ]),
    ("✅ Verificação", [
        ("verification_enabled", "Verificação ativada", "bool"),
        ("verification_method", "Método", "choice:math=Conta matemática,button=Botão"),
        ("verification_difficulty", "Dificuldade (1-3)", "num"),
        ("verification_kick_minutes", "Kick após X min (0 = desligado)", "num"),
        ("verification_timeout_delete_minutes", "Deletar canal temp após X min (0 = off)", "num"),
        ("verified_role_ids", "Cargos dados ao verificar", "role"),
        ("verification_unverified_role_ids", "Cargos de não verificado", "role"),
        ("verification_channel_id", "Canal de verificação", "ch"),
        ("verification_panel_channel_id", "Canal do painel de verificação", "ch"),
        ("verification_log_channel_id", "Canal de logs de verificação", "ch"),
        ("verification_temp_category_id", "Categoria do canal temporário", "cat"),
        ("verification_temp_delete_seconds", "Apagar canal temp após X segundos", "num"),
    ]),
    ("🚫 AntiBot", [
        ("antibot_channel_id", "Canal armadilha", "ch"),
        ("antibot_log_channel_id", "Canal de logs do AntiBot", "ch"),
        ("antibot_title", "Título do painel", "text"),
        ("antibot_description", "Descrição do painel", "area"),
        ("antibot_banner_url", "Banner (URL)", "text"),
        ("antibot_punish_ban", "Banir quem enviar mensagem", "bool"),
        ("antibot_delete_messages", "Apagar mensagens do infrator", "bool"),
    ]),
    ("🛡️ Filtros de Palavras/Links", [
        ("filters_enabled", "Filtros ativados", "bool"),
        ("filters_punish_after_warnings", "Avisos até aplicar castigo (0 = desliga)", "num"),
        ("filters_links_allowed_role_ids", "Cargos que podem mandar links", "role"),
        ("filters_log_channel_id", "Canal de logs de filtros", "ch"),
        ("filters_blocked_words", "Palavras bloqueadas (uma por linha)", "list"),
        ("filters_allowed_domains", "Domínios de link permitidos (um por linha)", "list"),
    ]),
    ("🎫 Tickets (5 opções)", [
        ("ticket_panel_channel_id", "Canal do painel de tickets", "ch"),
        ("ticket_logs_channel_id", "Canal de logs de tickets", "ch"),
        ("ticket_category_movcall_id", "Categoria: MOV CALL", "cat"),
        ("ticket_category_movchat_id", "Categoria: MOV CHAT", "cat"),
        ("ticket_category_recrute_id", "Categoria: RECRUTE-S", "cat"),
        ("ticket_category_support_id", "Categoria: SUPORTE", "cat"),
        ("ticket_category_others_id", "Categoria: OUTROS", "cat"),
        ("ticket_support_role_ids", "Cargos de staff (mencionados no ticket)", "role"),
        ("ticket_panel_title", "Título do painel ({brand} = nome da marca)", "text"),
        ("ticket_panel_description", "Descrição do painel", "area"),
        ("ticket_panel_select_placeholder", "Placeholder do menu", "text"),
        ("ticket_label_movcall", "Label MOV CALL", "text"),
        ("ticket_emoji_movcall", "Emoji MOV CALL", "text"),
        ("ticket_label_movchat", "Label MOV CHAT", "text"),
        ("ticket_emoji_movchat", "Emoji MOV CHAT", "text"),
        ("ticket_label_recrute", "Label RECRUTE-S", "text"),
        ("ticket_emoji_recrute", "Emoji RECRUTE-S", "text"),
        ("ticket_label_support", "Label SUPORTE", "text"),
        ("ticket_emoji_support", "Emoji SUPORTE", "text"),
        ("ticket_label_others", "Label OUTROS", "text"),
        ("ticket_emoji_others", "Emoji OUTROS", "text"),
    ]),
    ("⭐ Feedback & Sugestões", [
        ("feedback_channel_id", "Canal de logs de avaliações", "ch"),
        ("feedback_panel_channel_id", "Canal do painel de avaliações", "ch"),
        ("feedback_panel_title", "Título do painel de avaliações", "text"),
        ("feedback_panel_description", "Descrição do painel de avaliações", "area"),
        ("suggestions_channel_id", "Canal onde as sugestões chegam", "ch"),
        ("suggestions_panel_channel_id", "Canal do painel de sugestões", "ch"),
    ]),
    ("👋 Boas-vindas", [
        ("welcome_channel_id", "Canal de boas-vindas (card)", "ch"),
        ("welcome_message", "Mensagem de boas-vindas", "area"),
        ("welcome_image_url", "Imagem de boas-vindas (URL)", "text"),
        ("leave_channel_id", "Canal de saída", "ch"),
        ("leave_message", "Mensagem de saída", "area"),
        ("auto_role_id", "Cargo automático ao entrar", "role_single"),
        ("welcome_mention_channel_id", "Canal da menção de boas-vindas", "ch"),
        ("welcome_mention_message", "Mensagem de menção (use {user})", "text"),
        ("welcome_mention_delete_seconds", "Apagar menção após X segundos", "num"),
    ]),
    ("🏆 Níveis (MEE6)", [
        ("levels_enabled", "Sistema de níveis ativado", "bool"),
        ("levels_xp_per_message", "XP por mensagem", "num"),
        ("levels_xp_cooldown_seconds", "Cooldown entre XP (segundos)", "num"),
        ("levels_announce_channel_id", "Canal de anúncio de level up", "ch"),
        ("levels_message_up", "Mensagem de level up (use {user}, {level}, {xp})", "area"),
    ]),
    ("💎 VIP", [
        ("vip_enabled", "Sistema VIP ativado", "bool"),
        ("vip_role_base_id", "Cargo base que identifica VIPs", "role_single"),
        ("vip_allow_custom_color", "VIP pode mudar cor do cargo", "bool"),
        ("vip_allow_custom_name", "VIP pode mudar nome do cargo", "bool"),
        ("vip_allow_custom_tag", "VIP pode definir tag", "bool"),
        ("vip_max_members", "Máx. membros por VIP", "num"),
        ("vip_panel_channel_id", "Canal do painel VIP", "ch"),
    ]),
    ("👮 Staff / Moderação", [
        ("staff_role_ids", "Cargos de staff", "role"),
        ("staff_movchat_role_ids", "Cargos MOV CHAT (meta de mensagens)", "role"),
        ("staff_movchat_goal", "Meta mensal de mensagens MOV CHAT", "num"),
        ("staff_call_goal_hours", "Meta mensal de horas em call", "num"),
        ("staff_report_channel_id", "Canal de relatórios", "ch"),
        ("staff_punish_channel_id", "Canal de logs de punições", "ch"),
        ("staff_warn_ban_threshold", "Avisos antes de ban automático", "num"),
    ]),
    ("➕ /addcargo", [
        ("addcargo_allowed_role_ids", "Cargos que podem usar /addcargo", "role"),
        ("addcargo_panel_channel_id", "Canal do painel público do /addcargo", "ch"),
    ]),
    ("🔊 Voz e Status", [
        ("voice_channel_id", "Call fixa do bot", "vc"),
        ("voice_mute", "Bot entra mutado", "bool"),
        ("bot_status", "Status", "choice:online=Online,idle=Ausente,dnd=Não perturbe,invisible=Invisível"),
        ("voice_join_log_channel_id", "Log: entrada em call", "ch"),
        ("voice_leave_log_channel_id", "Log: saída de call", "ch"),
        ("moderation_logs_channel_id", "Log de moderação", "ch"),
        ("painel_channel_id", "Canal do painel admin fixo", "ch"),
        ("admin_role_ids", "Cargos administradores do bot", "role"),
    ]),
]

assert len(SECTION_SLUGS) == len(SECTIONS), "SECTION_SLUGS e SECTIONS fora de sincronia"

# ==================== CONFIG FILE ====================
def read_config():
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def write_config(cfg):
    tmp = CONFIG_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=4, ensure_ascii=False)
    os.replace(tmp, CONFIG_FILE)

# ==================== DISCORD CACHE ====================
_cache = {"t": 0, "gid": None, "data": None}

def discord_guild_data(gid):
    if not gid or not DISCORD_BOT_TOKEN:
        return {"ch": [], "vc": [], "cat": [], "role": []}
    if _cache["data"] and _cache["gid"] == gid and time.time() - _cache["t"] < 60:
        return _cache["data"]
    h = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
    out = {"ch": [], "vc": [], "cat": [], "role": []}
    try:
        chs   = requests.get(f"{DISCORD_API}/guilds/{gid}/channels", headers=h, timeout=8).json()
        roles = requests.get(f"{DISCORD_API}/guilds/{gid}/roles", headers=h, timeout=8).json()
        cats = {c["id"]: c["name"] for c in chs if c["type"] == 4}
        for c in sorted(chs, key=lambda x: x.get("position", 0)):
            label = c["name"]
            if c.get("parent_id") in cats:
                label = f"{cats[c['parent_id']]} › {label}"
            if c["type"] in (0, 5): out["ch"].append((c["id"], "#" + label))
            elif c["type"] == 2:    out["vc"].append((c["id"], "🔊 " + label))
            elif c["type"] == 4:    out["cat"].append((c["id"], c["name"]))
        out["role"] = [(r["id"], "@" + r["name"]) for r in sorted(roles, key=lambda r: -r["position"])
                       if r["name"] != "@everyone"]
        _cache.update(t=time.time(), gid=gid, data=out)
    except Exception:
        pass
    return out

# ==================== OAUTH DISCORD ====================
def discord_login_url():
    state = secrets.token_urlsafe(32)
    session["oauth_state"] = state
    params = {
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": f"{BASE_URL}/callback",
        "response_type": "code",
        "scope": "identify guilds",
        "state": state,
        "prompt": "consent",
    }
    return f"{OAUTH_AUTHORIZE}?{urlencode(params)}"

def exchange_code(code):
    data = {
        "client_id": DISCORD_CLIENT_ID,
        "client_secret": DISCORD_CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": f"{BASE_URL}/callback",
    }
    r = requests.post(OAUTH_TOKEN, data=data,
                      headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=10)
    return r.json()

def fetch_discord_user(access_token):
    r = requests.get(f"{DISCORD_API}/users/@me",
                     headers={"Authorization": f"Bearer {access_token}"}, timeout=8)
    return r.json() if r.status_code == 200 else None

# ==================== CSRF + GUARD ====================
def csrf():
    if "csrf" not in session:
        session["csrf"] = secrets.token_hex(16)
    return session["csrf"]

app.jinja_env.globals["csrf"] = csrf

@app.before_request
def guard():
    if request.endpoint in ("login", "auth", "callback", "static", "healthz"):
        return
    if not session.get("user"):
        return redirect(url_for("login"))
    if request.method == "POST" and not hmac.compare_digest(request.form.get("_csrf", ""), session.get("csrf", "x")):
        return "CSRF inválido", 400

# ==================== ROTAS ====================
@app.route("/login")
def login():
    return render_template_string(LOGIN_HTML)

@app.route("/auth")
def auth():
    return redirect(discord_login_url())

@app.route("/callback")
def callback():
    err = request.args.get("error")
    if err:
        return redirect(url_for("login"))
    state = request.args.get("state")
    code  = request.args.get("code")
    if not state or state != session.get("oauth_state"):
        return "Estado inválido", 400
    session.pop("oauth_state", None)
    if not code:
        return redirect(url_for("login"))
    token_data = exchange_code(code)
    access_token = token_data.get("access_token")
    if not access_token:
        return f"Falha ao obter token: {token_data}", 400
    user = fetch_discord_user(access_token)
    if not user:
        return "Falha ao buscar usuário.", 400

    uid = int(user["id"])
    if uid in DEV_IDS:
        role = "dev"
    elif uid in OWNER_IDS:
        role = "owner"
    elif uid in STAFF_PERMS:
        role = "staff"
    else:
        return render_template_string(NOT_OWNER_HTML, user=user), 403

    session["user"] = {
        "id": user["id"],
        "username": user["username"],
        "global_name": user.get("global_name") or user["username"],
        "avatar": user.get("avatar"),
        "role": role,
        "allowed_sections": None if role in ("owner", "dev") else STAFF_PERMS.get(uid, []),
    }
    return redirect(url_for("index"))

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

@app.route("/healthz")
def healthz():
    return jsonify(ok=True)

def int_or_none(v):
    v = (v or "").strip()
    return int(v) if v.isdigit() else None

def _visible_sections_for(user_data):
    allowed = user_data.get("allowed_sections")
    if allowed is None:
        return SECTIONS
    return [s for slug, s in zip(SECTION_SLUGS, SECTIONS) if slug in allowed]

def _editable_fields_for(user_data):
    allowed = user_data.get("allowed_sections")
    if allowed is None:
        return [f for _, fields in SECTIONS for f in fields]
    fields = []
    for slug, (_, f) in zip(SECTION_SLUGS, SECTIONS):
        if slug in allowed:
            fields.extend(f)
    return fields

@app.route("/", methods=["GET", "POST"])
def index():
    cfg = read_config()
    user_data = session["user"]

    if request.method == "POST":
        editable = _editable_fields_for(user_data)
        for key, _label, typ in editable:
            if typ == "list":
                raw = request.form.get(key, "").replace("\r\n", "\n")
                cfg[key] = [ln.strip() for ln in raw.split("\n") if ln.strip()]
            elif typ == "area":
                cfg[key] = request.form.get(key, "").replace("\r\n", "\n")
            elif typ.startswith("choice"):
                cfg[key] = request.form.get(key, "").strip()
            elif typ == "text":
                cfg[key] = request.form.get(key, "").strip()
            elif typ == "color":
                try: cfg[key] = int(request.form.get(key, "#000000").lstrip("#"), 16)
                except ValueError: pass
            elif typ == "bool":
                cfg[key] = key in request.form
            elif typ == "num":
                try: cfg[key] = int(request.form.get(key, "0"))
                except ValueError: pass
            elif typ == "role_single":
                raw = request.form.getlist(key)
                cfg[key] = int(raw[0]) if raw and raw[0].isdigit() else None
            elif typ in ("ch", "vc", "cat"):
                cfg[key] = int_or_none(request.form.get(key))
            elif typ == "role":
                cfg[key] = [int(x) for x in request.form.getlist(key) if x.isdigit()]
        write_config(cfg)
        flash("Configurações salvas com sucesso. Aplicando no bot…")
        return redirect(url_for("index"))

    visible_sections = _visible_sections_for(user_data)
    dd = discord_guild_data(cfg.get("guild_id"))
    return render_template_string(
        DASHBOARD_HTML,
        sections=visible_sections,
        cfg=cfg, dd=dd,
        user=user_data,
        hexcolor=lambda n: "#%06x" % (n if isinstance(n, int) else 0),
    )

# ==================== TEMPLATES ====================
STYLE = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700;800&display=swap');
:root{
  --black:#050505;--black-soft:#0a0a0a;--black-card:rgba(15,15,15,0.6);--black-elevated:#141414;
  --purple:#8A4FFF;--purple-hi:#A370FF;--purple-lo:#6B2EE0;--purple-glow:rgba(138,79,255,0.4);
  --white:#FFFFFF;--white-soft:#F5F5F5;
  --gray-hi:#B8B8C2;--gray-mid:#7A7A88;--gray-lo:#4A4A55;
  --border:rgba(255,255,255,0.08);--border-hi:rgba(138,79,255,0.35);
  --ok:#4ade80;--warn:#fbbf24;--err:#f87171;
  --radius-sm: 12px;
  --radius: 24px;
  --radius-lg: 32px;
  --radius-pill: 99px;
  --ease:cubic-bezier(0.4, 0, 0.2, 1);
  --shadow-soft: 0 10px 40px -10px rgba(0,0,0,0.8);
  --shadow-glow: 0 0 30px -5px var(--purple-glow);
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{
  background:var(--black);color:var(--white-soft);
  font-family:'Inter',system-ui,-apple-system,sans-serif;
  font-size:15px;line-height:1.6;
  -webkit-font-smoothing:antialiased;letter-spacing:-0.005em;min-height:100vh;
}
h1,h2,h3,.display{font-family:'Archivo Black','Inter',sans-serif;letter-spacing:-0.035em;line-height:1.02}
a{color:var(--purple-hi);text-decoration:none;transition:color .18s var(--ease)}
a:hover{color:var(--white)}
button{font-family:inherit;cursor:pointer;border:0;background:none;color:inherit;font-size:inherit}
img{display:block;max-width:100%}
::selection{background:var(--purple);color:var(--white)}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:var(--radius-pill)}
::-webkit-scrollbar-thumb:hover{background:var(--purple)}
</style>"""

LOGIN_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="description" content="PXKK Dashboard — gerencie seu bot Discord.">
<title>Login — PXKK</title>
""" + STYLE + """
<style>
/* Layout base para a tela de login */
.login-page {
    min-height: 100vh;
    background: 
        radial-gradient(circle at 20% 30%, rgba(138, 79, 255, 0.15) 0%, transparent 50%),
        radial-gradient(circle at 80% 70%, rgba(138, 79, 255, 0.1) 0%, transparent 50%),
        #040404;
    background-attachment: fixed;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
}

/* Efeito de grade de fundo (Grid Pattern) */
.login-page::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: 
        linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
    background-size: 64px 64px;
    mask-image: radial-gradient(circle at 50% 50%, black 20%, transparent 80%);
    -webkit-mask-image: radial-gradient(circle at 50% 50%, black 20%, transparent 80%);
    pointer-events: none;
    z-index: 0;
}

/* Navbar Superior */
.login-nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24px 48px;
    position: relative;
    z-index: 10;
}
.nav-logo {
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: 'Archivo Black', sans-serif;
    font-size: 24px;
    color: var(--white);
    letter-spacing: -0.03em;
}
.nav-logo .logo-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    border: 1px solid var(--border-hi);
    box-shadow: 0 0 15px var(--purple-glow);
}
.nav-logo .logo-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.nav-links {
    display: flex;
    gap: 32px;
    align-items: center;
}
.nav-links a {
    color: var(--gray-hi);
    font-size: 14px;
    font-weight: 600;
    transition: color 0.2s;
}
.nav-links a:hover {
    color: var(--white);
}
.nav-btn-login {
    padding: 10px 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.03);
    color: var(--white);
    font-size: 14px;
    font-weight: 600;
    transition: all 0.2s;
}
.nav-btn-login:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--border-hi);
}

/* Container Central */
.login-wrapper {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    position: relative;
    z-index: 5;
}

/* CARD GLASSMORPHISM (Imitando a imagem de referência) */
.glass-card {
    background: rgba(15, 15, 15, 0.5);
    backdrop-filter: blur(24px) saturate(1.2);
    -webkit-backdrop-filter: blur(24px) saturate(1.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-lg);
    width: 100%;
    max-width: 420px;
    padding: 48px 40px;
    box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.8), 0 0 40px -10px rgba(138, 79, 255, 0.15);
    position: relative;
    animation: floatIn 0.6s var(--ease);
}
@keyframes floatIn {
    from { opacity: 0; transform: translateY(20px) scale(0.98); }
    to { opacity: 1; transform: none; }
}

/* Botão Fechar (X) */
.close-btn {
    position: absolute;
    top: 20px;
    right: 20px;
    width: 32px;
    height: 32px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gray-hi);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    transition: all 0.2s;
}
.close-btn:hover {
    background: var(--err);
    color: var(--white);
    border-color: var(--err);
    transform: rotate(90deg);
}

/* Título */
.glass-card h2 {
    font-family: 'Archivo Black', sans-serif;
    font-size: 32px;
    color: var(--white);
    text-align: center;
    margin-bottom: 32px;
    letter-spacing: -0.03em;
}

/* Inputs Minimalistas (Apenas linha inferior) */
.input-group {
    position: relative;
    margin-bottom: 24px;
}
.input-group input {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 2px solid rgba(255, 255, 255, 0.15);
    padding: 12px 32px 12px 0;
    color: var(--white);
    font-size: 15px;
    transition: all 0.3s;
    border-radius: 0;
    box-shadow: none;
}
.input-group input:focus {
    outline: none;
    border-bottom-color: var(--purple);
}
.input-group input::placeholder {
    color: var(--gray-mid);
    font-weight: 500;
}
.input-group svg {
    position: absolute;
    right: 0;
    bottom: 14px;
    width: 18px;
    height: 18px;
    color: var(--gray-mid);
    pointer-events: none;
    transition: color 0.3s;
}
.input-group input:focus + svg {
    color: var(--purple);
}

/* Linha de Opções (Lembrar de mim / Esqueceu senha) */
.options-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 32px;
    font-size: 13px;
}
.checkbox-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--gray-hi);
    cursor: pointer;
}
.checkbox-wrap input[type="checkbox"] {
    appearance: none;
    width: 16px;
    height: 16px;
    border: 1px solid var(--gray-mid);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    position: relative;
    transition: all 0.2s;
}
.checkbox-wrap input[type="checkbox"]:checked {
    background: var(--purple);
    border-color: var(--purple);
}
.checkbox-wrap input[type="checkbox"]:checked::after {
    content: '✔';
    position: absolute;
    top: -2px;
    left: 2px;
    color: var(--white);
    font-size: 11px;
}
.options-row a {
    color: var(--purple-hi);
    font-weight: 600;
}
.options-row a:hover {
    color: var(--white);
    text-decoration: underline;
}

/* Botão Principal (Discord Login) */
.btn-submit {
    width: 100%;
    padding: 16px;
    background: var(--black-elevated);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-sm);
    color: var(--white);
    font-size: 15px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    cursor: pointer;
    transition: all 0.3s;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.btn-submit:hover {
    background: var(--purple);
    border-color: var(--purple);
    box-shadow: 0 10px 30px -10px var(--purple-glow);
    transform: translateY(-2px);
}

/* Rodapé do Card */
.card-footer {
    margin-top: 28px;
    text-align: center;
    font-size: 13.5px;
    color: var(--gray-mid);
}
.card-footer a {
    color: var(--white);
    font-weight: 600;
}
.card-footer a:hover {
    text-decoration: underline;
}

/* Responsivo */
@media (max-width: 768px) {
    .login-nav { padding: 20px; }
    .nav-links { display: none; }
    .glass-card { padding: 36px 24px; }
    .glass-card h2 { font-size: 28px; }
}
</style></head>
<body>

<div class="login-page">
    <!-- Menu Superior -->
    <nav class="login-nav">
        <div class="nav-logo">
            <span class="logo-icon"><img src="/static/logo.gif" alt="Logo"></span>
            PXKK
        </div>
        <div class="nav-links">
            <a href="#">Home</a>
            <a href="#">Sobre</a>
            <a href="#">Serviços</a>
            <a href="#">Contato</a>
        </div>
        <a href="/auth" class="nav-btn-login">Login</a>
    </nav>

    <!-- Container do Card Central -->
    <div class="login-wrapper">
        <div class="glass-card">
            <!-- Botão Fechar (Voltar) -->
            <a href="/" class="close-btn">&times;</a>
            
            <h2>Login</h2>
            
            <form action="/auth" method="GET">
                <!-- Campo E-mail (Visual apenas, já que o login é via Discord) -->
                <div class="input-group">
                    <input type="text" placeholder="E-mail ou Discord ID" disabled style="opacity: 0.5; cursor: not-allowed;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                </div>
                
                <!-- Campo Senha (Visual apenas) -->
                <div class="input-group">
                    <input type="password" placeholder="Senha" disabled style="opacity: 0.5; cursor: not-allowed;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </div>

                <!-- Linha de Opções -->
                <div class="options-row">
                    <label class="checkbox-wrap">
                        <input type="checkbox" checked>
                        Lembrar de mim
                    </label>
                    <a href="#">Esqueceu a senha?</a>
                </div>

                <!-- Botão de Ação Principal -->
                <button type="submit" class="btn-submit">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.3.5a14.7 14.7 0 0 1 4.3 2.2 15 15 0 0 0-12.8 0A14.6 14.6 0 0 1 10.9 3.5L10.6 3a19.7 19.7 0 0 0-4.9 1.4C2.6 8.6 1.9 12.7 2.3 16.7a19.8 19.8 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14 14 0 0 0 12.8 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.8 19.8 0 0 0 6-3c.5-4.6-.7-8.6-3.4-12.3ZM9 14.6c-1.2 0-2.2-1.1-2.2-2.4S7.8 9.8 9 9.8s2.2 1.1 2.2 2.4S10.2 14.6 9 14.6Zm6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
                    Entrar com Discord
                </button>
            </form>

            <!-- Rodapé -->
            <div class="card-footer">
                Não tem uma conta? <a href="#">Registre-se</a>
            </div>
        </div>
    </div>
</div>

</body></html>"""

NOT_OWNER_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acesso negado — PXKK</title><meta name="robots" content="noindex">
""" + STYLE + """
<style>
body{background:var(--black)}
.denied{min-height:100vh;display:grid;place-items:center;padding:24px;
  background:radial-gradient(ellipse 800px 500px at 50% -10%,rgba(248,113,113,.08),transparent 60%),
             radial-gradient(ellipse 600px 400px at 50% 110%,rgba(138,79,255,.06),transparent 60%),var(--black);
  position:relative}
.denied::before{content:'';position:absolute;inset:0;
  background-image:linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px);
  background-size:56px 56px;
  mask-image:radial-gradient(ellipse 60% 60% at 50% 50%,#000 20%,transparent 90%);
  -webkit-mask-image:radial-gradient(ellipse 60% 60% at 50% 50%,#000 20%,transparent 90%);pointer-events:none}
.denied-card{position:relative;max-width:440px;width:100%;background:var(--black-soft);
  border:1px solid var(--border);padding:56px 40px;text-align:center;z-index:1; border-radius: var(--radius-lg); box-shadow: var(--shadow-soft);}
.denied-card::before{content:'';position:absolute;top:-1px;left:32px;right:32px;height:1px;
  background:linear-gradient(90deg,transparent,var(--err),transparent); border-radius: var(--radius-lg) var(--radius-lg) 0 0;}
.denied-icon{width:76px;height:76px;margin:0 auto 24px;border:1px solid rgba(248,113,113,.4);
  display:grid;place-items:center;font-size:34px;background:radial-gradient(circle,rgba(248,113,113,.08),transparent 70%); border-radius: var(--radius);}
.denied-card h1{font-family:'Archivo Black',sans-serif;font-size:26px;letter-spacing:-.03em;
  margin-bottom:12px;color:var(--white);text-transform:uppercase;line-height:1.05}
.denied-card p{color:var(--gray-hi);font-size:14px;line-height:1.65;margin-bottom:8px}
.user-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border:1px solid var(--border);
  margin:24px 0 28px;font-size:12.5px;color:var(--gray-hi);background:rgba(255,255,255,.02);font-weight:500; border-radius: var(--radius-pill);}
.user-chip b{color:var(--white);font-weight:600}
.user-chip svg{color:var(--purple-hi)}
.btn-back{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:14px 28px;
  border:1px solid var(--purple);background:transparent;color:var(--white);font-weight:600;font-size:13px;
  letter-spacing:.02em;transition:all .2s var(--ease);text-transform:uppercase; border-radius: var(--radius-pill);}
.btn-back:hover{background:var(--purple);box-shadow:0 0 30px -6px var(--purple-glow);color:var(--white);transform:translateY(-1px)}
</style></head>
<body>
<div class="denied"><div class="denied-card">
<div class="denied-icon">🚫</div>
<h1>Acesso<br>Negado</h1>
<p>Este painel é privado e restrito à equipe autorizada.</p>
<div class="user-chip">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/></svg>
  <b>{{user.username}}</b>
</div>
<br>
<a href="/logout" class="btn-back">
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
  Sair da conta
</a>
</div></div></body></html>"""

DASHBOARD_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#000000"><meta name="robots" content="noindex">
<title>Dashboard — PXKK</title>
""" + STYLE + """
<style>
/* FUNDO GLOBAL */
body { 
  background: 
    radial-gradient(circle at 15% 0%, rgba(138,79,255,0.1) 0%, transparent 40%),
    radial-gradient(circle at 85% 100%, rgba(138,79,255,0.06) 0%, transparent 40%),
    #040404;
  background-attachment: fixed;
  padding: 16px;
}

/* TOPBAR - Estilo Flutuante Pílula */
.topbar{position:fixed;top:16px;left:16px;right:16px;z-index:100;display:flex;align-items:center;gap:20px;height:72px;padding:0 24px;
  background:rgba(10,10,10,.7);backdrop-filter:blur(24px) saturate(1.5);-webkit-backdrop-filter:blur(24px) saturate(1.5);
  border:1px solid var(--border);box-shadow:0 10px 30px rgba(0,0,0,0.5); border-radius: var(--radius-pill);}
.topbar::after{content:'';position:absolute;bottom:-1px;left:20px;right:20px;height:1px;
  background:linear-gradient(90deg,transparent,var(--purple),transparent);opacity:.3;pointer-events:none}

/* HAMBURGER (MOBILE) */
.hamburger{display:none; width:44px;height:44px;align-items:center;justify-content:center;flex-direction:column;gap:5px;
  transition:all .2s var(--ease);border:1px solid transparent;border-radius:50%;cursor:pointer;flex-shrink:0;}
.hamburger:hover{background:rgba(255,255,255,0.05);border-color:var(--border)}
.hamburger span{display:block;width:20px;height:2px;background:var(--white);transition:transform .3s var(--ease),opacity .2s;border-radius:2px;}
.hamburger.open span:nth-child(1){transform:translateY(7px) rotate(45deg)}
.hamburger.open span:nth-child(2){opacity:0}
.hamburger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}

.brand{display:flex;align-items:center;gap:14px;color:var(--white);text-decoration:none;flex-shrink:0}
.brand-icon{width:44px;height:44px;border:1px solid rgba(138,79,255,0.3);display:grid;place-items:center;font-size:16px;
  background:radial-gradient(circle at 30% 30%,rgba(138,79,255,.2),transparent 70%);box-shadow:0 0 24px -6px var(--purple-glow);overflow:hidden;border-radius:50%;}
.brand-icon img{width:100%;height:100%;object-fit:cover;display:block;}
.brand-text{display:flex;flex-direction:column;line-height:1}
.brand-text .name{font-family:'Archivo Black',sans-serif;font-weight:400;font-size:20px;letter-spacing:-.03em;color:var(--white)}
.brand-text .sub{font-size:10px;color:var(--gray-mid);font-weight:800;letter-spacing:.25em;text-transform:uppercase;margin-top:4px}
.spacer{flex:1}

/* MENU USUÁRIO */
.user-wrap{position:relative}
.user-trigger{display:flex;align-items:center;gap:12px;padding:6px 16px 6px 6px;background:rgba(255,255,255,0.03);
  border:1px solid var(--border);transition:all .2s var(--ease);border-radius:var(--radius-pill);cursor:pointer;backdrop-filter:blur(10px);}
.user-trigger:hover{background:rgba(255,255,255,0.06);border-color:var(--border-hi);box-shadow:0 0 20px -8px var(--purple-glow)}
.user-trigger .avatar{width:38px;height:38px;border:1px solid var(--border-hi);border-radius:50%;object-fit:cover;}
.user-trigger .name{font-size:14px;font-weight:600;color:var(--white);letter-spacing:-.01em;}
.role-badge{font-size:10px;padding:4px 10px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--white);white-space:nowrap;border-radius:var(--radius-pill);box-shadow:0 2px 10px rgba(0,0,0,0.5);}
.role-owner{background:linear-gradient(135deg, var(--purple), #6B2EE0);}
.role-dev{background:linear-gradient(135deg, #3b82f6, #2563eb);}
.role-staff{background:var(--gray-lo);}
.user-trigger .chev{transition:transform .22s var(--ease);color:var(--gray-mid);margin-left:4px;}
.user-trigger.open .chev{transform:rotate(180deg)}
.dropdown{position:absolute;top:calc(100% + 12px);right:0;min-width:280px;background:rgba(15,15,15,.98);
  backdrop-filter:blur(24px);border:1px solid var(--border-hi);padding:12px;border-radius:var(--radius-lg);
  box-shadow:0 24px 60px -20px rgba(0,0,0,.9),0 0 40px -8px var(--purple-glow);
  opacity:0;visibility:hidden;transform:translateY(-6px);transition:opacity .2s var(--ease),transform .2s var(--ease),visibility .2s}
.dropdown.open{opacity:1;visibility:visible;transform:none}
.dd-head{display:flex;gap:14px;align-items:center;padding:14px 12px;border-bottom:1px solid var(--border);margin-bottom:8px}
.dd-head img{width:44px;height:44px;border:1px solid var(--border-hi);border-radius:50%;object-fit:cover;}
.dd-head .dd-name{font-weight:700;font-size:14.5px;color:var(--white)}
.dd-head .dd-id{font-size:11px;color:var(--gray-mid);font-family:ui-monospace,'SF Mono',monospace;margin-top:4px;letter-spacing:.02em}
.dd-item{display:flex;align-items:center;gap:12px;padding:12px 14px;color:var(--gray-hi);font-size:13.5px;
  transition:all .15s var(--ease);font-weight:600;text-decoration:none;border-radius:var(--radius-sm);}
.dd-item:hover{background:rgba(138,79,255,.12);color:var(--white)}
.dd-item svg{color:var(--gray-mid);transition:color .15s;}
.dd-item:hover svg{color:var(--white);}

/* SIDEBAR E LAYOUT */
.layout{display:flex;min-height:calc(100vh - 104px);padding-top:96px;position:relative; gap: 16px;}
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:90;backdrop-filter:blur(4px)}
.overlay.show{display:block}

/* SIDEBAR PREMIUM - Estilo Cartão Flutuante */
.sidebar{width:280px;flex-shrink:0;background:var(--black-soft);border:1px solid var(--border);padding:24px 16px;
  overflow-y:auto;position:fixed;top:96px;bottom:16px;left:16px;z-index:99;
  border-radius:var(--radius-lg); box-shadow: var(--shadow-soft);
  transition:transform .35s cubic-bezier(0.4, 0, 0.2, 1);}
  
.sidebar-group { margin-bottom: 24px; }
.sidebar-group-title { font-size: 10px; font-weight: 800; color: var(--gray-mid); text-transform: uppercase;
  letter-spacing: .15em; padding: 0 16px; margin-bottom: 12px; display:flex; align-items:center; gap:8px; opacity:0.8;}
.sidebar-group-title svg { width: 14px; height: 14px; color: var(--purple); }

/* Botões de Navegação - Estilo Pílula */
.nav-btn{display:flex;align-items:center;gap:12px;width:100%;padding:12px 16px;color:var(--gray-hi);font-size:14px;
  font-weight:500;text-align:left;transition:all .2s var(--ease);margin-bottom:4px;position:relative;
  letter-spacing:-.01em;border-radius:var(--radius-pill);border:1px solid transparent;}
.nav-btn:hover{background:rgba(255,255,255,.04);color:var(--white); transform: translateX(4px);}
.nav-btn.active{background:linear-gradient(90deg,rgba(138,79,255,.15),rgba(138,79,255,.05));color:var(--white);
  font-weight:600;border-color:rgba(138,79,255,0.3); box-shadow: 0 4px 15px -5px rgba(138,79,255,0.3);}
.nav-btn.active::before{content:'';position:absolute;left:-16px;top:15px;bottom:15px;width:4px;background:var(--purple);border-radius:0 4px 4px 0;box-shadow:0 0 12px var(--purple); opacity: 0;}
.nav-icon{width:32px;height:32px;flex-shrink:0;display:grid;place-items:center;font-size:16px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,0.05);transition:all .2s var(--ease);border-radius:50%;}
.nav-btn.active .nav-icon{background:rgba(138,79,255,.25);border-color:rgba(138,79,255,0.5);color:var(--white);box-shadow:0 0 15px -2px var(--purple-glow);}
.nav-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}

/* CONTEÚDO PRINCIPAL */
.content{flex:1;min-width:0;padding:0 0 100px;display:flex;flex-direction:column;align-items:center;
  transition:margin-left .35s cubic-bezier(0.4, 0, 0.2, 1); margin-left:296px; width: 100%;}
.content-inner{max-width:1000px;width:100%;flex:1}

/* BANNER HERO (Imitando o banner grande da referência) */
.dash-hero { 
  background: linear-gradient(135deg, rgba(138,79,255,0.15) 0%, rgba(20,20,20,0.8) 100%);
  border: 1px solid var(--border-hi);
  border-radius: var(--radius-lg);
  padding: 40px;
  margin-bottom: 32px;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: var(--shadow-soft);
}
.dash-hero::before {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(circle at 80% 50%, rgba(138,79,255,0.2) 0%, transparent 50%);
  pointer-events: none;
}
.dash-hero-text h2 {
  font-family: 'Archivo Black', sans-serif;
  font-size: 32px;
  color: var(--white);
  margin-bottom: 8px;
  letter-spacing: -0.03em;
}
.dash-hero-text p {
  color: var(--gray-hi);
  font-size: 15px;
  max-width: 500px;
}
.dash-hero-emoji { font-size: 80px; line-height: 1; filter: drop-shadow(0 10px 20px rgba(138,79,255,0.3)); }

/* ALERTAS */
.alert{display:flex;align-items:center;gap:14px;padding:16px 24px;margin-bottom:32px;font-size:14px;
  font-weight:600;border:1px solid;animation:slideDown .32s var(--ease);border-radius:var(--radius-pill);
  background:rgba(74,222,128,.08);border-color:rgba(74,222,128,.3);color:#86efac;backdrop-filter:blur(10px);}
.alert.warn{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.3);color:#fde68a}
@keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}

/* CARDS DE SEÇÃO - Estilo Cartão Soft UI */
.section{display:none;background:var(--black-soft);
  border:1px solid var(--border);padding:48px;position:relative;border-radius:var(--radius-lg);
  box-shadow:var(--shadow-soft);}
.section::before{content:'';position:absolute;top:-1px;left:48px;right:48px;height:1px;
  background:linear-gradient(90deg,transparent,var(--purple),transparent);opacity:.6;pointer-events:none; border-radius: var(--radius-lg) var(--radius-lg) 0 0;}
.section.active{display:block;animation:fadeUp .35s var(--ease)}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.section-head{margin-bottom:36px;padding-bottom:28px;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;flex-direction:column;gap:8px;}
.section-head h2{font-family:'Archivo Black',sans-serif;font-size:28px;font-weight:400;letter-spacing:-.03em;
  color:var(--white);display:flex;align-items:center;gap:14px;text-transform:uppercase;line-height:1.1}
.section-head p{color:var(--gray-mid);font-size:14px;line-height:1.6;letter-spacing:-.005em}

/* FORMULÁRIO GRID */
.form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 32px; }
.f { display: flex; flex-direction: column; gap: 12px; }
.f.full-width { grid-column: 1 / -1; }
.f label{font-size:11px;color:var(--gray-hi);font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.f .hint{font-size:11.5px;color:var(--gray-lo);line-height:1.5;letter-spacing:.01em;margin-top:2px;}

/* INPUTS TÁTEIS - Estilo Pílula e Arredondado */
input[type=text],input[type=number],textarea,select{
  width:100%;padding:16px 20px;border:1px solid rgba(255,255,255,0.08);
  background:rgba(0,0,0,0.3);color:var(--white);font:inherit;font-size:14px;letter-spacing:-.005em;
  border-radius:var(--radius);transition:all .2s var(--ease);box-shadow:inset 0 2px 4px rgba(0,0,0,0.3);}
input[type=text]:hover,input[type=number]:hover,textarea:hover,select:hover { border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.5);}
input[type=text]:focus,input[type=number]:focus,textarea:focus,select:focus{
  outline:none;border-color:var(--purple);background:rgba(0,0,0,0.7);
  box-shadow:0 0 0 4px rgba(138,79,255,0.25), inset 0 2px 4px rgba(0,0,0,0.3);}
input::placeholder,textarea::placeholder{color:var(--gray-lo)}
textarea{min-height:120px;resize:vertical;font-family:inherit;line-height:1.6;border-radius:var(--radius);}
select[multiple]{min-height:150px;padding:8px;border-radius:var(--radius);}
select[multiple] option{padding:12px;margin:4px;background:#0a0a0a;color:var(--white);border-radius:var(--radius-sm);font-weight:500;}
select[multiple] option:checked{background:var(--purple);color:var(--white)}

/* COLOR PICKER APPLE STYLE */
.color-wrapper { display: flex; align-items: center; gap: 16px; background: rgba(0,0,0,0.3); padding: 10px 20px; border-radius: var(--radius-pill); border: 1px solid rgba(255,255,255,0.08); transition: all .2s; box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);}
.color-wrapper:hover { border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.5);}
input[type=color]{appearance:none; -webkit-appearance:none; width: 38px; height: 38px; border: none; padding: 0; background: transparent; cursor: pointer; border-radius: 50%; overflow: hidden;}
input[type=color]::-webkit-color-swatch-wrapper{padding:0;}
input[type=color]::-webkit-color-swatch{border: 2px solid rgba(255,255,255,0.2); border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.5);}
.color-hex { font-family: ui-monospace, 'SF Mono', monospace; font-size: 15px; color: var(--white); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }

/* TOGGLE PREMIUM */
.sw{display:flex;align-items:center;gap:20px;padding:16px 24px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);
  transition:all .2s var(--ease);cursor:pointer;border-radius:var(--radius);box-shadow:inset 0 2px 4px rgba(0,0,0,0.3);}
.sw:hover{border-color:rgba(255,255,255,0.2); background:rgba(0,0,0,0.5);}
.sw input[type=checkbox]{appearance:none;-webkit-appearance:none;width:52px;height:28px;background:var(--gray-lo);
  position:relative;cursor:pointer;flex-shrink:0;transition:background .25s var(--ease);border-radius:var(--radius-pill);box-shadow:inset 0 2px 4px rgba(0,0,0,0.5);}
.sw input[type=checkbox]::after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;
  background:#fff;transition:transform .25s var(--ease);box-shadow:0 2px 5px rgba(0,0,0,.5)}
.sw input[type=checkbox]:checked{background:var(--purple);box-shadow:0 0 15px -2px var(--purple-glow), inset 0 2px 4px rgba(0,0,0,0.2)}
.sw input[type=checkbox]:checked::after{transform:translateX(24px)}
.sw span{color:var(--white);font-size:14px;font-weight:500;cursor:pointer;flex:1;letter-spacing:-.01em}

/* BARRA SALVAR - Estilo Pílula Flutuante */
.save-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:50;padding:16px 32px;background:rgba(15,15,15,.95);
  backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);border:1px solid var(--border-hi);
  display:flex;justify-content:space-between;align-items:center;gap:24px; border-radius: var(--radius-pill);
  box-shadow: 0 20px 50px -10px rgba(0,0,0,0.8), 0 0 30px -5px rgba(138,79,255,0.3); max-width: 800px; width: calc(100% - 48px);}
.save-hint{color:var(--gray-mid);font-size:14px;letter-spacing:.01em; display:flex; align-items: center; gap:10px; font-weight:500; padding-left: 16px;}
.save-hint svg { color: var(--purple); }
.save-btn{padding:16px 36px;background:linear-gradient(135deg, var(--purple), #6B2EE0);color:var(--white);font-weight:800;font-size:14px;
  letter-spacing:.05em;text-transform:uppercase;transition:all .2s var(--ease);border:1px solid rgba(255,255,255,0.15);border-radius:var(--radius-pill);
  display:inline-flex;align-items:center;gap:10px;position:relative;overflow:hidden;box-shadow: 0 8px 24px -8px rgba(138,79,255,0.6);}
.save-btn::before{content:'';position:absolute;inset:0;
  background:linear-gradient(120deg,transparent,rgba(255,255,255,.2),transparent);
  transform:translateX(-100%);transition:transform .5s var(--ease)}
.save-btn:hover{background:linear-gradient(135deg, #A370FF, #8A4FFF); box-shadow:0 12px 32px -8px rgba(138,79,255,0.8);transform:translateY(-2px)}
.save-btn:hover::before{transform:translateX(100%)}
.save-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}

/* RESPONSIVO */
@media(max-width:1024px){
  .form-grid { grid-template-columns: 1fr; }
  .content { padding: 0 0 100px; }
}
@media(max-width:960px){
  body { padding: 0; }
  .topbar { top: 0; left: 0; right: 0; border-radius: 0; border-top: 0; border-left: 0; border-right: 0; padding: 0 16px; height: 64px; }
  .hamburger{display:flex;} 
  .brand-text .sub{display:none}
  .user-trigger .name{display:none}
  .user-trigger{padding:6px}
  .user-trigger .chev{display:none}
  
  .layout { padding-top: 80px; gap: 0; }
  .sidebar { transform: translateX(-120%); top: 80px; bottom: 16px; left: 16px; box-shadow: 24px 0 60px -10px rgba(0,0,0,.9); background:var(--black-soft); width: calc(100% - 32px); }
  .sidebar.open { transform: none; }
  
  .content { margin-left: 0; padding: 0 16px 100px; }
  .save-bar { bottom: 16px; padding: 12px; flex-direction: column; border-radius: var(--radius);}
  .save-hint{display:none}
  .save-btn{width:100%;justify-content:center}
  .section{padding:32px 20px; border-radius: var(--radius);}
  .section-head h2{font-size:22px}
  .dash-hero { flex-direction: column; text-align: center; padding: 32px 20px; gap: 24px; }
  .dash-hero-emoji { font-size: 64px; }
}
</style></head>
<body>
<header class="topbar">
  <button class="hamburger" id="hamburger" aria-label="Abrir menu" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>
  <a href="/" class="brand" aria-label="PXKK Dashboard">
    <span class="brand-icon" aria-hidden="true"><img src="/static/logo.gif" alt="Logo"></span>
    <span class="brand-text">
      <span class="name">PXKK</span>
      <span class="sub">Dashboard</span>
    </span>
  </a>
  <div class="spacer"></div>
  <div class="user-wrap">
    <button class="user-trigger" id="userTrigger" aria-haspopup="true" aria-expanded="false">
      <img class="avatar" src="https://cdn.discordapp.com/avatars/{{user.id}}/{{user.avatar}}.png?size=64" alt="">
      <span class="name">{{user.global_name}}</span>
      <span class="role-badge role-{{user.role}}">
        {% if user.role=='owner' %}Dono{% elif user.role=='dev' %}Dev{% else %}Staff{% endif %}
      </span>
      <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="dropdown" id="userDropdown" role="menu">
      <div class="dd-head">
        <img src="https://cdn.discordapp.com/avatars/{{user.id}}/{{user.avatar}}.png?size=64" alt="">
        <div>
          <div class="dd-name">{{user.global_name}}</div>
          <div class="dd-id">ID · {{user.id}}</div>
        </div>
      </div>
      <a href="/logout" class="dd-item" role="menuitem">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
        Sair da conta
      </a>
    </div>
  </div>
</header>

<div class="layout">
  <div class="overlay" id="overlay"></div>
  <aside class="sidebar" id="sidebar" aria-label="Navegação">
    
    <div class="sidebar-group">
      <div class="sidebar-group-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Geral
      </div>
      {% for title, _ in sections[:4] %}
        {% set parts = title.split(' ', 1) %}
        <button class="nav-btn {{'active' if loop.first}}" data-t="{{loop.index0}}">
          <span class="nav-icon" aria-hidden="true">{{parts[0]}}</span>
          <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
        </button>
      {% endfor %}
    </div>

    <div class="sidebar-group">
      <div class="sidebar-group-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        Segurança
      </div>
      {% for title, _ in sections[4:7] %}
        {% set parts = title.split(' ', 1) %}
        <button class="nav-btn" data-t="{{loop.index0 + 4}}">
          <span class="nav-icon" aria-hidden="true">{{parts[0]}}</span>
          <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
        </button>
      {% endfor %}
    </div>

    <div class="sidebar-group">
      <div class="sidebar-group-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        Atendimento
      </div>
      {% for title, _ in sections[7:9] %}
        {% set parts = title.split(' ', 1) %}
        <button class="nav-btn" data-t="{{loop.index0 + 7}}">
          <span class="nav-icon" aria-hidden="true">{{parts[0]}}</span>
          <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
        </button>
      {% endfor %}
    </div>

    <div class="sidebar-group">
      <div class="sidebar-group-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
        Comunidade
      </div>
      {% for title, _ in sections[9:] %}
        {% set parts = title.split(' ', 1) %}
        <button class="nav-btn" data-t="{{loop.index0 + 9}}">
          <span class="nav-icon" aria-hidden="true">{{parts[0]}}</span>
          <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
        </button>
      {% endfor %}
    </div>

  </aside>

  <main class="content">
    <div class="content-inner">
      
      <!-- Hero Banner (Imitando a referência) -->
      <div class="dash-hero">
        <div class="dash-hero-text">
          <h2>Bem-vindo(a) ao Painel</h2>
          <p>Gerencie todas as configurações do PXKK de forma rápida e segura. As alterações são aplicadas automaticamente em tempo real.</p>
        </div>
        <div class="dash-hero-emoji">⚙️</div>
      </div>

      {% for m in get_flashed_messages() %}
        <div class="alert" role="status">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>
          {{m}}
        </div>
      {% endfor %}
      {% if not cfg.get('guild_id') %}
        <div class="alert warn" role="alert">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>
          O bot ainda não registrou um servidor. Inicie o bot primeiro.
        </div>
      {% endif %}
      
      {% if not sections %}
        <div class="empty">
          <div class="ic" aria-hidden="true">🔒</div>
          <h2>Nenhuma seção liberada</h2>
          <p>Você ainda não tem permissão para editar nenhuma seção. Fale com o administrador do sistema.</p>
        </div>
      {% else %}
      <form method="post" id="cfgForm" novalidate>
        <input type="hidden" name="_csrf" value="{{csrf()}}">
        {% for title, fields in sections %}
        <section id="s{{loop.index0}}" class="section {{'active' if loop.first}}" aria-labelledby="h{{loop.index0}}">
          <div class="section-head">
            <h2 id="h{{loop.index0}}">{{title}}</h2>
            <p>As alterações são aplicadas automaticamente no bot em até 5 segundos.</p>
          </div>
          
          <div class="form-grid">
          {% for key,label,typ in fields %}{% set v = cfg.get(key) %}
            {% set full_width = typ in ['area', 'list', 'role'] %}
            <div class="f {{ 'full-width' if full_width }}">
              {% if typ=='bool' %}
                <label class="sw" for="{{key}}">
                  <input type="checkbox" id="{{key}}" name="{{key}}" {{'checked' if v}}>
                  <span>{{label}}</span>
                </label>
              {% else %}
                <label for="{{key}}">{{label}}</label>
                {% if typ=='text' %}
                  <input type="text" id="{{key}}" name="{{key}}" value="{{v or ''}}">
                {% elif typ=='area' %}
                  <textarea id="{{key}}" name="{{key}}">{{v or ''}}</textarea>
                {% elif typ=='list' %}
                  <textarea id="{{key}}" name="{{key}}">{{ (v or [])|join('\n') }}</textarea><div class="hint">Uma linha por item</div>
                {% elif typ=='num' %}
                  <input type="number" id="{{key}}" name="{{key}}" value="{{v or 0}}" min="0">
                {% elif typ=='color' %}
                  <div class="color-wrapper">
                    <input type="color" id="{{key}}" name="{{key}}" value="{{hexcolor(v)}}">
                    <span class="color-hex">{{hexcolor(v)}}</span>
                  </div>
                {% elif typ.startswith('choice') %}
                  <select id="{{key}}" name="{{key}}">
                    {% for o in typ[7:].split(',') %}{% set kv=o.split('=') %}
                      <option value="{{kv[0]}}" {{'selected' if v==kv[0]}}>{{kv[1]}}</option>
                    {% endfor %}
                  </select>
                {% elif typ=='role_single' %}
                  <select id="{{key}}" name="{{key}}">
                    <option value="">— nenhum —</option>
                    {% for i,n in dd.role %}<option value="{{i}}" {{'selected' if v and i|int==v}}>{{n}}</option>{% endfor %}
                  </select>
                {% elif typ=='role' %}
                  <select id="{{key}}" name="{{key}}" multiple size="6">
                    {% for i,n in dd.role %}<option value="{{i}}" {{'selected' if i|int in (v or [])}}>{{n}}</option>{% endfor %}
                  </select>
                  <div class="hint">Ctrl/Cmd para selecionar vários</div>
                {% else %}
                  <select id="{{key}}" name="{{key}}">
                    <option value="">— nenhum —</option>
                    {% for i,n in dd[typ] %}<option value="{{i}}" {{'selected' if v and i|int==v}}>{{n}}</option>{% endfor %}
                  </select>
                {% endif %}
              {% endif %}
            </div>
          {% endfor %}
          </div>
          
        </section>
        {% endfor %}
      </form>
      {% endif %}
    </div>
  </main>
</div>

{% if sections %}
<div class="save-bar" role="region" aria-label="Salvar alterações">
  <div class="save-hint">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
    As alterações são aplicadas automaticamente.
  </div>
  <button class="save-btn" form="cfgForm" type="submit">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
    Salvar Alterações
  </button>
</div>
{% endif %}

<script>
const hamburger = document.getElementById('hamburger');
const sidebar   = document.getElementById('sidebar');
const overlay   = document.getElementById('overlay');

function toggleSidebar(open){
  if (window.innerWidth > 960) return; // Ignora no desktop
  
  const isOpen = open ?? !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', isOpen);
  overlay.classList.toggle('show', isOpen);
  hamburger.classList.toggle('open', isOpen);
  hamburger.setAttribute('aria-expanded', String(isOpen));
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

hamburger?.addEventListener('click', () => toggleSidebar());
overlay?.addEventListener('click', () => toggleSidebar(false));

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.section').forEach(e => e.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById('s' + btn.dataset.t);
    if (target) target.classList.add('active');
    
    if (window.innerWidth <= 960) toggleSidebar(false);
    window.scrollTo({top:0, behavior:'smooth'});
  });
});

const trigger = document.getElementById('userTrigger');
const dropdown = document.getElementById('userDropdown');
trigger?.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = dropdown.classList.toggle('open');
  trigger.classList.toggle('open', isOpen);
  trigger.setAttribute('aria-expanded', String(isOpen));
});
document.addEventListener('click', (e) => {
  if (!dropdown?.contains(e.target) && e.target !== trigger) {
    dropdown?.classList.remove('open');
    trigger?.classList.remove('open');
    trigger?.setAttribute('aria-expanded', 'false');
  }
});
document.getElementById('cfgForm')?.addEventListener('submit', () => {
  const btn = document.querySelector('.save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Salvando...'; }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    dropdown?.classList.remove('open');
    trigger?.classList.remove('open');
    if (sidebar?.classList.contains('open')) toggleSidebar(false);
  }
});
document.querySelectorAll('input[type="color"]').forEach(input => {
    input.addEventListener('input', (e) => {
        const hexLabel = e.target.nextElementSibling;
        if(hexLabel && hexLabel.classList.contains('color-hex')) {
            hexLabel.textContent = e.target.value.toUpperCase();
        }
    });
});
</script>
</body></html>"""

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
