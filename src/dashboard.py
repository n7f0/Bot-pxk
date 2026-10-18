"""
Dashboard público — pxkk.com.br
Sistema completo: níveis MEE6, VIP, staff, filtros, 5 tipos de ticket.
Visual: High Contrast Magazine (preto absoluto + roxo elétrico).
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
    "identity", "colors", "autoemoji", "welcome", "verification",
    "tickets", "feedback", "antibot", "voice", "addcargo", "activity",
    "levels", "filters", "vip", "staff",
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
    ("🏆 Níveis (MEE6)", [
        ("levels_enabled", "Sistema de níveis ativado", "bool"),
        ("levels_xp_per_message", "XP por mensagem", "num"),
        ("levels_xp_cooldown_seconds", "Cooldown entre XP (segundos)", "num"),
        ("levels_announce_channel_id", "Canal de anúncio de level up", "ch"),
        ("levels_message_up", "Mensagem de level up (use {user}, {level}, {xp})", "area"),
    ]),
    ("🛡️ Filtros de Palavras/Links", [
        ("filters_enabled", "Filtros ativados", "bool"),
        ("filters_punish_after_warnings", "Avisos até aplicar castigo (0 = desliga)", "num"),
        ("filters_links_allowed_role_ids", "Cargos que podem mandar links", "role"),
        ("filters_log_channel_id", "Canal de logs de filtros", "ch"),
        ("filters_blocked_words", "Palavras bloqueadas (uma por linha)", "list"),
        ("filters_allowed_domains", "Domínios de link permitidos (um por linha)", "list"),
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
  --black:#000000;--black-soft:#0a0a0a;--black-card:#0d0d0d;--black-elevated:#141414;
  --purple:#8A4FFF;--purple-hi:#A370FF;--purple-lo:#6B2EE0;--purple-glow:rgba(138,79,255,0.4);
  --white:#FFFFFF;--white-soft:#F5F5F5;
  --gray-hi:#B8B8C2;--gray-mid:#7A7A88;--gray-lo:#4A4A55;
  --border:rgba(255,255,255,0.08);--border-hi:rgba(138,79,255,0.35);
  --ok:#4ade80;--warn:#fbbf24;--err:#f87171;
  --radius-sm:4px;--radius:8px;--radius-lg:12px;
  --ease:cubic-bezier(.4,0,.2,1);
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
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:var(--black)}
::-webkit-scrollbar-thumb{background:var(--gray-lo);border-radius:8px}
::-webkit-scrollbar-thumb:hover{background:var(--purple)}
</style>"""

LOGIN_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="description" content="PXKK Dashboard — gerencie seu bot Discord.">
<title>PXKK — Dashboard</title>
""" + STYLE + """
<style>
.login-page{min-height:100vh;display:grid;grid-template-columns:1.2fr 1fr;background:var(--black);overflow:hidden;position:relative}
.hero{position:relative;padding:56px 72px;display:flex;flex-direction:column;justify-content:space-between;
  background:
    radial-gradient(ellipse 900px 600px at 20% 30%,rgba(138,79,255,0.18),transparent 60%),
    radial-gradient(ellipse 700px 500px at 80% 80%,rgba(138,79,255,0.08),transparent 60%),
    var(--black);
  overflow:hidden;border-right:1px solid var(--border);min-height:100vh}
.hero::before{content:'';position:absolute;inset:0;
  background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);
  background-size:64px 64px;
  mask-image:radial-gradient(ellipse 70% 60% at 30% 40%,#000 30%,transparent 90%);
  -webkit-mask-image:radial-gradient(ellipse 70% 60% at 30% 40%,#000 30%,transparent 90%);pointer-events:none}
.hero::after{content:'';position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--purple),transparent);opacity:.5}
.hero-top,.hero-mid,.hero-bottom{position:relative;z-index:1}
.hero-brand{display:flex;align-items:center;gap:16px;font-family:'Archivo Black',sans-serif;
  font-size:28px;letter-spacing:-0.04em;color:var(--white)}
.hero-brand .mark{width:68px;height:68px;border:1px solid var(--purple);display:grid;place-items:center;
  background:radial-gradient(circle at 30% 30%,rgba(138,79,255,.15),transparent 70%);
  box-shadow:0 0 24px -8px var(--purple-glow);overflow:hidden;border-radius:8px;}
.hero-brand .mark img{width:100%;height:100%;object-fit:cover;display:block;}
.hero-brand .name{display:flex;flex-direction:column;line-height:1}
.hero-mid{max-width:560px}
.hero-mid h1{font-family:'Archivo Black',sans-serif;font-size:clamp(42px,5.2vw,76px);line-height:.95;
  color:var(--white);margin-bottom:28px;letter-spacing:-0.045em;text-transform:uppercase}
.hero-mid h1 .accent{color:var(--purple);text-shadow:0 0 40px var(--purple-glow)}
.hero-mid p{font-size:16px;color:var(--gray-hi);line-height:1.7;max-width:460px}
.hero-bottom{display:flex;align-items:center;gap:24px;flex-wrap:wrap;font-size:12px;color:var(--gray-mid);letter-spacing:.02em}
.stat{display:flex;align-items:center;gap:8px}
.stat b{color:var(--white);font-weight:700}
.divider{width:1px;height:12px;background:var(--border)}
.login-panel{display:flex;align-items:center;justify-content:center;padding:48px 32px;background:var(--black);position:relative}
.login-panel::before{content:'';position:absolute;inset:0;
  background:radial-gradient(circle at 50% 50%,rgba(138,79,255,.08),transparent 60%);pointer-events:none}
.login-card{position:relative;width:100%;max-width:440px;padding:56px 48px;
  border:1px solid rgba(255,255,255,0.06);border-top:1px solid rgba(138,79,255,0.4);
  background:linear-gradient(180deg, rgba(16,16,20,0.95) 0%, rgba(8,8,10,0.98) 100%);
  border-radius:16px;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  box-shadow:0 32px 80px -20px rgba(0,0,0,0.9), 0 0 40px -10px rgba(138,79,255,0.15);}
.login-card::before{content:'';position:absolute;top:-1px;left:40px;right:40px;height:1px;
  background:linear-gradient(90deg,transparent,var(--purple),transparent);opacity:.8}
.card-head{margin-bottom:40px;text-align:center;}
.card-head .mini-tag{display:inline-block;font-size:10px;font-weight:800;color:var(--white);
  background:rgba(138,79,255,0.15);border:1px solid rgba(138,79,255,0.3);padding:6px 14px;
  border-radius:6px;letter-spacing:.2em;margin-bottom:20px;text-transform:uppercase}
.card-head h2{font-family:'Archivo Black',sans-serif;font-size:34px;letter-spacing:-0.03em;
  color:var(--white);margin-bottom:12px;text-transform:uppercase;line-height:1.1}
.card-head p{font-size:14px;color:var(--gray-hi);line-height:1.65}
.btn-discord{display:flex;align-items:center;justify-content:space-between;gap:14px;
  width:100%;padding:18px 24px;background:linear-gradient(135deg, var(--purple) 0%, #6B2EE0 100%);
  color:var(--white);font-weight:700;font-size:15px;text-decoration:none;transition:all .25s var(--ease);
  letter-spacing:-.005em;position:relative;overflow:hidden;border:1px solid rgba(255,255,255,0.15);border-radius:10px;
  box-shadow:0 12px 30px -8px rgba(138,79,255,0.5);}
.btn-discord::before{content:'';position:absolute;inset:0;
  background:linear-gradient(120deg,transparent,rgba(255,255,255,.2),transparent);
  transform:translateX(-100%);transition:transform .5s var(--ease)}
.btn-discord:hover{background:linear-gradient(135deg, #A370FF 0%, #8A4FFF 100%);
  box-shadow:0 16px 40px -8px rgba(138,79,255,0.7);transform:translateY(-2px);color:var(--white)}
.btn-discord:hover::before{transform:translateX(100%)}
.btn-discord .left{display:flex;align-items:center;gap:12px;position:relative;z-index:1}
.btn-discord .arrow{position:relative;z-index:1;transition:transform .2s var(--ease)}
.btn-discord:hover .arrow{transform:translateX(4px)}
.login-foot{margin-top:32px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.05);
  display:flex;align-items:center;justify-content:space-between;gap:12px;}
.status-pill { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 99px;
  background: rgba(74, 222, 128, 0.05); border: 1px solid rgba(74, 222, 128, 0.15);
  color: #86efac; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.status-dot { width: 6px; height: 6px; background: #4ade80; border-radius: 50%; box-shadow: 0 0 10px #4ade80;
  animation: pulse-dot 2s infinite; }
@keyframes pulse-dot { 0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5); }
  70% { transform: scale(1); box-shadow: 0 0 0 4px rgba(74, 222, 128, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); } }
.secure-pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 99px;
  background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--gray-hi); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.secure-pill svg { color: var(--purple-hi); }
.page-mini-footer{position:fixed;bottom:24px;left:0;right:0;
  font-size:11px;color:var(--gray-lo);display:flex;justify-content:center;z-index:100;letter-spacing:.1em;text-transform:uppercase;font-weight:600;}
@media(max-width:960px){
  .login-page{grid-template-columns:1fr}
  .hero{padding:36px 28px 44px;min-height:auto;border-right:0;border-bottom:1px solid var(--border)}
  .hero-mid h1{font-size:clamp(36px,9vw,52px)}
  .hero-mid p{font-size:15px}
  .hero-bottom{font-size:11px;gap:12px;flex-wrap:wrap}
  .login-panel{padding:36px 20px 80px}
  .login-card{max-width:440px;padding:40px 28px}
  .page-mini-footer{position:relative;margin-top:32px;bottom:auto;}
}
@media(max-width:480px){
  .hero{padding:28px 20px 36px}
  .hero-brand{font-size:24px;}
  .hero-brand .mark{width:56px;height:56px;}
  .login-panel{padding:28px 16px 60px}
  .login-card{padding:32px 22px}
  .card-head h2{font-size:28px;}
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
      <h1>Gerencie seu<br>servidor com<br><span class="accent">precisão total.</span></h1>
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
        <h2>Bem-vindo<br>de volta</h2>
        <p>Autentique-se com sua conta do Discord para acessar o painel administrativo.</p>
      </div>
      <a href="/auth" class="btn-discord">
        <span class="left">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.3.5a14.7 14.7 0 0 1 4.3 2.2 15 15 0 0 0-12.8 0A14.6 14.6 0 0 1 10.9 3.5L10.6 3a19.7 19.7 0 0 0-4.9 1.4C2.6 8.6 1.9 12.7 2.3 16.7a19.8 19.8 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14 14 0 0 0 12.8 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.8 19.8 0 0 0 6-3c.5-4.6-.7-8.6-3.4-12.3ZM9 14.6c-1.2 0-2.2-1.1-2.2-2.4S7.8 9.8 9 9.8s2.2 1.1 2.2 2.4S10.2 14.6 9 14.6Zm6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
          Entrar com Discord
        </span>
        <svg class="arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </a>
      <div class="login-foot">
        <div class="status-pill"><span class="status-dot"></span> Online</div>
        <div class="secure-pill">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path></svg>
          Seguro
        </div>
      </div>
    </div>
  </section>
</main>
<footer class="page-mini-footer">
  <span>© 2026 PXKK</span>
</footer>
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
.denied-card{position:relative;max-width:440px;width:100%;background:rgba(10,10,10,.8);backdrop-filter:blur(12px);
  border:1px solid var(--border);padding:56px 40px;text-align:center;z-index:1}
.denied-card::before{content:'';position:absolute;top:-1px;left:32px;right:32px;height:1px;
  background:linear-gradient(90deg,transparent,var(--err),transparent)}
.denied-icon{width:76px;height:76px;margin:0 auto 24px;border:1px solid rgba(248,113,113,.4);
  display:grid;place-items:center;font-size:34px;background:radial-gradient(circle,rgba(248,113,113,.08),transparent 70%)}
.denied-card h1{font-family:'Archivo Black',sans-serif;font-size:26px;letter-spacing:-.03em;
  margin-bottom:12px;color:var(--white);text-transform:uppercase;line-height:1.05}
.denied-card p{color:var(--gray-hi);font-size:14px;line-height:1.65;margin-bottom:8px}
.user-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border:1px solid var(--border);
  margin:24px 0 28px;font-size:12.5px;color:var(--gray-hi);background:rgba(255,255,255,.02);font-weight:500}
.user-chip b{color:var(--white);font-weight:600}
.user-chip svg{color:var(--purple-hi)}
.btn-back{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:14px 28px;
  border:1px solid var(--purple);background:transparent;color:var(--white);font-weight:600;font-size:13px;
  letter-spacing:.02em;transition:all .2s var(--ease);text-transform:uppercase}
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
/* LAYOUT GERAL */
.topbar{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;align-items:center;gap:16px;height:72px;padding:0 32px;
  background:rgba(0,0,0,.85);backdrop-filter:blur(20px) saturate(1.3);-webkit-backdrop-filter:blur(20px) saturate(1.3);
  border-bottom:1px solid var(--border)}
.topbar::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--purple),transparent);opacity:.4;pointer-events:none}
.hamburger{display:none;width:40px;height:40px;align-items:center;justify-content:center;flex-direction:column;gap:5px;
  transition:background .18s var(--ease);border:1px solid transparent;border-radius:8px;}
.hamburger:hover{background:var(--black-elevated);border-color:var(--border)}
.hamburger span{display:block;width:18px;height:1.5px;background:var(--white);transition:transform .25s var(--ease),opacity .2s}
.hamburger.open span:nth-child(1){transform:translateY(6.5px) rotate(45deg)}
.hamburger.open span:nth-child(2){opacity:0}
.hamburger.open span:nth-child(3){transform:translateY(-6.5px) rotate(-45deg)}
.brand{display:flex;align-items:center;gap:14px;color:var(--white);text-decoration:none;flex-shrink:0}
.brand-icon{width:42px;height:42px;border:1px solid rgba(138,79,255,0.4);display:grid;place-items:center;font-size:16px;
  background:radial-gradient(circle at 30% 30%,rgba(138,79,255,.2),transparent 70%);box-shadow:0 0 20px -6px var(--purple-glow);overflow:hidden;border-radius:10px;}
.brand-icon img{width:100%;height:100%;object-fit:cover;display:block;}
.brand-text{display:flex;flex-direction:column;line-height:1}
.brand-text .name{font-family:'Archivo Black',sans-serif;font-weight:400;font-size:18px;letter-spacing:-.03em;color:var(--white)}
.brand-text .sub{font-size:10px;color:var(--gray-mid);font-weight:700;letter-spacing:.24em;text-transform:uppercase;margin-top:4px}
.spacer{flex:1}

/* USER MENU */
.user-wrap{position:relative}
.user-trigger{display:flex;align-items:center;gap:12px;padding:6px 14px 6px 6px;background:var(--black-elevated);
  border:1px solid var(--border);transition:all .18s var(--ease);border-radius:99px;cursor:pointer;}
.user-trigger:hover{background:var(--black-card);border-color:var(--border-hi);box-shadow:0 0 20px -8px var(--purple-glow)}
.user-trigger .avatar{width:36px;height:36px;border:1px solid var(--border-hi);border-radius:50%;object-fit:cover;}
.user-trigger .name{font-size:14px;font-weight:600;color:var(--white);letter-spacing:-.01em;}
.role-badge{font-size:10px;padding:4px 10px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--white);white-space:nowrap;border-radius:99px;}
.role-owner{background:linear-gradient(135deg, var(--purple), #6B2EE0);}
.role-dev{background:linear-gradient(135deg, #3b82f6, #2563eb);}
.role-staff{background:var(--gray-lo);}
.user-trigger .chev{transition:transform .22s var(--ease);color:var(--gray-mid);margin-left:4px;}
.user-trigger.open .chev{transform:rotate(180deg)}
.dropdown{position:absolute;top:calc(100% + 12px);right:0;min-width:280px;background:rgba(10,10,10,.98);
  backdrop-filter:blur(24px);border:1px solid var(--border-hi);padding:10px;border-radius:12px;
  box-shadow:0 24px 60px -20px rgba(0,0,0,.9),0 0 40px -8px var(--purple-glow);
  opacity:0;visibility:hidden;transform:translateY(-6px);transition:opacity .18s var(--ease),transform .18s var(--ease),visibility .18s}
.dropdown::before{content:'';position:absolute;top:-1px;left:24px;right:24px;height:1px;
  background:linear-gradient(90deg,transparent,var(--purple),transparent)}
.dropdown.open{opacity:1;visibility:visible;transform:none}
.dd-head{display:flex;gap:14px;align-items:center;padding:14px 12px;border-bottom:1px solid var(--border);margin-bottom:8px}
.dd-head img{width:44px;height:44px;border:1px solid var(--border-hi);border-radius:50%;object-fit:cover;}
.dd-head .dd-name{font-weight:700;font-size:14.5px;color:var(--white)}
.dd-head .dd-id{font-size:11px;color:var(--gray-mid);font-family:ui-monospace,'SF Mono',monospace;margin-top:4px;letter-spacing:.02em}
.dd-item{display:flex;align-items:center;gap:12px;padding:12px 14px;color:var(--gray-hi);font-size:13.5px;
  transition:all .15s var(--ease);font-weight:500;text-decoration:none;border-radius:8px;}
.dd-item:hover{background:rgba(138,79,255,.12);color:var(--white)}
.dd-item svg{color:var(--gray-mid);transition:color .15s;}
.dd-item:hover svg{color:var(--white);}

/* SIDEBAR */
.layout{display:flex;min-height:100vh;padding-top:72px;position:relative;background:var(--black);}
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:90;backdrop-filter:blur(4px)}
.overlay.show{display:block}
.sidebar{width:280px;flex-shrink:0;background:var(--black-soft);border-right:1px solid var(--border);padding:24px 16px;
  overflow-y:auto;position:fixed;top:72px;bottom:0;left:0;}
.sidebar-title{font-size:10px;font-weight:800;color:var(--gray-mid);text-transform:uppercase;
  letter-spacing:.2em;padding:8px 16px;margin-bottom:16px}
.nav-btn{display:flex;align-items:center;gap:14px;width:100%;padding:12px 16px;color:var(--gray-hi);font-size:14px;
  font-weight:500;text-align:left;transition:all .2s var(--ease);margin-bottom:4px;position:relative;
  letter-spacing:-.01em;border-radius:8px;border:1px solid transparent;}
.nav-btn:hover{background:rgba(255,255,255,.04);color:var(--white)}
.nav-btn.active{background:linear-gradient(90deg,rgba(138,79,255,.15),rgba(138,79,255,.05));color:var(--white);
  font-weight:600;border-color:rgba(138,79,255,0.2);}
.nav-btn.active::before{content:'';position:absolute;left:-16px;top:12px;bottom:12px;width:4px;background:var(--purple);border-radius:0 4px 4px 0;box-shadow:0 0 12px var(--purple);}
.nav-icon{width:28px;height:28px;flex-shrink:0;display:grid;place-items:center;font-size:14px;
  background:rgba(255,255,255,.04);border:1px solid var(--border);transition:all .2s var(--ease);border-radius:6px;}
.nav-btn.active .nav-icon{background:rgba(138,79,255,.2);border-color:var(--border-hi);color:var(--white);}
.nav-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;letter-spacing:-.01em}

/* CONTEÚDO PRINCIPAL */
.content{margin-left:280px;flex:1;min-width:0;padding:48px 56px 120px;display:flex;flex-direction:column;}
.content-inner{max-width:960px;width:100%;margin:0 auto;flex:1}
.alert{display:flex;align-items:center;gap:14px;padding:16px 20px;margin-bottom:32px;font-size:14px;
  font-weight:500;border:1px solid;animation:slideDown .32s var(--ease);border-radius:8px;
  background:rgba(74,222,128,.08);border-color:rgba(74,222,128,.3);color:#86efac}
.alert.warn{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.3);color:#fde68a}
@keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}

/* CARDS DE SEÇÃO */
.section{display:none;background:#060606;border:1px solid var(--border);padding:40px;position:relative;border-radius:16px;}
.section::before{content:'';position:absolute;top:-1px;left:40px;right:40px;height:1px;
  background:linear-gradient(90deg,transparent,var(--purple),transparent);opacity:.6;pointer-events:none}
.section.active{display:block;animation:fadeUp .32s var(--ease)}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.section-head{margin-bottom:36px;padding-bottom:28px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px;}
.section-head h2{font-family:'Archivo Black',sans-serif;font-size:28px;font-weight:400;letter-spacing:-.03em;
  color:var(--white);display:flex;align-items:center;gap:14px;text-transform:uppercase;line-height:1.1}
.section-head p{color:var(--gray-mid);font-size:13.5px;line-height:1.65;letter-spacing:-.005em}

/* FORMULÁRIO GRID */
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.f { display: flex; flex-direction: column; gap: 10px; }
.f.full-width { grid-column: 1 / -1; }
.f label{font-size:12px;color:var(--gray-hi);font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.f .hint{font-size:12px;color:var(--gray-lo);line-height:1.5;letter-spacing:.01em;}

/* INPUTS PREMIUM */
input[type=text],input[type=number],textarea,select{
  width:100%;padding:14px 16px;border:1px solid var(--border);
  background:var(--black-elevated);color:var(--white);font:inherit;font-size:14px;letter-spacing:-.005em;
  border-radius:8px;transition:all .2s var(--ease);}
input[type=text]:hover,input[type=number]:hover,textarea:hover,select:hover { border-color: rgba(255,255,255,0.15); }
input[type=text]:focus,input[type=number]:focus,textarea:focus,select:focus{
  outline:none;border-color:var(--purple);background:#000;
  box-shadow:0 0 0 3px rgba(138,79,255,0.15);}
input::placeholder,textarea::placeholder{color:var(--gray-lo)}
textarea{min-height:120px;resize:vertical;font-family:inherit;line-height:1.6}
select[multiple]{min-height:180px;padding:10px}
select[multiple] option{padding:10px 12px;margin:2px 0;background:var(--black-elevated);color:var(--white);border-radius:4px;}
select[multiple] option:checked{background:var(--purple);color:var(--white)}

/* COLOR PICKER CUSTOMIZADO */
.color-wrapper { display: flex; align-items: center; gap: 12px; background: var(--black-elevated); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); transition: all .2s; }
.color-wrapper:hover { border-color: rgba(255,255,255,0.15); }
input[type=color]{appearance:none; -webkit-appearance:none; width: 36px; height: 36px; border: none; padding: 0; background: transparent; cursor: pointer; border-radius: 6px; overflow: hidden;}
input[type=color]::-webkit-color-swatch-wrapper{padding:0;}
input[type=color]::-webkit-color-swatch{border: 1px solid rgba(255,255,255,0.2); border-radius: 6px;}
.color-hex { font-family: ui-monospace, 'SF Mono', monospace; font-size: 14px; color: var(--gray-hi); text-transform: uppercase; letter-spacing: 0.05em; }

/* TOGGLE SWITCH */
.sw{display:flex;align-items:center;gap:16px;padding:14px 16px;background:var(--black-elevated);border:1px solid var(--border);
  transition:all .2s var(--ease);cursor:pointer;border-radius:8px;}
.sw:hover{border-color:rgba(255,255,255,0.15); background: #111;}
.sw input[type=checkbox]{appearance:none;-webkit-appearance:none;width:44px;height:24px;background:var(--gray-lo);
  position:relative;cursor:pointer;flex-shrink:0;transition:background .22s var(--ease);border-radius:99px;}
.sw input[type=checkbox]::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;
  background:#fff;transition:transform .22s var(--ease);box-shadow:0 1px 3px rgba(0,0,0,.4)}
.sw input[type=checkbox]:checked{background:var(--purple);box-shadow:0 0 12px -2px var(--purple-glow)}
.sw input[type=checkbox]:checked::after{transform:translateX(20px)}
.sw span{color:var(--white);font-size:14px;font-weight:500;cursor:pointer;flex:1;letter-spacing:-.01em}

/* BOTÃO SALVAR */
.save-bar{position:fixed;bottom:0;left:280px;right:0;z-index:50;padding:20px 56px;background:rgba(6,6,6,.85);
  backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:1px solid var(--border);
  display:flex;justify-content:space-between;align-items:center;gap:16px}
.save-bar::before{content:'';position:absolute;top:-1px;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--purple),transparent);opacity:.3;pointer-events:none}
.save-hint{color:var(--gray-mid);font-size:13px;letter-spacing:.01em; display:flex; align-items: center; gap: 8px;}
.save-hint svg { color: var(--purple-hi); }
.save-btn{padding:14px 36px;background:linear-gradient(135deg, var(--purple), #6B2EE0);color:var(--white);font-weight:700;font-size:14px;
  letter-spacing:.02em;transition:all .2s var(--ease);border:1px solid rgba(255,255,255,0.1);border-radius:8px;
  display:inline-flex;align-items:center;gap:10px;position:relative;overflow:hidden;box-shadow: 0 8px 24px -8px rgba(138,79,255,0.6);}
.save-btn::before{content:'';position:absolute;inset:0;
  background:linear-gradient(120deg,transparent,rgba(255,255,255,.2),transparent);
  transform:translateX(-100%);transition:transform .5s var(--ease)}
.save-btn:hover{background:linear-gradient(135deg, #A370FF, #8A4FFF); box-shadow:0 12px 32px -8px rgba(138,79,255,0.8);transform:translateY(-2px)}
.save-btn:hover::before{transform:translateX(100%)}
.save-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}

/* EMPTY STATE */
.empty{text-align:center;padding:88px 24px;border:1px dashed var(--border);position:relative;border-radius:16px;}
.empty .ic{font-size:56px;margin-bottom:20px;opacity:.4}
.empty h2{font-family:'Archivo Black',sans-serif;font-size:22px;margin-bottom:12px;color:var(--white);
  text-transform:uppercase;letter-spacing:-.02em}
.empty p{color:var(--gray-hi);font-size:14px;max-width:400px;margin:0 auto;line-height:1.65}

/* RESPONSIVO */
@media(max-width:1024px){
  .form-grid { grid-template-columns: 1fr; }
}
@media(max-width:960px){
  .hamburger{display:flex}
  .brand-text .sub{display:none}
  .user-trigger .name{display:none}
  .user-trigger{padding:6px}
  .user-trigger .chev{display:none}
  .sidebar{position:fixed;top:72px;left:0;bottom:0;height:calc(100vh - 72px);z-index:95;
    transform:translateX(-100%);transition:transform .28s var(--ease);
    box-shadow:24px 0 60px -10px rgba(0,0,0,.9);width:280px;border-right-color:var(--border-hi)}
  .sidebar.open{transform:none}
  .content{margin-left:0; padding:32px 24px 120px;}
  .section{padding:28px 24px;}
  .save-bar{left:0;padding:16px 24px;}
  .save-hint{display:none}
  .save-btn{width:100%;justify-content:center}
}
@media(max-width:480px){
  .content{padding:24px 16px 120px}
  .section{padding:24px 20px; border-radius:12px;}
  .section-head h2{font-size:22px}
  .section-head{padding-bottom:22px;margin-bottom:28px}
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
    <div class="sidebar-title">Configurações</div>
    {% for title, _ in sections %}
      {% set parts = title.split(' ', 1) %}
      <button class="nav-btn {{'active' if loop.first}}" data-t="{{loop.index0}}">
        <span class="nav-icon" aria-hidden="true">{{parts[0]}}</span>
        <span class="nav-label">{{parts[1] if parts|length > 1 else title}}</span>
      </button>
    {% endfor %}
  </aside>

  <main class="content">
    <div class="content-inner">
      {% for m in get_flashed_messages() %}
        <div class="alert" role="status">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>
          {{m}}
        </div>
      {% endfor %}
      {% if not cfg.get('guild_id') %}
        <div class="alert warn" role="alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>
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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
    Alterações são aplicadas automaticamente em até 5s.
  </div>
  <button class="save-btn" form="cfgForm" type="submit">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
    Salvar alterações
  </button>
</div>
{% endif %}

<script>
const hamburger = document.getElementById('hamburger');
const sidebar   = document.getElementById('sidebar');
const overlay   = document.getElementById('overlay');
function toggleSidebar(open){
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
// Atualiza o código HEX ao lado da cor em tempo real
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
