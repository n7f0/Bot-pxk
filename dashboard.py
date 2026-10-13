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

OWNER_IDS = _parse_ids("OWNER_IDS")   # dono(s) — acesso total
DEV_IDS   = _parse_ids("DEV_IDS")     # dev(s)  — acesso total (você)

# STAFF: acesso limitado. Formato JSON:
#   {"123456789012345678": ["welcome","tickets"], "987654321098765432": ["verification"]}
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
# slugs: usados em STAFF_PERMS (ordem OBRIGATÓRIA de bater com SECTIONS)
SECTION_SLUGS = [
    "identity",      # 🎨 Identidade
    "autoemoji",     # ✨ Auto-Emoji
    "welcome",       # 👋 Boas-vindas
    "verification",  # ✅ Verificação
    "tickets",       # 🎫 Tickets
    "feedback",      # ⭐ Feedback & Sugestões
    "antibot",       # 🚫 AntiBot
    "voice",         # 🔊 Voz e Status
    "addcargo",      # ➕ /addcargo
    "activity",      # 🎞️ Atividade
]

# tipos: text, area, color, bool, num, choice, ch, vc, cat, role, list
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

# Sanidade: slugs x seções devem ter o mesmo tamanho
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
    # Descobre o papel do usuário
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
    """Retorna as seções visíveis conforme o papel do usuário."""
    allowed = user_data.get("allowed_sections")
    if allowed is None:
        return SECTIONS  # owner/dev veem tudo
    return [s for slug, s in zip(SECTION_SLUGS, SECTIONS) if slug in allowed]

def _editable_fields_for(user_data):
    """Retorna apenas os fields que o usuário pode editar (para o POST)."""
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
        flash("✅ Configurações salvas! O bot aplica em até 5 segundos.")
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
:root{--bg:#08040f;--card:#150a22;--card2:#1c0f2e;--line:#2c1740;--tx:#ece7f7;--mut:#9d93b8;--pri:#3d1a5c;--pri2:#7c3aed;--ok:#10b981}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,-apple-system,sans-serif}
a{color:#a78bfa;text-decoration:none}
a:hover{text-decoration:underline}
</style>"""

LOGIN_HTML = """<!doctype html><html lang="pt-br"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PXKK — Login</title>""" + STYLE + """
<style>
.box{max-width:420px;margin:14vh auto;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:42px 32px;text-align:center;box-shadow:0 20px 60px #0006}
.logo{font-size:44px;margin-bottom:8px}
h1{margin:0 0 6px;font-size:24px;letter-spacing:-.5px}
p{color:var(--mut);margin:0 0 28px;font-size:14px}
.btn{display:inline-flex;align-items:center;gap:10px;background:#5865F2;color:#fff;padding:13px 26px;border-radius:10px;font-weight:600;font-size:15px;text-decoration:none;transition:transform .15s,background .15s}
.btn:hover{background:#4752c4;transform:translateY(-1px);text-decoration:none;color:#fff}
.foot{margin-top:26px;font-size:12px;color:var(--mut)}
</style>
<div class="box">
  <div class="logo">🖤</div>
  <h1>PXKK Dashboard</h1>
  <p>Entre com sua conta Discord para configurar o bot</p>
  <a href="/auth" class="btn">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.3.5a14.7 14.7 0 0 1 4.3 2.2 15 15 0 0 0-12.8 0A14.6 14.6 0 0 1 10.9 3.5L10.6 3a19.7 19.7 0 0 0-4.9 1.4C2.6 8.6 1.9 12.7 2.3 16.7a19.8 19.8 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14 14 0 0 0 12.8 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.8 19.8 0 0 0 6-3c.5-4.6-.7-8.6-3.4-12.3ZM9 14.6c-1.2 0-2.2-1.1-2.2-2.4S7.8 9.8 9 9.8s2.2 1.1 2.2 2.4S10.2 14.6 9 14.6Zm6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
    Entrar com Discord
  </a>
  <div class="foot">Acesso restrito à equipe autorizada</div>
</div>
</html>"""

NOT_OWNER_HTML = """<!doctype html><html lang="pt-br"><meta charset="utf-8">
<title>Acesso negado</title>""" + STYLE + """
<div style="max-width:420px;margin:20vh auto;text-align:center;padding:40px;background:var(--card);border:1px solid #ff3366;border-radius:18px">
<div style="font-size:56px">🚫</div>
<h1 style="margin:12px 0 8px">Acesso negado</h1>
<p style="color:var(--mut)">Olá <b>{{user.username}}</b>, você não tem permissão para acessar este painel.</p>
<a href="/logout" style="display:inline-block;margin-top:20px;color:#a78bfa">← Sair</a>
</div></html>"""

DASHBOARD_HTML = """<!doctype html><html lang="pt-br"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PXKK — Dashboard</title>""" + STYLE + """
<style>
.top{position:sticky;top:0;z-index:10;display:flex;justify-content:space-between;align-items:center;
 padding:14px 24px;background:#08040fee;backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:17px}
.top .user{display:flex;align-items:center;gap:12px;font-size:14px;color:var(--mut)}
.top .user img{width:32px;height:32px;border-radius:50%;border:2px solid var(--pri2)}
.top .user a{color:#ff6b8b;font-size:13px}
.badge{font-size:11px;padding:3px 9px;border-radius:7px;color:#fff;text-transform:uppercase;letter-spacing:.5px;font-weight:700}
.badge.owner{background:linear-gradient(90deg,#7c3aed,#a78bfa)}
.badge.dev{background:linear-gradient(90deg,#0ea5e9,#38bdf8)}
.badge.staff{background:linear-gradient(90deg,#475569,#64748b)}
.wrap{display:grid;grid-template-columns:250px 1fr;min-height:calc(100vh - 61px)}
aside{background:var(--card);border-right:1px solid var(--line);padding:18px 12px;overflow-y:auto;position:sticky;top:61px;height:calc(100vh - 61px)}
aside h3{font-size:11px;color:var(--mut);letter-spacing:1px;text-transform:uppercase;margin:16px 8px 8px}
aside button{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px 12px;border:0;background:none;color:var(--mut);border-radius:9px;cursor:pointer;font:inherit;font-size:14px;transition:background .15s,color .15s}
aside button:hover{background:var(--card2);color:var(--tx)}
aside button.on{background:linear-gradient(90deg,var(--pri),#4c1d95);color:#fff;font-weight:600}
main{padding:28px 32px 130px;max-width:900px}
main h2{margin:0 0 4px;font-size:22px}
main .su