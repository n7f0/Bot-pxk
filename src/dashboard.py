"""
Dashboard público — pxkk.com.br
Sistema completo: níveis MEE6, VIP, staff, filtros, 5 tipos de ticket.
Visual: Clean SaaS Premium (Paleta #1c202c / #60519b).
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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
:root{
  /* Paleta extraída da imagem */
  --bg: #1c202c;
  --bg-darker: #151822;
  --bg-card: #232736;
  --border: #31323e;
  --border-hi: #60519b;
  --primary: #60519b;
  --primary-hover: #7363b5;
  --primary-glow: rgba(96, 81, 155, 0.4);
  --text: #bfc0d1;
  --text-hi: #ffffff;
  --text-muted: #8e8fa3;
  --danger: #e74c3c;
  --success: #2ecc71;
  --radius: 12px;
  --ease: cubic-bezier(0.4, 0, 0.2, 1);
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  background:var(--bg);color:var(--text);
  font-family:'Inter',system-ui,-apple-system,sans-serif;
  font-size:15px;line-height:1.6;
  -webkit-font-smoothing:antialiased;letter-spacing:-0.01em;min-height:100vh;
}
h1,h2,h3{font-weight:700;letter-spacing:-0.02em;color:var(--text-hi)}
a{color:var(--primary);text-decoration:none;transition:color .2s var(--ease)}
a:hover{color:var(--text-hi)}
button{font-family:inherit;cursor:pointer;border:0;background:none;color:inherit;font-size:inherit}
img{display:block;max-width:100%}
::selection{background:var(--primary);color:var(--text-hi)}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:8px}
::-webkit-scrollbar-thumb:hover{background:var(--primary)}
</style>"""

LOGIN_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1c202c">
<meta name="description" content="PXKK Dashboard — gerencie seu bot Discord.">
<title>PXKK — Dashboard</title>
""" + STYLE + """
<style>
.login-page{min-height:100vh;display:grid;grid-template-columns:1.2fr 1fr;background:var(--bg);overflow:hidden;position:relative}
.hero{position:relative;padding:56px 72px;display:flex;flex-direction:column;justify-content:space-between;
  background: radial-gradient(ellipse 900px 600px at 20% 30%,rgba(96,81,155,0.15),transparent 60%),
              radial-gradient(ellipse 700px 500px at 80% 80%,rgba(96,81,155,0.05),transparent 60%),
              var(--bg);
  overflow:hidden;border-right:1px solid var(--border);min-height:100vh}
.hero::before{content:'';position:absolute;inset:0;
  background-image:linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px);
  background-size:64px 64px;
  mask-image:radial-gradient(ellipse 70% 60% at 30% 40%,#000 30%,transparent 90%);
  -webkit-mask-image:radial-gradient(ellipse 70% 60% at 30% 40%,#000 30%,transparent 90%);pointer-events:none}
.hero-top,.hero-mid,.hero-bottom{position:relative;z-index:1}
.hero-brand{display:flex;align-items:center;gap:16px;font-size:24px;font-weight:700;color:var(--text-hi)}
.hero-brand .mark{width:64px;height:64px;border:1px solid var(--border);border-radius:12px;display:grid;place-items:center;
  background:var(--bg-card);box-shadow:0 0 24px -8px var(--primary-glow);overflow:hidden;}
.hero-brand .mark img{width:100%;height:100%;object-fit:cover;display:block;}
.hero-mid{max-width:560px}
.hero-mid h1{font-size:clamp(36px,4vw,56px);line-height:1.1;color:var(--text-hi);margin-bottom:24px;letter-spacing:-0.03em}
.hero-mid h1 .accent{color:var(--primary)}
.hero-mid p{font-size:16px;color:var(--text-muted);line-height:1.7;max-width:460px}
.hero-bottom{display:flex;align-items:center;gap:24px;flex-wrap:wrap;font-size:13px;color:var(--text-muted);font-weight:500}
.stat{display:flex;align-items:center;gap:8px}
.stat b{color:var(--text-hi);font-weight:600}
.divider{width:1px;height:12px;background:var(--border)}
.login-panel{display:flex;align-items:center;justify-content:center;padding:48px 32px;background:var(--bg-darker);position:relative}
.login-card{position:relative;width:100%;max-width:440px;padding:48px;
  border:1px solid var(--border);background:var(--bg-card);
  border-radius:20px;box-shadow:0 24px 60px -20px rgba(0,0,0,0.5);}
.card-head{margin-bottom:32px;text-align:center;}
.card-head .mini-tag{display:inline-block;font-size:11px;font-weight:600;color:var(--primary);
  background:rgba(96,81,155,0.1);padding:6px 14px;border-radius:6px;letter-spacing:.05em;margin-bottom:16px;text-transform:uppercase}
.card-head h2{font-size:28px;margin-bottom:8px}
.card-head p{font-size:14px;color:var(--text-muted);line-height:1.6}
.btn-discord{display:flex;align-items:center;justify-content:center;gap:12px;
  width:100%;padding:16px 24px;background:var(--primary);
  color:var(--text-hi);font-weight:600;font-size:15px;text-decoration:none;transition:all .2s var(--ease);
  border-radius:8px;box-shadow:0 4px 12px rgba(96,81,155,0.3);}
.btn-discord:hover{background:var(--primary-hover);transform:translateY(-1px);box-shadow:0 6px 16px rgba(96,81,155,0.4);color:var(--text-hi)}
.login-foot{margin-top:32px;padding-top:24px;border-top:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;gap:12px;}
.status-pill { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); font-weight:500;}
.status-dot { width: 8px; height: 8px; background: var(--success); border-radius: 50%; box-shadow: 0 0 8px var(--success); }
.page-mini-footer{position:fixed;bottom:24px;left:0;right:0;
  font-size:12px;color:var(--text-muted);display:flex;justify-content:center;z-index:100;font-weight:500;}
@media(max-width:960px){
  .login-page{grid-template-columns:1fr}
  .hero{padding:36px 28px 44px;min-height:auto;border-right:0;border-bottom:1px solid var(--border)}
  .hero-mid h1{font-size:clamp(32px,8vw,48px)}
  .login-panel{padding:36px 20px 80px}
  .login-card{max-width:440px;padding:32px 24px}
  .page-mini-footer{position:relative;margin-top:32px;bottom:auto;}
}
</style></head>
<body>
<main class="login-page">
  <section class="hero" aria-label="Apresentação">
    <div class="hero-top">
      <div class="hero-brand">
        <span class="mark"><img src="/static/logo.gif" alt="Logo"></span>
        <span class="name">PXKK</span>
      </div>
    </div>
    <div class="hero-mid">
      <h1>Gerencie seu servidor com <span class="accent">precisão total.</span></h1>
      <p>Toda a configuração do seu bot em um painel único, seguro e intuitivo. Controle tickets, verificação, níveis e muito mais.</p>
    </div>
    <div class="hero-bottom">
      <div class="stat"><b>OAuth2</b> Discord</div>
      <span class="divider"></span>
      <div class="stat"><b>Cloudflare</b></div>
      <span class="divider"></span>
      <div class="stat"><b>100%</b> real-time</div>
    </div>
  </section>
  <section class="login-panel" aria-label="Entrar">
    <div class="login-card">
      <div class="card-head">
        <span class="mini-tag">Autenticação</span>
        <h2>Bem-vindo de volta</h2>
        <p>Autentique-se com sua conta do Discord para acessar o painel administrativo.</p>
      </div>
      <a href="/auth" class="btn-discord">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.3.5a14.7 14.7 0 0 1 4.3 2.2 15 15 0 0 0-12.8 0A14.6 14.6 0 0 1 10.9 3.5L10.6 3a19.7 19.7 0 0 0-4.9 1.4C2.6 8.6 1.9 12.7 2.3 16.7a19.8 19.8 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14 14 0 0 0 12.8 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.8 19.8 0 0 0 6-3c.5-4.6-.7-8.6-3.4-12.3ZM9 14.6c-1.2 0-2.2-1.1-2.2-2.4S7.8 9.8 9 9.8s2.2 1.1 2.2 2.4S10.2 14.6 9 14.6Zm6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
        Entrar com Discord
      </a>
      <div class="login-foot">
        <div class="status-pill"><span class="status-dot"></span> Sistemas Online</div>
        <div class="status-pill"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--primary)"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg> Conexão Segura</div>
      </div>
    </div>
  </section>
</main>
<footer class="page-mini-footer">
  <span>© 2026 PXKK. Todos os direitos reservados.</span>
</footer>
</body></html>"""

NOT_OWNER_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acesso negado — PXKK</title><meta name="robots" content="noindex">
""" + STYLE + """
<style>
body{background:var(--bg);display:grid;place-items:center;min-height:100vh;padding:24px;}
.denied-card{position:relative;max-width:440px;width:100%;background:var(--bg-card);border:1px solid var(--border);
  border-radius:16px;padding:48px 40px;text-align:center;box-shadow:0 24px 60px -20px rgba(0,0,0,0.5);}
.denied-icon{width:64px;height:64px;margin:0 auto 24px;border-radius:16px;background:rgba(231,76,60,0.1);
  display:grid;place-items:center;font-size:28px;color:var(--danger);}
.denied-card h1{font-size:24px;margin-bottom:12px}
.denied-card p{color:var(--text-muted);font-size:14px;margin-bottom:24px}
.user-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border:1px solid var(--border);
  border-radius:99px;margin-bottom:28px;font-size:13px;color:var(--text);background:var(--bg);}
.btn-back{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:12px 24px;
  background:var(--primary);color:var(--text-hi);font-weight:600;font-size:14px;border-radius:8px;transition:all .2s;}
.btn-back:hover{background:var(--primary-hover);}
</style></head>
<body>
<div class="denied-card">
  <div class="denied-icon">🚫</div>
  <h1>Acesso Negado</h1>
  <p>Este painel é privado e restrito à equipe autorizada.</p>
  <div class="user-chip"><b>{{user.username}}</b></div>
  <br>
  <a href="/logout" class="btn-back">Sair da conta</a>
</div></body></html>"""

DASHBOARD_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#1c202c"><meta name="robots" content="noindex">
<title>Dashboard — PXKK</title>
""" + STYLE + """
<style>
/* FUNDO GLOBAL (Gradient da imagem) */
body { 
  background: radial-gradient(circle at 10% 0%, rgba(96,81,155,0.1) 0%, transparent 40%),
              radial-gradient(circle at 90% 100%, rgba(96,81,155,0.05) 0%, transparent 40%),
              var(--bg);
  background-attachment: fixed;
}

/* TOPBAR */
.topbar{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;align-items:center;gap:20px;height:72px;padding:0 32px;
  background:rgba(28,32,44,0.8);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  border-bottom:1px solid var(--border);}
.hamburger{display:none;width:40px;height:40px;align-items:center;justify-content:center;flex-direction:column;gap:5px;
  border:1px solid transparent;border-radius:8px;cursor:pointer;transition:all .2s;}
.hamburger:hover{background:var(--bg-card);border-color:var(--border)}
.hamburger span{display:block;width:20px;height:2px;background:var(--text);transition:all .3s;}
.hamburger.open span:nth-child(1){transform:translateY(7px) rotate(45deg)}
.hamburger.open span:nth-child(2){opacity:0}
.hamburger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}

.brand{display:flex;align-items:center;gap:12px;color:var(--text-hi);text-decoration:none;flex-shrink:0}
.brand-icon{width:40px;height:40px;border-radius:10px;overflow:hidden;border:1px solid var(--border);}
.brand-icon img{width:100%;height:100%;object-fit:cover;}
.brand-text{display:flex;flex-direction:column;line-height:1}
.brand-text .name{font-weight:700;font-size:18px;letter-spacing:-.02em;}
.brand-text .sub{font-size:10px;color:var(--text-muted);font-weight:600;letter-spacing:.1em;text-transform:uppercase;margin-top:2px}
.spacer{flex:1}

/* MENU USUÁRIO */
.user-wrap{position:relative}
.user-trigger{display:flex;align-items:center;gap:12px;padding:6px 14px 6px 6px;background:var(--bg-card);
  border:1px solid var(--border);transition:all .2s;border-radius:99px;cursor:pointer;}
.user-trigger:hover{border-color:var(--border-hi);box-shadow:0 0 15px -5px var(--primary-glow)}
.user-trigger .avatar{width:34px;height:34px;border-radius:50%;object-fit:cover;}
.user-trigger .name{font-size:14px;font-weight:600;color:var(--text-hi);}
.role-badge{font-size:10px;padding:4px 10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-hi);border-radius:99px;}
.role-owner{background:var(--primary);}
.role-dev{background:#3b82f6;}
.role-staff{background:var(--border);}
.user-trigger .chev{transition:transform .2s;color:var(--text-muted);}
.user-trigger.open .chev{transform:rotate(180deg)}
.dropdown{position:absolute;top:calc(100% + 10px);right:0;min-width:260px;background:var(--bg-card);
  border:1px solid var(--border);padding:8px;border-radius:12px;box-shadow:0 20px 40px -10px rgba(0,0,0,0.5);
  opacity:0;visibility:hidden;transform:translateY(-5px);transition:all .2s;}
.dropdown.open{opacity:1;visibility:visible;transform:none}
.dd-head{display:flex;gap:12px;align-items:center;padding:12px;border-bottom:1px solid var(--border);margin-bottom:8px}
.dd-head img{width:40px;height:40px;border-radius:50%;}
.dd-head .dd-name{font-weight:600;font-size:14px;color:var(--text-hi);}
.dd-head .dd-id{font-size:11px;color:var(--text-muted);margin-top:2px}
.dd-item{display:flex;align-items:center;gap:10px;padding:10px 12px;color:var(--text);font-size:13.5px;
  font-weight:500;text-decoration:none;border-radius:6px;transition:all .2s;}
.dd-item:hover{background:var(--bg);color:var(--text-hi)}
.dd-item svg{color:var(--text-muted);}

/* SIDEBAR E LAYOUT */
.layout{display:flex;min-height:100vh;padding-top:72px;position:relative;}
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:90;backdrop-filter:blur(4px)}
.overlay.show{display:block}

/* SIDEBAR */
.sidebar{width:270px;flex-shrink:0;background:rgba(28,32,44,0.95);backdrop-filter:blur(20px);border-right:1px solid var(--border);padding:24px 16px;
  overflow-y:auto;position:fixed;top:72px;bottom:0;left:0;z-index:99;transition:transform .3s var(--ease);}
  
.sidebar-group { margin-bottom: 28px; }
.sidebar-group-title { font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;
  letter-spacing: .1em; padding: 0 12px; margin-bottom: 8px;}

.nav-btn{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;color:var(--text);font-size:14px;
  font-weight:500;text-align:left;transition:all .2s;margin-bottom:2px;
  border-radius:8px;border:1px solid transparent;}
.nav-btn:hover{background:var(--bg-card);color:var(--text-hi)}
.nav-btn.active{background:rgba(96,81,155,0.15);color:var(--text-hi);font-weight:600;border-color:rgba(96,81,155,0.2)}
.nav-icon{width:24px;height:24px;flex-shrink:0;display:grid;place-items:center;font-size:14px;}
.nav-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}

/* CONTEÚDO PRINCIPAL */
.content{flex:1;min-width:0;padding:40px 48px 100px;display:flex;flex-direction:column;align-items:center;
  transition:margin-left .3s var(--ease); margin-left:270px;}
.content-inner{max-width:960px;width:100%;flex:1}

/* ALERTAS */
.alert{display:flex;align-items:center;gap:12px;padding:16px 20px;margin-bottom:32px;font-size:14px;
  font-weight:500;border:1px solid;border-radius:10px;background:rgba(46,204,113,0.1);border-color:rgba(46,204,113,0.2);color:var(--success);}
.alert.warn{background:rgba(241,196,15,0.1);border-color:rgba(241,196,15,0.2);color:#f1c40f}

/* CARDS DE SEÇÃO */
.section{display:none;background:var(--bg-card);
  border:1px solid var(--border);padding:40px;position:relative;border-radius:16px;
  box-shadow:0 10px 30px -10px rgba(0,0,0,0.3);}
.section.active{display:block;animation:fadeUp .3s var(--ease)}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.section-head{margin-bottom:36px;padding-bottom:24px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:6px;}
.section-head h2{font-size:22px;color:var(--text-hi);display:flex;align-items:center;gap:12px;}
.section-head p{color:var(--text-muted);font-size:14px;}

/* FORMULÁRIO GRID */
.form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; }
.f { display: flex; flex-direction: column; gap: 8px; }
.f.full-width { grid-column: 1 / -1; }
.f label{font-size:12px;color:var(--text);font-weight:600;letter-spacing:.02em;}
.f .hint{font-size:12px;color:var(--text-muted);line-height:1.4;}

/* INPUTS */
input[type=text],input[type=number],textarea,select{
  width:100%;padding:12px 16px;border:1px solid var(--border);
  background:var(--bg);color:var(--text-hi);font:inherit;font-size:14px;
  border-radius:8px;transition:all .2s;}
input[type=text]:hover,input[type=number]:hover,textarea:hover,select:hover { border-color:var(--text-muted);}
input[type=text]:focus,input[type=number]:focus,textarea:focus,select:focus{
  outline:none;border-color:var(--primary);box-shadow:0 0 0 3px rgba(96,81,155,0.2);}
input::placeholder,textarea::placeholder{color:var(--text-muted);opacity:0.6}
textarea{min-height:100px;resize:vertical;font-family:inherit;line-height:1.5}
select[multiple]{min-height:140px;padding:8px}
select[multiple] option{padding:10px;margin:2px 0;background:var(--bg-card);color:var(--text);border-radius:4px;}
select[multiple] option:checked{background:var(--primary);color:var(--text-hi)}

/* COLOR PICKER */
.color-wrapper { display: flex; align-items: center; gap: 12px; background: var(--bg); padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border); transition: all .2s;}
.color-wrapper:hover { border-color: var(--text-muted); }
input[type=color]{appearance:none; -webkit-appearance:none; width: 32px; height: 32px; border: none; padding: 0; background: transparent; cursor: pointer; border-radius: 6px; overflow: hidden;}
input[type=color]::-webkit-color-swatch-wrapper{padding:0;}
input[type=color]::-webkit-color-swatch{border: none; border-radius: 6px;}
.color-hex { font-family: monospace; font-size: 14px; color: var(--text-hi); font-weight: 600; text-transform: uppercase;}

/* TOGGLE */
.sw{display:flex;align-items:center;gap:16px;padding:12px 16px;background:var(--bg);border:1px solid var(--border);
  transition:all .2s;cursor:pointer;border-radius:8px;}
.sw:hover{border-color:var(--text-muted);}
.sw input[type=checkbox]{appearance:none;-webkit-appearance:none;width:44px;height:24px;background:var(--border);
  position:relative;cursor:pointer;flex-shrink:0;transition:background .2s;border-radius:99px;}
.sw input[type=checkbox]::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;
  background:#fff;transition:transform .2s;box-shadow:0 2px 4px rgba(0,0,0,.2)}
.sw input[type=checkbox]:checked{background:var(--primary)}
.sw input[type=checkbox]:checked::after{transform:translateX(20px)}
.sw span{color:var(--text);font-size:14px;font-weight:500;cursor:pointer;flex:1;}

/* BARRA SALVAR */
.save-bar{position:fixed;bottom:0;left:270px;right:0;z-index:50;padding:16px 48px;background:rgba(28,32,44,0.9);
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-top:1px solid var(--border);
  display:flex;justify-content:space-between;align-items:center;gap:16px;transition:left .3s var(--ease);}
.save-hint{color:var(--text-muted);font-size:13px;display:flex;align-items:center;gap:8px;}
.save-btn{padding:12px 32px;background:var(--primary);color:var(--text-hi);font-weight:600;font-size:14px;
  border-radius:8px;transition:all .2s;display:inline-flex;align-items:center;gap:8px;box-shadow:0 4px 12px rgba(96,81,155,0.3);}
.save-btn:hover{background:var(--primary-hover);transform:translateY(-1px);box-shadow:0 6px 16px rgba(96,81,155,0.4);}
.save-btn:disabled{opacity:.6;cursor:not-allowed;transform:none}

/* RESPONSIVO */
@media(max-width:1024px){
  .form-grid { grid-template-columns: 1fr; }
}
@media(max-width:960px){
  .hamburger{display:flex;} 
  .brand-text .sub{display:none}
  .user-trigger .name{display:none}
  .user-trigger{padding:6px}
  .user-trigger .chev{display:none}
  .sidebar { transform: translateX(-100%); box-shadow: 24px 0 40px -10px rgba(0,0,0,.5); background:var(--bg);}
  .sidebar.open { transform: none; }
  .content { margin-left: 0; padding: 24px 20px 100px; }
  .save-bar { left: 0; padding: 16px 20px; }
  .save-hint{display:none}
  .save-btn{width:100%;justify-content:center}
  .section{padding:24px 20px;}
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
      <div class="sidebar-group-title">Geral</div>
      {% for title, _ in sections[:4] %}
        {% set parts = title.split(' ', 1) %}
        <button class="nav-btn {{'active' if loop.first}}" data-t="{{loop.index0}}">
          <span class="nav-icon" aria-hidden="true">{{parts[0]}}</span>
          <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
        </button>
      {% endfor %}
    </div>

    <div class="sidebar-group">
      <div class="sidebar-group-title">Segurança</div>
      {% for title, _ in sections[4:7] %}
        {% set parts = title.split(' ', 1) %}
        <button class="nav-btn" data-t="{{loop.index0 + 4}}">
          <span class="nav-icon" aria-hidden="true">{{parts[0]}}</span>
          <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
        </button>
      {% endfor %}
    </div>

    <div class="sidebar-group">
      <div class="sidebar-group-title">Atendimento</div>
      {% for title, _ in sections[7:9] %}
        {% set parts = title.split(' ', 1) %}
        <button class="nav-btn" data-t="{{loop.index0 + 7}}">
          <span class="nav-icon" aria-hidden="true">{{parts[0]}}</span>
          <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
        </button>
      {% endfor %}
    </div>

    <div class="sidebar-group">
      <div class="sidebar-group-title">Comunidade</div>
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
  if (window.innerWidth > 960) return;
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
