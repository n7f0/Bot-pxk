"""
Dashboard público — pxkk.com.br
Login via Discord OAuth2 + configuração do bot pelo site.
Sistema de 3 níveis: DEV, OWNER e STAFF.
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

app = Flask(__name__)
app.secret_key = FLASK_SECRET
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=BASE_URL.startswith("https"),
)

# ==================== SEÇÕES ====================
SECTION_SLUGS = [
    "identity", "autoemoji", "welcome", "verification", "tickets",
    "feedback", "antibot", "voice", "addcargo", "activity",
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
    ("✨ Auto-Emoji", [
        ("auto_emoji_channels", "Adicionar emoji automático nos canais", "bool"),
    ]),
    ("👋 Boas-vindas", [
        ("welcome_channel_id", "Canal de boas-vindas", "ch"),
        ("welcome_message", "Mensagem de boas-vindas", "area"),
        ("welcome_image_url", "Imagem de boas-vindas (URL)", "text"),
        ("leave_channel_id", "Canal de saída", "ch"),
        ("leave_message", "Mensagem de saída", "area"),
    ]),
    ("✅ Verificação", [
        ("verification_method", "Método", "choice:math=Conta matemática,button=Botão"),
        ("verification_difficulty", "Dificuldade (1-3)", "num"),
        ("verification_kick_minutes", "Kick após X min (0 = desligado)", "num"),
        ("verified_role_ids", "Cargos dados ao verificar", "role"),
        ("verification_unverified_role_ids", "Cargos de não verificado", "role"),
        ("verification_channel_id", "Canal de verificação", "ch"),
        ("verification_panel_channel_id", "Canal do painel de verificação", "ch"),
        ("verification_log_channel_id", "Canal de logs de verificação", "ch"),
        ("verification_temp_category_id", "Categoria do canal temporário", "cat"),
        ("verification_temp_delete_seconds", "Apagar canal temp após X segundos", "num"),
    ]),
    ("🎫 Tickets", [
        ("ticket_panel_channel_id", "Canal do painel de tickets", "ch"),
        ("ticket_logs_channel_id", "Canal de logs de tickets", "ch"),
        ("ticket_category_doubt_id", "Categoria: Dúvidas", "cat"),
        ("ticket_category_purchase_id", "Categoria: Compras", "cat"),
        ("ticket_support_role_ids", "Cargos de suporte", "role"),
        ("ticket_panel_title", "Título do painel ({brand} = nome da marca)", "text"),
        ("ticket_panel_description", "Descrição do painel", "area"),
        ("ticket_panel_select_placeholder", "Texto do menu", "text"),
        ("ticket_doubt_label", "Dúvidas — nome", "text"),
        ("ticket_doubt_emoji", "Dúvidas — emoji", "text"),
        ("ticket_purchase_label", "Compras — nome", "text"),
        ("ticket_purchase_emoji", "Compras — emoji", "text"),
    ]),
    ("⭐ Feedback & Sugestões", [
        ("feedback_channel_id", "Canal de logs de avaliações", "ch"),
        ("feedback_panel_channel_id", "Canal do painel de avaliações", "ch"),
        ("feedback_panel_title", "Título do painel de avaliações", "text"),
        ("feedback_panel_description", "Descrição do painel de avaliações", "area"),
        ("suggestions_channel_id", "Canal onde as sugestões chegam", "ch"),
        ("suggestions_panel_channel_id", "Canal do painel de sugestões", "ch"),
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
    ("➕ /addcargo", [
        ("addcargo_allowed_role_ids", "Cargos que podem usar /addcargo", "role"),
        ("addcargo_panel_channel_id", "Canal do painel público do /addcargo", "ch"),
    ]),
    ("🎞️ Atividade do Bot", [
        ("activity_rotate_enabled", "Ativar rotação de atividade", "bool"),
        ("activity_type", "Tipo", "choice:watching=Assistindo,playing=Jogando,listening=Ouvindo,competing=Competindo"),
        ("activity_rotate_seconds", "Trocar a cada X segundos (mín 10)", "num"),
        ("activity_messages", "Mensagens (uma por linha — use {brand}, {emoji}, {members})", "list"),
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
            elif typ in ("ch", "vc", "cat"):
                cfg[key] = int_or_none(request.form.get(key))
            elif typ == "role":
                cfg[key] = [int(x) for x in request.form.getlist(key) if x.isdigit()]
        write_config(cfg)
        flash("Configurações salvas! O bot aplica em até 5 segundos.")
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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
:root{
  --bg:#07040d;
  --bg-soft:#0d0718;
  --card:#130a20;
  --card-hi:#1a0f2c;
  --line:#251640;
  --line-soft:#1e1233;
  --tx:#f0ecfa;
  --tx-dim:#c9bfdc;
  --mut:#8f85a8;
  --pri:#7c3aed;
  --pri-hi:#a78bfa;
  --pri-lo:#5b21b6;
  --ok:#10b981;
  --warn:#f59e0b;
  --err:#ef4444;
  --grad:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);
  --grad-soft:linear-gradient(135deg,#5b21b6 0%,#7c3aed 100%);
  --shadow:0 12px 40px -8px rgba(124,58,237,.28);
  --radius:14px;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  background:var(--bg);
  color:var(--tx);
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  font-size:15px;
  line-height:1.5;
  -webkit-font-smoothing:antialiased;
  background-image:
    radial-gradient(ellipse 900px 500px at 15% -10%,rgba(124,58,237,.15),transparent 60%),
    radial-gradient(ellipse 700px 400px at 90% 5%,rgba(167,139,250,.10),transparent 55%);
  background-attachment:fixed;
}
a{color:var(--pri-hi);text-decoration:none;transition:color .15s}
a:hover{color:#c4b5fd}
button{font-family:inherit;cursor:pointer;border:0;background:none;color:inherit}
img{display:block;max-width:100%}
::selection{background:var(--pri);color:#fff}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--line);border-radius:10px;border:2px solid var(--bg)}
::-webkit-scrollbar-thumb:hover{background:#3a2358}
</style>"""

LOGIN_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PXKK — Entrar</title>
<meta name="theme-color" content="#07040d">
""" + STYLE + """
<style>
.login-wrap{
  min-height:100vh;display:flex;flex-direction:column;align-items:center;
  justify-content:center;padding:24px;position:relative;overflow:hidden;
}
.login-wrap::before{
  content:'';position:absolute;top:-30%;left:-20%;width:60%;height:60%;
  background:radial-gradient(circle,rgba(124,58,237,.35),transparent 70%);
  filter:blur(80px);animation:float 12s ease-in-out infinite;
}
.login-wrap::after{
  content:'';position:absolute;bottom:-30%;right:-20%;width:55%;height:55%;
  background:radial-gradient(circle,rgba(167,139,250,.22),transparent 70%);
  filter:blur(90px);animation:float 15s ease-in-out infinite reverse;
}
@keyframes float{0%,100%{transform:translate(0,0)}50%{transform:translate(6%,4%)}}
.login-card{
  position:relative;z-index:1;width:100%;max-width:440px;
  background:linear-gradient(180deg,rgba(20,10,35,.9),rgba(13,7,24,.95));
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  border:1px solid var(--line);border-radius:22px;
  padding:48px 36px 40px;
  box-shadow:0 30px 80px -20px rgba(0,0,0,.7),0 0 0 1px rgba(167,139,250,.06) inset;
  text-align:center;animation:rise .5s cubic-bezier(.2,.9,.3,1) both;
}
@keyframes rise{from{opacity:0;transform:translateY(20px) scale(.98)}to{opacity:1;transform:none}}
.login-logo{
  width:78px;height:78px;margin:0 auto 22px;
  border-radius:20px;background:var(--grad);
  display:grid;place-items:center;font-size:40px;
  box-shadow:0 12px 30px -8px rgba(124,58,237,.6),inset 0 1px 0 rgba(255,255,255,.2);
}
.login-card h1{
  font-size:26px;font-weight:800;letter-spacing:-.6px;margin-bottom:8px;
  background:linear-gradient(90deg,#fff,#c4b5fd);-webkit-background-clip:text;
  background-clip:text;color:transparent;
}
.login-card .sub{color:var(--mut);font-size:14px;margin-bottom:32px;line-height:1.6}
.btn-discord{
  display:flex;align-items:center;justify-content:center;gap:12px;
  width:100%;padding:15px 24px;border-radius:12px;
  background:#5865F2;color:#fff;font-weight:600;font-size:15px;
  text-decoration:none;transition:transform .15s,box-shadow .15s,background .15s;
  box-shadow:0 8px 24px -6px rgba(88,101,242,.5);
}
.btn-discord:hover{background:#4752c4;transform:translateY(-2px);box-shadow:0 14px 32px -6px rgba(88,101,242,.65);color:#fff}
.btn-discord:active{transform:translateY(0)}
.btn-discord svg{flex-shrink:0}
.login-foot{
  margin-top:26px;font-size:12px;color:var(--mut);
  display:flex;align-items:center;justify-content:center;gap:6px;
}
.login-foot .dot{width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok)}
.page-footer{
  position:relative;z-index:1;margin-top:32px;font-size:12px;color:var(--mut);text-align:center;
}
.page-footer a{color:var(--mut);margin:0 8px}
.page-footer a:hover{color:var(--pri-hi)}
@media(max-width:480px){.login-card{padding:36px 22px;border-radius:18px}.login-card h1{font-size:22px}}
</style></head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <div class="login-logo">🖤</div>
    <h1>PXKK Dashboard</h1>
    <p class="sub">Entre com sua conta Discord<br>para gerenciar o bot</p>
    <a href="/auth" class="btn-discord">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.3.5a14.7 14.7 0 0 1 4.3 2.2 15 15 0 0 0-12.8 0A14.6 14.6 0 0 1 10.9 3.5L10.6 3a19.7 19.7 0 0 0-4.9 1.4C2.6 8.6 1.9 12.7 2.3 16.7a19.8 19.8 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14 14 0 0 0 12.8 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.8 19.8 0 0 0 6-3c.5-4.6-.7-8.6-3.4-12.3ZM9 14.6c-1.2 0-2.2-1.1-2.2-2.4S7.8 9.8 9 9.8s2.2 1.1 2.2 2.4S10.2 14.6 9 14.6Zm6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
      Entrar com Discord
    </a>
    <div class="login-foot">
      <span class="dot"></span>
      <span>Sistema online e seguro</span>
    </div>
  </div>
  <footer class="page-footer">
    © 2026 PXKK · <a href="#">Suporte</a> · <a href="#">Termos</a> · <a href="#">Privacidade</a>
  </footer>
</div>
</body></html>"""

NOT_OWNER_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acesso negado — PXKK</title>
""" + STYLE + """
<style>
.denied{
  min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
}
.denied-card{
  max-width:460px;width:100%;background:var(--card);
  border:1px solid var(--line);border-radius:20px;padding:48px 32px;
  text-align:center;box-shadow:var(--shadow);position:relative;overflow:hidden;
}
.denied-card::before{
  content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;
  background:radial-gradient(circle at 50% 0%,rgba(239,68,68,.18),transparent 40%);
  pointer-events:none;
}
.denied-icon{
  width:80px;height:80px;margin:0 auto 20px;border-radius:22px;
  background:linear-gradient(135deg,rgba(239,68,68,.18),rgba(239,68,68,.06));
  border:1px solid rgba(239,68,68,.35);
  display:grid;place-items:center;font-size:38px;position:relative;z-index:1;
}
.denied-card h1{font-size:24px;font-weight:800;margin-bottom:10px;position:relative;z-index:1}
.denied-card p{color:var(--mut);font-size:14px;line-height:1.6;position:relative;z-index:1}
.denied-card b{color:var(--tx-dim)}
.denied-card .user-chip{
  display:inline-flex;align-items:center;gap:8px;background:var(--bg-soft);
  border:1px solid var(--line);padding:6px 14px;border-radius:99px;
  margin:20px 0 24px;font-size:13px;position:relative;z-index:1;
}
.btn-back{
  display:inline-flex;align-items:center;gap:8px;padding:12px 26px;
  border-radius:11px;background:var(--bg-soft);border:1px solid var(--line);
  color:var(--tx);font-weight:600;font-size:14px;transition:all .15s;position:relative;z-index:1;
}
.btn-back:hover{background:var(--card-hi);border-color:var(--pri);color:var(--pri-hi)}
</style></head>
<body>
<div class="denied">
  <div class="denied-card">
    <div class="denied-icon">🚫</div>
    <h1>Acesso negado</h1>
    <p>Este painel é privado e restrito à equipe autorizada.</p>
    <div class="user-chip">
      <span>👤</span> <b>{{user.username}}</b>
    </div>
    <br>
    <a href="/logout" class="btn-back">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
      Sair da conta
    </a>
  </div>
</div>
</body></html>"""

DASHBOARD_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PXKK — Dashboard</title>
<meta name="theme-color" content="#07040d">
""" + STYLE + """
<style>
/* ============ TOP BAR ============ */
.topbar{
  position:sticky;top:0;z-index:100;
  display:flex;align-items:center;gap:16px;
  height:64px;padding:0 20px;
  background:rgba(7,4,13,.75);
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border-bottom:1px solid var(--line-soft);
}
.hamburger{
  display:none;width:40px;height:40px;border-radius:10px;
  align-items:center;justify-content:center;flex-direction:column;gap:5px;
  transition:background .15s;
}
.hamburger:hover{background:var(--card)}
.hamburger span{
  display:block;width:20px;height:2px;background:var(--tx);border-radius:2px;
  transition:transform .25s,opacity .25s;
}
.hamburger.open span:nth-child(1){transform:translateY(7px) rotate(45deg)}
.hamburger.open span:nth-child(2){opacity:0}
.hamburger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
.brand{
  display:flex;align-items:center;gap:12px;color:var(--tx);
  font-weight:700;font-size:17px;text-decoration:none;flex-shrink:0;
}
.brand-icon{
  width:36px;height:36px;border-radius:10px;background:var(--grad);
  display:grid;place-items:center;font-size:18px;
  box-shadow:0 6px 16px -4px rgba(124,58,237,.5);
}
.brand-text{display:flex;flex-direction:column;line-height:1.1}
.brand-text .sub{font-size:11px;color:var(--mut);font-weight:500;letter-spacing:.4px;text-transform:uppercase}
.spacer{flex:1}

/* ============ USER DROPDOWN ============ */
.user-wrap{position:relative}
.user-trigger{
  display:flex;align-items:center;gap:10px;padding:6px 12px 6px 6px;
  border-radius:99px;background:var(--card);border:1px solid var(--line);
  transition:all .15s;
}
.user-trigger:hover{background:var(--card-hi);border-color:var(--pri)}
.user-trigger .avatar{
  width:32px;height:32px;border-radius:50%;border:2px solid var(--pri-lo);
}
.user-trigger .name{font-size:14px;font-weight:600;color:var(--tx)}
.role-badge{
  font-size:10px;padding:3px 8px;border-radius:99px;font-weight:700;
  text-transform:uppercase;letter-spacing:.4px;color:#fff;white-space:nowrap;
}
.role-owner{background:linear-gradient(90deg,#7c3aed,#a78bfa)}
.role-dev{background:linear-gradient(90deg,#0ea5e9,#38bdf8)}
.role-staff{background:linear-gradient(90deg,#475569,#64748b)}
.user-trigger .chev{transition:transform .2s;color:var(--mut)}
.user-trigger.open .chev{transform:rotate(180deg)}
.dropdown{
  position:absolute;top:calc(100% + 8px);right:0;min-width:240px;
  background:var(--card);border:1px solid var(--line);border-radius:14px;
  padding:8px;box-shadow:0 20px 50px -10px rgba(0,0,0,.7);
  opacity:0;visibility:hidden;transform:translateY(-6px);
  transition:opacity .15s,transform .15s,visibility .15s;
}
.dropdown.open{opacity:1;visibility:visible;transform:none}
.dd-head{
  display:flex;gap:12px;align-items:center;padding:12px 10px;
  border-bottom:1px solid var(--line-soft);margin-bottom:6px;
}
.dd-head img{width:40px;height:40px;border-radius:50%}
.dd-head .dd-name{font-weight:600;font-size:14px}
.dd-head .dd-id{font-size:11px;color:var(--mut);font-family:ui-monospace,monospace}
.dd-item{
  display:flex;align-items:center;gap:10px;padding:10px 12px;
  border-radius:9px;color:var(--tx-dim);font-size:14px;
  transition:background .15s,color .15s;text-decoration:none;
}
.dd-item:hover{background:var(--card-hi);color:#fca5a5}
.dd-item svg{flex-shrink:0}

/* ============ LAYOUT ============ */
.layout{display:flex;min-height:calc(100vh - 64px);position:relative}
.overlay{
  display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);
  z-index:90;backdrop-filter:blur(2px);
}
.overlay.show{display:block}

/* ============ SIDEBAR ============ */
.sidebar{
  width:260px;flex-shrink:0;background:var(--card);
  border-right:1px solid var(--line-soft);
  padding:18px 12px;overflow-y:auto;
  position:sticky;top:64px;height:calc(100vh - 64px);
}
.sidebar-title{
  font-size:10px;font-weight:700;color:var(--mut);
  text-transform:uppercase;letter-spacing:1.2px;
  padding:8px 12px;margin-bottom:4px;
}
.nav-btn{
  display:flex;align-items:center;gap:12px;width:100%;
  padding:11px 14px;border-radius:10px;
  color:var(--tx-dim);font-size:14px;font-weight:500;
  text-align:left;transition:all .15s;margin-bottom:2px;position:relative;
}
.nav-btn:hover{background:var(--card-hi);color:var(--tx)}
.nav-btn.active{
  background:linear-gradient(90deg,rgba(124,58,237,.22),rgba(124,58,237,.05));
  color:#fff;font-weight:600;
}
.nav-btn.active::before{
  content:'';position:absolute;left:0;top:8px;bottom:8px;width:3px;
  border-radius:0 3px 3px 0;background:var(--grad);
}
.nav-icon{
  width:26px;height:26px;border-radius:8px;flex-shrink:0;
  display:grid;place-items:center;font-size:14px;
  background:var(--bg-soft);transition:transform .15s;
}
.nav-btn.active .nav-icon{background:rgba(167,139,250,.15);transform:scale(1.05)}
.nav-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ============ CONTENT ============ */
.content{
  flex:1;min-width:0;padding:32px 36px 48px;
  display:flex;flex-direction:column;
}
.content-inner{max-width:920px;width:100%;margin:0 auto;flex:1}

.alert{
  display:flex;align-items:center;gap:10px;
  background:rgba(16,185,129,.09);border:1px solid rgba(16,185,129,.35);
  color:#6ee7b7;padding:14px 18px;border-radius:12px;
  font-size:14px;margin-bottom:22px;font-weight:500;
  animation:slideDown .3s cubic-bezier(.2,.9,.3,1);
}
.alert.warn{background:rgba(245,158,11,.09);border-color:rgba(245,158,11,.35);color:#fcd34d}
@keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}

.section{
  display:none;background:var(--card);border:1px solid var(--line-soft);
  border-radius:18px;padding:32px 34px;
}
.section.active{display:block;animation:fadeUp .28s cubic-bezier(.2,.9,.3,1)}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.section-head{margin-bottom:26px;padding-bottom:20px;border-bottom:1px solid var(--line-soft)}
.section-head h2{
  font-size:22px;font-weight:800;letter-spacing:-.4px;margin-bottom:6px;
  display:flex;align-items:center;gap:10px;
}
.section-head p{color:var(--mut);font-size:13.5px}

/* ============ FORM FIELDS ============ */
.f{margin-bottom:20px}
.f label{display:block;font-size:13px;color:var(--tx-dim);font-weight:600;margin-bottom:8px}
.f .hint{font-size:12px;color:var(--mut);margin-top:6px;line-height:1.5}
input[type=text],input[type=number],textarea,select{
  width:100%;padding:12px 14px;border-radius:11px;
  border:1px solid var(--line);background:var(--bg-soft);
  color:var(--tx);font:inherit;font-size:14px;
  transition:border-color .15s,box-shadow .15s,background .15s;
}
input[type=text]:focus,input[type=number]:focus,textarea:focus,select:focus{
  outline:none;border-color:var(--pri);background:var(--card);
  box-shadow:0 0 0 3px rgba(124,58,237,.18);
}
input::placeholder,textarea::placeholder{color:#5b5372}
textarea{min-height:110px;resize:vertical;font-family:inherit;line-height:1.55}
select[multiple]{min-height:160px;padding:8px}
select[multiple] option{padding:8px 10px;border-radius:6px;margin:2px 0}
input[type=color]{
  width:70px;height:44px;border:1px solid var(--line);border-radius:11px;
  background:var(--bg-soft);padding:4px;cursor:pointer;
}
input[type=color]::-webkit-color-swatch-wrapper{padding:0}
input[type=color]::-webkit-color-swatch{border:0;border-radius:7px}

.sw{
  display:flex;align-items:center;gap:14px;padding:14px 16px;
  background:var(--bg-soft);border:1px solid var(--line);border-radius:12px;
  transition:border-color .15s;
}
.sw:hover{border-color:var(--pri-lo)}
.sw input[type=checkbox]{
  appearance:none;-webkit-appearance:none;
  width:44px;height:24px;border-radius:99px;background:var(--line);
  position:relative;cursor:pointer;flex-shrink:0;
  transition:background .2s;
}
.sw input[type=checkbox]::after{
  content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;
  border-radius:50%;background:#fff;transition:transform .2s;
  box-shadow:0 2px 4px rgba(0,0,0,.3);
}
.sw input[type=checkbox]:checked{background:var(--grad)}
.sw input[type=checkbox]:checked::after{transform:translateX(20px)}
.sw label{margin:0;color:var(--tx);font-size:14.5px;font-weight:500;cursor:pointer;flex:1}

/* ============ SAVE BAR ============ */
.save-bar{
  position:fixed;bottom:0;left:260px;right:0;z-index:50;
  padding:16px 32px;background:rgba(7,4,13,.92);
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border-top:1px solid var(--line-soft);
  display:flex;justify-content:flex-end;align-items:center;gap:16px;
}
.save-hint{color:var(--mut);font-size:12.5px;flex:1}
.save-btn{
  padding:13px 34px;border-radius:12px;background:var(--grad);
  color:#fff;font-weight:700;font-size:14.5px;letter-spacing:.2px;
  transition:transform .15s,box-shadow .15s;
  box-shadow:0 10px 26px -8px rgba(124,58,237,.6);
  display:inline-flex;align-items:center;gap:8px;
}
.save-btn:hover{transform:translateY(-2px);box-shadow:0 14px 32px -8px rgba(124,58,237,.75)}
.save-btn:active{transform:translateY(0)}
.save-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}

/* ============ EMPTY STATE ============ */
.empty{
  text-align:center;padding:80px 24px;background:var(--card);
  border:1px dashed var(--line);border-radius:18px;
}
.empty .ic{font-size:56px;margin-bottom:16px;opacity:.7}
.empty h2{font-size:20px;font-weight:700;margin-bottom:8px}
.empty p{color:var(--mut);font-size:14px;max-width:400px;margin:0 auto}

/* ============ FOOTER ============ */
.footer{
  border-top:1px solid var(--line-soft);
  background:var(--card);
  padding:24px 32px;
  margin-left:260px;
}
.footer-inner{
  max-width:920px;margin:0 auto;
  display:flex;justify-content:space-between;align-items:center;
  gap:16px;flex-wrap:wrap;font-size:13px;color:var(--mut);
}
.footer-brand{display:flex;align-items:center;gap:10px;font-weight:600;color:var(--tx-dim)}
.footer-brand .mini-icon{
  width:24px;height:24px;border-radius:7px;background:var(--grad);
  display:grid;place-items:center;font-size:12px;
}
.footer-links{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.footer-links a{color:var(--mut);padding:4px 8px;border-radius:6px;transition:all .15s}
.footer-links a:hover{color:var(--pri-hi);background:var(--card-hi)}
.footer-links .sep{opacity:.4}
.footer-version{
  font-size:11px;padding:3px 8px;border-radius:99px;
  background:var(--bg-soft);border:1px solid var(--line);
  color:var(--mut);font-family:ui-monospace,monospace;
}

/* ============ RESPONSIVE ============ */
@media(max-width:900px){
  .hamburger{display:flex}
  .brand-text .sub{display:none}
  .user-trigger .name{display:none}
  .user-trigger{padding:6px}
  .user-trigger .chev{display:none}
  .sidebar{
    position:fixed;top:64px;left:0;bottom:0;height:calc(100vh - 64px);
    z-index:95;transform:translateX(-100%);
    transition:transform .25s cubic-bezier(.2,.9,.3,1);
    box-shadow:24px 0 60px -10px rgba(0,0,0,.7);
    width:280px;
  }
  .sidebar.open{transform:none}
  .content{padding:22px 18px 42px}
  .section{padding:24px 20px;border-radius:14px}
  .save-bar{left:0;padding:14px 18px}
  .save-hint{display:none}
  .save-btn{width:100%;justify-content:center}
  .footer{margin-left:0;padding:20px 18px;padding-bottom:100px}
  .footer-inner{flex-direction:column;text-align:center;gap:12px}
}
@media(max-width:480px){
  .section-head h2{font-size:19px}
  .content{padding:18px 14px 40px}
  .section{padding:20px 16px}
}
</style></head>
<body>

<!-- TOP BAR -->
<header class="topbar">
  <button class="hamburger" id="hamburger" aria-label="Menu">
    <span></span><span></span><span></span>
  </button>
  <a href="/" class="brand">
    <span class="brand-icon">🖤</span>
    <span class="brand-text">
      <span>PXKK</span>
      <span class="sub">Dashboard</span>
    </span>
  </a>
  <div class="spacer"></div>

  <div class="user-wrap">
    <button class="user-trigger" id="userTrigger">
      <img class="avatar" src="https://cdn.discordapp.com/avatars/{{user.id}}/{{user.avatar}}.png?size=64" alt="">
      <span class="name">{{user.global_name}}</span>
      <span class="role-badge role-{{user.role}}">
        {% if user.role=='owner' %}👑 Dono{% elif user.role=='dev' %}⚙️ Dev{% else %}👥 Staff{% endif %}
      </span>
      <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
        Sair da conta
      </a>
    </div>
  </div>
</header>

<!-- LAYOUT -->
<div class="layout">
  <div class="overlay" id="overlay"></div>

  <aside class="sidebar" id="sidebar">
    <div class="sidebar-title">Seções</div>
    {% for title, _ in sections %}
      {% set parts = title.split(' ', 1) %}
      <button class="nav-btn {{'active' if loop.first}}" data-t="{{loop.index0}}">
        <span class="nav-icon">{{parts[0]}}</span>
        <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
      </button>
    {% endfor %}
  </aside>

  <main class="content">
    <div class="content-inner">
      {% for m in get_flashed_messages() %}<div class="alert">✓ {{m}}</div>{% endfor %}
      {% if not cfg.get('guild_id') %}<div class="alert warn">⚠️ O bot ainda não registrou um servidor. Inicie o bot primeiro.</div>{% endif %}

      {% if not sections %}
        <div class="empty">
          <div class="ic">🔒</div>
          <h2>Nenhuma seção liberada</h2>
          <p>Você ainda não tem permissão para editar nenhuma seção. Fale com o administrador.</p>
        </div>
      {% else %}
      <form method="post" id="cfgForm">
        <input type="hidden" name="_csrf" value="{{csrf()}}">
        {% for title, fields in sections %}
        <section id="s{{loop.index0}}" class="section {{'active' if loop.first}}">
          <div class="section-head">
            <h2>{{title}}</h2>
            <p>Configure os campos abaixo. As alterações aplicam em até 5 segundos no bot.</p>
          </div>
          {% for key,label,typ in fields %}{% set v = cfg.get(key) %}
          <div class="f">
            {% if typ=='bool' %}
              <div class="sw">
                <input type="checkbox" id="{{key}}" name="{{key}}" {{'checked' if v}}>
                <label for="{{key}}">{{label}}</label>
              </div>
            {% else %}
              <label for="{{key}}">{{label}}</label>
              {% if typ=='text' %}<input type="text" id="{{key}}" name="{{key}}" value="{{v or ''}}">
              {% elif typ=='area' %}<textarea id="{{key}}" name="{{key}}">{{v or ''}}</textarea>
              {% elif typ=='list' %}<textarea id="{{key}}" name="{{key}}">{{ (v or [])|join('\n') }}</textarea><div class="hint">Uma mensagem por linha · placeholders: {brand}, {emoji}, {members}</div>
              {% elif typ=='num' %}<input type="number" id="{{key}}" name="{{key}}" value="{{v or 0}}" min="0">
              {% elif typ=='color' %}<input type="color" id="{{key}}" name="{{key}}" value="{{hexcolor(v)}}">
              {% elif typ.startswith('choice') %}<select id="{{key}}" name="{{key}}">{% for o in typ[7:].split(',') %}{% set kv=o.split('=') %}<option value="{{kv[0]}}" {{'selected' if v==kv[0]}}>{{kv[1]}}</option>{% endfor %}</select>
              {% elif typ=='role' %}<select id="{{key}}" name="{{key}}" multiple>{% for i,n in dd.role %}<option value="{{i}}" {{'selected' if i|int in (v or [])}}>{{n}}</option>{% endfor %}</select><div class="hint">Ctrl/Cmd + clique para selecionar vários</div>
              {% else %}<select id="{{key}}" name="{{key}}"><option value="">— nenhum —</option>{% for i,n in dd[typ] %}<option value="{{i}}" {{'selected' if v and i|int==v}}>{{n}}</option>{% endfor %}</select>
              {% endif %}
            {% endif %}
          </div>
          {% endfor %}
        </section>
        {% endfor %}
      </form>
      {% endif %}
    </div>
  </main>
</div>

<!-- SAVE BAR -->
{% if sections %}
<div class="save-bar">
  <div class="save-hint">💾 As alterações aplicam automaticamente no bot em até 5 segundos.</div>
  <button class="save-btn" form="cfgForm" type="submit">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
    Salvar alterações
  </button>
</div>
{% endif %}

<!-- FOOTER -->
<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <span class="mini-icon">🖤</span>
      <span>© 2026 PXKK · Todos os direitos reservados</span>
    </div>
    <div class="footer-links">
      <a href="#">Suporte</a><span class="sep">·</span>
      <a href="#">Termos</a><span class="sep">·</span>
      <a href="#">Privacidade</a><span class="sep">·</span>
      <a href="/logout">Sair</a>
    </div>
    <span class="footer-version">v1.0</span>
  </div>
</footer>

<script>
const hamburger = document.getElementById('hamburger');
const sidebar   = document.getElementById('sidebar');
const overlay   = document.getElementById('overlay');

function toggleSidebar(open){
  const isOpen = open ?? !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', isOpen);
  overlay.classList.toggle('show', isOpen);
  hamburger.classList.toggle('open', isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
}
hamburger?.addEventListener('click', ()=>toggleSidebar());
overlay?.addEventListener('click', ()=>toggleSidebar(false));

document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav-btn, .section').forEach(e=>e.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById('s' + btn.dataset.t);
    if(target) target.classList.add('active');
    if(window.innerWidth <= 900) toggleSidebar(false);
    window.scrollTo({top:0, behavior:'smooth'});
  });
});

const trigger = document.getElementById('userTrigger');
const dropdown = document.getElementById('userDropdown');
trigger?.addEventListener('click',(e)=>{
  e.stopPropagation();
  const isOpen = dropdown.classList.toggle('open');
  trigger.classList.toggle('open', isOpen);
});
document.addEventListener('click',(e)=>{
  if(!dropdown?.contains(e.target) && e.target !== trigger){
    dropdown?.classList.remove('open');
    trigger?.classList.remove('open');
  }
});

document.getElementById('cfgForm')?.addEventListener('submit',(e)=>{
  const btn = document.querySelector('.save-btn');
  if(btn){ btn.disabled = true; btn.innerHTML = '💾 Salvando...'; }
});

document.addEventListener('keydown',(e)=>{
  if(e.key === 'Escape'){
    dropdown?.classList.remove('open');
    trigger?.classList.remove('open');
    if(sidebar?.classList.contains('open')) toggleSidebar(false);
  }
});
</script>
</body></html>"""

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)