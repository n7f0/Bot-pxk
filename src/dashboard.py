"""
Dashboard público — pxkk.com.br
Sistema completo: níveis MEE6, VIP, staff, filtros, 5 tipos de ticket.
Visual: Retro Pixel RPG (Undertale Inspired).
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
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap');

:root {
  --bg: #0f0814;
  --bg-box: #1a0f24;
  --bg-box-dark: #13081b;
  --border: #4a2e6b;
  --border-hi: #b565ff;
  --text: #f0e6ff;
  --text-muted: #9d86b8;
  --primary: #b565ff;
  --primary-hover: #c98cff;
  --accent: #ff4d6d;
  --shadow: #000000;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }

body {
  background-color: var(--bg);
  /* Fundo estilo grade de pixel */
  background-image: 
    linear-gradient(rgba(181, 101, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(181, 101, 255, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
  color: var(--text);
  font-family: 'VT323', monospace;
  font-size: 20px;
  line-height: 1.4;
  min-height: 100vh;
}

h1, h2, h3, .pixel-font {
  font-family: 'Press Start 2P', cursive;
  font-weight: normal;
  line-height: 1.3;
  text-transform: uppercase;
}

a { color: var(--primary); text-decoration: none; transition: color 0.2s; }
a:hover { color: var(--primary-hover); text-shadow: 0 0 8px var(--primary); }

button { font-family: inherit; cursor: pointer; border: none; background: none; color: inherit; font-size: inherit; }
img { display: block; max-width: 100%; }
::selection { background: var(--primary); color: var(--bg); }

/* Scrollbar customizada */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--bg-box-dark); border-left: 1px solid var(--border); }
::-webkit-scrollbar-thumb { background: var(--border); border: 2px solid var(--bg-box-dark); }
::-webkit-scrollbar-thumb:hover { background: var(--primary); }
</style>"""

LOGIN_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f0814">
<title>PXKK — Login</title>
""" + STYLE + """
<style>
.login-page { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; position: relative; }
.hero-bg { position: absolute; inset: 0; background: radial-gradient(circle at 50% 50%, rgba(181, 101, 255, 0.1) 0%, transparent 60%); pointer-events: none; }
.login-box { 
  position: relative; z-index: 10; width: 100%; max-width: 500px; 
  background: var(--bg-box); padding: 40px; 
  border: 4px solid var(--border); 
  box-shadow: 8px 8px 0 var(--shadow), 0 0 20px rgba(181, 101, 255, 0.2);
}
.login-box::before { content: ''; position: absolute; top: -4px; left: 20px; right: 20px; height: 4px; background: var(--primary); }
.logo-area { text-align: center; margin-bottom: 32px; }
.logo-icon { font-size: 48px; margin-bottom: 16px; text-shadow: 0 0 15px var(--primary); }
.logo-title { font-size: 32px; color: var(--text); text-shadow: 4px 4px 0 var(--border); letter-spacing: 2px; }
.logo-subtitle { font-size: 16px; color: var(--text-muted); margin-top: 8px; letter-spacing: 1px; }
.btn-discord { 
  display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%; 
  background: var(--primary); color: var(--bg); font-family: 'Press Start 2P', cursive; font-size: 14px;
  padding: 20px; border: 4px solid var(--text); text-decoration: none;
  box-shadow: 6px 6px 0 var(--shadow); transition: all 0.1s; margin-top: 24px;
}
.btn-discord:hover { background: var(--primary-hover); transform: translate(2px, 2px); box-shadow: 4px 4px 0 var(--shadow); color: var(--bg); }
.btn-discord:active { transform: translate(6px, 6px); box-shadow: 0 0 0 var(--shadow); }
.footer-text { margin-top: 32px; font-size: 16px; color: var(--text-muted); text-align: center; }
.footer-text span { color: var(--accent); }
</style></head>
<body>
<main class="login-page">
  <div class="hero-bg"></div>
  <div class="login-box">
    <div class="logo-area">
      <div class="logo-icon">💜</div>
      <h1 class="logo-title">PXKK</h1>
      <p class="logo-subtitle">MANAGEMENT SYSTEM</p>
    </div>
    
    <p style="text-align: center; color: var(--text-muted); margin-bottom: 8px;">Autentique-se para acessar o painel.</p>
    
    <a href="/auth" class="btn-discord">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.3.5a14.7 14.7 0 0 1 4.3 2.2 15 15 0 0 0-12.8 0A14.6 14.6 0 0 1 10.9 3.5L10.6 3a19.7 19.7 0 0 0-4.9 1.4C2.6 8.6 1.9 12.7 2.3 16.7a19.8 19.8 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14 14 0 0 0 12.8 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.8 19.8 0 0 0 6-3c.5-4.6-.7-8.6-3.4-12.3ZM9 14.6c-1.2 0-2.2-1.1-2.2-2.4S7.8 9.8 9 9.8s2.2 1.1 2.2 2.4S10.2 14.6 9 14.6Zm6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
      ENTRAR COM DISCORD
    </a>
  </div>
  
  <p class="footer-text">© 2026 PXKK <span>❤</span></p>
</main>
</body></html>"""

NOT_OWNER_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acesso negado — PXKK</title><meta name="robots" content="noindex">
""" + STYLE + """
<style>
body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
.denied-box { 
  background: var(--bg-box); padding: 40px; max-width: 500px; width: 100%; text-align: center;
  border: 4px solid var(--accent); box-shadow: 8px 8px 0 var(--shadow), 0 0 20px rgba(255, 77, 109, 0.2);
}
.denied-icon { font-size: 48px; margin-bottom: 24px; }
.denied-title { color: var(--accent); font-size: 24px; margin-bottom: 16px; }
.denied-text { color: var(--text-muted); font-size: 20px; margin-bottom: 32px; }
.btn-back { 
  display: inline-block; background: var(--border); color: var(--text); padding: 16px 32px;
  border: 2px solid var(--text); box-shadow: 4px 4px 0 var(--shadow); transition: all 0.1s;
}
.btn-back:hover { background: var(--accent); color: var(--bg); transform: translate(2px, 2px); box-shadow: 2px 2px 0 var(--shadow); }
</style></head>
<body>
<div class="denied-box">
  <div class="denied-icon">🚫</div>
  <h1 class="denied-title">ACESSO NEGADO</h1>
  <p class="denied-text">Este painel é privado.</p>
  <a href="/logout" class="btn-back">SAIR DA CONTA</a>
</div>
</body></html>"""

DASHBOARD_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0f0814"><meta name="robots" content="noindex">
<title>Dashboard — PXKK</title>
""" + STYLE + """
<style>
/* TOPBAR */
.topbar { position: fixed; top: 0; left: 0; right: 0; z-index: 100; display: flex; align-items: center; height: 80px; padding: 0 32px; background: var(--bg-box); border-bottom: 4px solid var(--border); }
.hamburger { display: none; width: 48px; height: 48px; background: var(--bg-box-dark); border: 2px solid var(--border); align-items: center; justify-content: center; flex-direction: column; gap: 5px; cursor: pointer; box-shadow: 4px 4px 0 var(--shadow); }
.hamburger span { display: block; width: 24px; height: 2px; background: var(--text); transition: 0.2s; }
.hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
.hamburger.open span:nth-child(2) { opacity: 0; }
.hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

.brand { display: flex; align-items: center; gap: 16px; text-decoration: none; }
.brand-icon { width: 44px; height: 44px; background: var(--bg-box-dark); border: 2px solid var(--border); display: grid; place-items: center; font-size: 24px; box-shadow: 4px 4px 0 var(--shadow); }
.brand-text { color: var(--text); font-size: 20px; letter-spacing: 1px; text-shadow: 2px 2px 0 var(--shadow); }
.spacer { flex: 1; }

/* USER PROFILE */
.user-wrap { position: relative; }
.user-trigger { display: flex; align-items: center; gap: 12px; background: var(--bg-box-dark); border: 2px solid var(--border); padding: 6px 16px 6px 6px; cursor: pointer; box-shadow: 4px 4px 0 var(--shadow); transition: all 0.1s; }
.user-trigger:hover { transform: translate(1px, 1px); box-shadow: 3px 3px 0 var(--shadow); border-color: var(--border-hi); }
.user-trigger .avatar { width: 40px; height: 40px; border: 2px solid var(--border); object-fit: cover; }
.user-trigger .name { font-size: 18px; color: var(--text); }
.role-badge { font-family: 'Press Start 2P', cursive; font-size: 8px; padding: 4px 8px; color: var(--bg); background: var(--primary); }
.role-owner { background: var(--primary); }
.role-dev { background: #3b82f6; }
.role-staff { background: var(--text-muted); }

.dropdown { position: absolute; top: calc(100% + 12px); right: 0; min-width: 260px; background: var(--bg-box); border: 4px solid var(--border); box-shadow: 8px 8px 0 var(--shadow); padding: 12px; opacity: 0; visibility: hidden; transform: translateY(-10px); transition: 0.2s; }
.dropdown.open { opacity: 1; visibility: visible; transform: none; }
.dd-head { display: flex; gap: 12px; align-items: center; padding-bottom: 12px; border-bottom: 2px dashed var(--border); margin-bottom: 12px; }
.dd-head img { width: 48px; height: 48px; border: 2px solid var(--border); }
.dd-head .dd-name { font-family: 'Press Start 2P', cursive; font-size: 12px; color: var(--text); }
.dd-head .dd-id { font-size: 16px; color: var(--text-muted); margin-top: 6px; }
.dd-item { display: flex; align-items: center; gap: 10px; padding: 12px; color: var(--accent); font-size: 20px; transition: 0.1s; }
.dd-item:hover { background: var(--bg-box-dark); transform: translateX(4px); }

/* SIDEBAR & LAYOUT */
.layout { display: flex; min-height: 100vh; padding-top: 80px; }
.overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 90; }
.overlay.show { display: block; }

.sidebar { width: 300px; flex-shrink: 0; background: var(--bg-box); border-right: 4px solid var(--border); padding: 24px 16px; position: fixed; top: 80px; bottom: 0; left: 0; z-index: 99; overflow-y: auto; transition: transform 0.3s; }
.sidebar-group { margin-bottom: 32px; }
.sidebar-group-title { font-family: 'Press Start 2P', cursive; font-size: 10px; color: var(--accent); margin-bottom: 12px; padding-left: 8px; text-shadow: 2px 2px 0 var(--shadow); }

.nav-btn { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 16px; color: var(--text-muted); font-size: 20px; text-align: left; margin-bottom: 6px; border: 2px solid transparent; transition: 0.1s; }
.nav-btn:hover { color: var(--text); border-color: var(--border); background: var(--bg-box-dark); }
.nav-btn.active { background: var(--bg-box-dark); color: var(--text); border-color: var(--primary); box-shadow: 4px 4px 0 var(--shadow); }
.nav-btn.active .nav-icon { color: var(--primary); }
.nav-icon { font-size: 16px; }
.nav-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* CONTENT */
.content { flex: 1; min-width: 0; padding: 48px; margin-left: 300px; display: flex; flex-direction: column; align-items: center; }
.content-inner { max-width: 900px; width: 100%; }

/* ALERTS */
.alert { display: flex; align-items: center; gap: 12px; padding: 16px; margin-bottom: 32px; background: var(--bg-box); border: 2px solid var(--success); color: var(--success); box-shadow: 4px 4px 0 var(--shadow); font-size: 18px; }
.alert.warn { border-color: #f1c40f; color: #f1c40f; }

/* DIALOG BOX (SECTIONS) */
.section { display: none; background: var(--bg-box); border: 4px solid var(--border); padding: 40px; position: relative; box-shadow: 8px 8px 0 var(--shadow); }
.section::before { content: '❤'; position: absolute; top: -12px; left: 24px; background: var(--bg-box); padding: 0 8px; color: var(--accent); font-size: 20px; }
.section.active { display: block; animation: fadeIn 0.3s ease-out; }
@keyframes fadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }

.section-head { margin-bottom: 32px; border-bottom: 4px dashed var(--border); padding-bottom: 20px; }
.section-head h2 { font-size: 20px; color: var(--text); display: flex; align-items: center; gap: 12px; text-shadow: 3px 3px 0 var(--shadow); }
.section-head p { color: var(--text-muted); font-size: 18px; margin-top: 12px; }

/* FORM GRID */
.form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 28px; }
.f { display: flex; flex-direction: column; gap: 8px; }
.f.full-width { grid-column: 1 / -1; }
.f label { font-family: 'Press Start 2P', cursive; font-size: 10px; color: var(--text); line-height: 1.5; }
.f .hint { font-size: 16px; color: var(--text-muted); }

/* INPUTS */
input[type=text], input[type=number], textarea, select {
  width: 100%; padding: 12px 16px; background: var(--bg-box-dark); border: 2px solid var(--border);
  color: var(--text); font-family: 'VT323', monospace; font-size: 22px;
  box-shadow: inset 3px 3px 0 var(--shadow); transition: all 0.2s;
}
input[type=text]:focus, input[type=number]:focus, textarea:focus, select:focus {
  outline: none; border-color: var(--primary); box-shadow: inset 3px 3px 0 var(--shadow), 0 0 10px rgba(181, 101, 255, 0.4);
}
textarea { min-height: 120px; resize: vertical; }
select[multiple] { min-height: 160px; padding: 8px; }
select[multiple] option { padding: 8px; margin: 4px 0; background: var(--bg-box); color: var(--text); }
select[multiple] option:checked { background: var(--primary); color: var(--bg); }

/* COLOR PICKER */
.color-wrapper { display: flex; align-items: center; gap: 16px; background: var(--bg-box-dark); padding: 8px 16px; border: 2px solid var(--border); box-shadow: inset 3px 3px 0 var(--shadow); }
input[type=color] { appearance: none; width: 48px; height: 48px; border: none; padding: 0; background: transparent; cursor: pointer; }
input[type=color]::-webkit-color-swatch-wrapper { padding: 0; }
input[type=color]::-webkit-color-swatch { border: 2px solid var(--text); }
.color-hex { font-family: 'Press Start 2P', cursive; font-size: 12px; color: var(--text); }

/* TOGGLE */
.sw { display: flex; align-items: center; gap: 16px; padding: 16px; background: var(--bg-box-dark); border: 2px solid var(--border); cursor: pointer; box-shadow: inset 3px 3px 0 var(--shadow); transition: 0.1s; }
.sw:hover { border-color: var(--primary); }
.sw input[type=checkbox] { appearance: none; width: 52px; height: 28px; background: var(--border); position: relative; cursor: pointer; border: 2px solid var(--text); }
.sw input[type=checkbox]::after { content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; background: var(--text); transition: 0.2s; }
.sw input[type=checkbox]:checked { background: var(--primary); }
.sw input[type=checkbox]:checked::after { transform: translateX(24px); }
.sw span { color: var(--text); font-size: 20px; flex: 1; }

/* SAVE BAR */
.save-bar { position: fixed; bottom: 0; left: 300px; right: 0; z-index: 50; padding: 20px 48px; background: var(--bg-box); border-top: 4px solid var(--border); display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.save-hint { color: var(--text-muted); font-size: 18px; display: flex; align-items: center; gap: 10px; }
.save-btn { background: var(--accent); color: var(--text); font-family: 'Press Start 2P', cursive; font-size: 14px; padding: 20px 40px; border: 4px solid var(--text); box-shadow: 6px 6px 0 var(--shadow); transition: 0.1s; display: flex; align-items: center; gap: 12px; }
.save-btn:hover { background: #ff6b85; transform: translate(2px, 2px); box-shadow: 4px 4px 0 var(--shadow); }
.save-btn:active { transform: translate(6px, 6px); box-shadow: 0 0 0 var(--shadow); }

/* RESPONSIVE */
@media(max-width:1024px) {
  .form-grid { grid-template-columns: 1fr; }
  .content { padding: 32px; }
}
@media(max-width:960px) {
  .hamburger { display: flex; }
  .brand-text { display: none; }
  .user-trigger .name, .role-badge { display: none; }
  .user-trigger { padding: 4px; }
  .sidebar { transform: translateX(-100%); box-shadow: 10px 0 0 rgba(0,0,0,0.5); }
  .sidebar.open { transform: none; }
  .content { margin-left: 0; padding: 24px 16px 120px; }
  .save-bar { left: 0; padding: 16px 24px; }
  .save-hint { display: none; }
  .save-btn { width: 100%; justify-content: center; }
  .section { padding: 24px 16px; }
}
</style></head>
<body>

<header class="topbar">
  <button class="hamburger" id="hamburger" aria-label="Abrir menu" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>
  <a href="/" class="brand">
    <div class="brand-icon" style="color:var(--primary);">💜</div>
    <div class="brand-text pixel-font">PXKK</div>
  </a>
  <div class="spacer"></div>
  <div class="user-wrap">
    <button class="user-trigger" id="userTrigger">
      <img class="avatar" src="https://cdn.discordapp.com/avatars/{{user.id}}/{{user.avatar}}.png?size=64" alt="">
      <span class="name">{{user.global_name}}</span>
      <span class="role-badge role-{{user.role}}">
        {% if user.role=='owner' %}LV MAX{% elif user.role=='dev' %}DEV{% else %}STAFF{% endif %}
      </span>
    </button>
    <div class="dropdown" id="userDropdown">
      <div class="dd-head">
        <img src="https://cdn.discordapp.com/avatars/{{user.id}}/{{user.avatar}}.png?size=64" alt="">
        <div>
          <div class="dd-name">{{user.global_name}}</div>
          <div class="dd-id">ID: {{user.id}}</div>
        </div>
      </div>
      <a href="/logout" class="dd-item">
        <span style="font-size:16px;">❌</span> Sair da conta
      </a>
    </div>
  </div>
</header>

<div class="layout">
  <div class="overlay" id="overlay"></div>
  <aside class="sidebar" id="sidebar">
    
    <div class="sidebar-group">
      <div class="sidebar-group-title">⚔️ GERAL</div>
      {% for title, _ in sections[:4] %}
        {% set parts = title.split(' ', 1) %}
        <button class="nav-btn {{'active' if loop.first}}" data-t="{{loop.index0}}">
          <span class="nav-icon">{{parts[0]}}</span>
          <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
        </button>
      {% endfor %}
    </div>

    <div class="sidebar-group">
      <div class="sidebar-group-title">🛡️ SEGURANÇA</div>
      {% for title, _ in sections[4:7] %}
        {% set parts = title.split(' ', 1) %}
        <button class="nav-btn" data-t="{{loop.index0 + 4}}">
          <span class="nav-icon">{{parts[0]}}</span>
          <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
        </button>
      {% endfor %}
    </div>

    <div class="sidebar-group">
      <div class="sidebar-group-title">💬 ATENDIMENTO</div>
      {% for title, _ in sections[7:9] %}
        {% set parts = title.split(' ', 1) %}
        <button class="nav-btn" data-t="{{loop.index0 + 7}}">
          <span class="nav-icon">{{parts[0]}}</span>
          <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
        </button>
      {% endfor %}
    </div>

    <div class="sidebar-group">
      <div class="sidebar-group-title">👥 COMUNIDADE</div>
      {% for title, _ in sections[9:] %}
        {% set parts = title.split(' ', 1) %}
        <button class="nav-btn" data-t="{{loop.index0 + 9}}">
          <span class="nav-icon">{{parts[0]}}</span>
          <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
        </button>
      {% endfor %}
    </div>

  </aside>

  <main class="content">
    <div class="content-inner">
      {% for m in get_flashed_messages() %}
        <div class="alert">
          <span>💾</span> {{m}}
        </div>
      {% endfor %}
      {% if not cfg.get('guild_id') %}
        <div class="alert warn">
          <span>⚠️</span> O bot ainda não registrou um servidor. Inicie o bot primeiro.
        </div>
      {% endif %}
      
      {% if not sections %}
        <div class="section active" style="text-align: center;">
          <h2 style="justify-content: center;">🔒 ACESSO RESTRITO</h2>
          <p>Você não tem permissão para editar nenhuma seção.</p>
        </div>
      {% else %}
      <form method="post" id="cfgForm" novalidate>
        <input type="hidden" name="_csrf" value="{{csrf()}}">
        {% for title, fields in sections %}
        <section id="s{{loop.index0}}" class="section {{'active' if loop.first}}">
          <div class="section-head">
            <h2>{{title}}</h2>
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
<div class="save-bar">
  <div class="save-hint">
    <span>⚡</span> Salve para aplicar as mudanças.
  </div>
  <button class="save-btn" form="cfgForm" type="submit">
    <span>💾</span> SALVAR
  </button>
</div>
{% endif %}

<script>
const hamburger = document.getElementById('hamburger');
const sidebar   = document.getElementById('sidebar');
const overlay   = document.getElementById('overlay');

function toggleSidebar(open){
  if (window.innerWidth > 960) return;
  const isOpen = open ?? !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', isOpen);
  overlay.classList.toggle('show', isOpen);
  hamburger.classList.toggle('open', isOpen);
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
  dropdown.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (!dropdown?.contains(e.target) && e.target !== trigger) {
    dropdown?.classList.remove('open');
  }
});
document.getElementById('cfgForm')?.addEventListener('submit', () => {
  const btn = document.querySelector('.save-btn');
  if (btn) { btn.innerHTML = '<span>⏳</span> SALVANDO...'; }
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
