"""
Dashboard público — pxkk.com.br
Sistema completo: níveis MEE6, VIP, staff, filtros, 5 tipos de ticket.
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
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
:root{
  --ink-900:#000000;--ink-800:#0a0a0a;--ink-700:#141414;--ink-600:#1f1f1f;
  --ink-500:#292929;--ink-400:#333333;--purple:#8A2BE2;--purple-hi:#9B30FF;
  --purple-lo:#4B0082;--mist:#e0e0e0;--mist-hi:#ffffff;--mist-lo:#aaaaaa;
  --ok:#5fa87d;--warn:#c9a15a;--err:#c96363;
  --radius-sm:8px;--radius:12px;--radius-lg:18px;--radius-xl:24px;
  --shadow-sm:0 1px 2px rgba(0,0,0,.28);
  --shadow:0 4px 14px rgba(0,0,0,.35),0 1px 3px rgba(0,0,0,.25);
  --shadow-lg:0 24px 60px -20px rgba(0,0,0,.65),0 8px 24px -12px rgba(0,0,0,.5);
  --ease:cubic-bezier(.4,0,.2,1);
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{
  background:var(--ink-900);color:var(--mist-hi);
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased;
  letter-spacing:-0.005em;min-height:100vh;
}
a{color:var(--purple-hi);text-decoration:none;transition:color .18s var(--ease)}
a:hover{color:var(--mist-hi)}
button{font-family:inherit;cursor:pointer;border:0;background:none;color:inherit;font-size:inherit}
img{display:block;max-width:100%}
::selection{background:var(--purple);color:#fff}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:var(--ink-900)}
::-webkit-scrollbar-thumb{background:var(--ink-600);border-radius:10px;border:2px solid var(--ink-900)}
::-webkit-scrollbar-thumb:hover{background:var(--ink-500)}
</style>"""

LOGIN_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="description" content="PXKK Dashboard — gerencie seu bot Discord de forma simples e profissional.">
<title>PXKK — Plataforma de Gerenciamento</title>
""" + STYLE + """
<style>
.login-page{min-height:100vh;display:grid;grid-template-columns:1.15fr 1fr;position:relative;overflow:hidden;background:var(--ink-900)}
.hero{position:relative;padding:56px 72px;display:flex;flex-direction:column;justify-content:space-between;
  background:radial-gradient(1200px 700px at -20% 100%,rgba(138,43,226,.28),transparent 60%),
             radial-gradient(900px 600px at 110% 0%,rgba(138,43,226,.14),transparent 55%),var(--ink-900);
  overflow:hidden;border-right:1px solid var(--ink-700)}
.hero::before{content:'';position:absolute;inset:0;
  background-image:linear-gradient(rgba(191,192,209,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(191,192,209,.035) 1px,transparent 1px);
  background-size:56px 56px;
  mask-image:radial-gradient(ellipse 70% 60% at 30% 40%,#000 20%,transparent 90%);
  -webkit-mask-image:radial-gradient(ellipse 70% 60% at 30% 40%,#000 20%,transparent 90%);pointer-events:none}
.hero-top,.hero-mid,.hero-bottom{position:relative;z-index:1}
.hero-brand{display:flex;align-items:center;gap:14px;font-weight:800;font-size:18px;letter-spacing:-0.03em;color:var(--mist-hi)}
.hero-brand .mark{width:44px;height:44px;border-radius:12px;background:var(--purple);display:grid;place-items:center;font-size:20px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 8px 24px -8px rgba(138,43,226,.7);position:relative}
.hero-brand .name{display:flex;flex-direction:column;line-height:1.05}
.hero-brand .name small{font-size:10px;font-weight:600;color:var(--mist-lo);letter-spacing:.16em;text-transform:uppercase;margin-top:2px}
.hero-mid{max-width:540px}
.hero-mid .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11.5px;font-weight:600;color:var(--mist);
  letter-spacing:.16em;text-transform:uppercase;padding:6px 12px;border-radius:99px;
  border:1px solid var(--ink-600);background:rgba(49,50,62,.5);margin-bottom:28px}
.hero-mid .eyebrow .dot{width:6px;height:6px;border-radius:50%;background:var(--purple-hi);box-shadow:0 0 0 3px rgba(155,48,255,.25)}
.hero-mid h1{font-size:clamp(38px,4.4vw,58px);font-weight:800;line-height:1.04;letter-spacing:-0.035em;color:var(--mist-hi);margin-bottom:22px}
.hero-mid h1 .accent{color:var(--purple-hi)}
.hero-mid p{font-size:17px;color:var(--mist);line-height:1.65;max-width:480px}
.hero-mid .features{display:flex;flex-wrap:wrap;gap:10px;margin-top:32px}
.hero-mid .feature{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:10px;
  background:rgba(49,50,62,.55);border:1px solid var(--ink-600);font-size:13px;color:var(--mist);font-weight:500;
  transition:all .18s var(--ease)}
.hero-mid .feature:hover{border-color:var(--purple);background:rgba(138,43,226,.12);transform:translateY(-1px)}
.hero-mid .feature svg{color:var(--purple-hi);flex-shrink:0}
.hero-bottom{display:flex;align-items:center;gap:20px;flex-wrap:wrap;font-size:12.5px;color:var(--mist-lo)}
.hero-bottom .stat{display:flex;align-items:center;gap:8px}
.hero-bottom .stat b{color:var(--mist-hi);font-weight:700}
.hero-bottom .divider{width:1px;height:14px;background:var(--ink-500)}
.login-panel{display:flex;align-items:center;justify-content:center;padding:48px 32px;background:var(--ink-800);position:relative}
.login-panel::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(138,43,226,.5),transparent)}
.login-card{width:100%;max-width:400px;position:relative}
.login-card .card-head{margin-bottom:32px}
.login-card .card-head h2{font-size:26px;font-weight:800;letter-spacing:-0.03em;color:var(--mist-hi);margin-bottom:8px}
.login-card .card-head p{font-size:14.5px;color:var(--mist);line-height:1.6}
.btn-discord{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;padding:16px 20px;
  border-radius:var(--radius);background:var(--purple);color:#fff;font-weight:700;font-size:15px;text-decoration:none;
  transition:all .2s var(--ease);box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 12px 32px -12px rgba(138,43,226,.85);position:relative;overflow:hidden}
.btn-discord:hover{background:var(--purple-hi);transform:translateY(-2px);color:#fff}
.btn-discord .left{display:flex;align-items:center;gap:12px}
.btn-discord .arrow{opacity:.7;transition:transform .2s var(--ease)}
.btn-discord:hover .arrow{transform:translateX(3px);opacity:1}
.login-foot{margin-top:22px;padding-top:22px;border-top:1px solid var(--ink-600);
  display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12.5px;color:var(--mist-lo)}
.login-foot .status{display:flex;align-items:center;gap:8px}
.login-foot .status .dot{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px rgba(95,168,125,.2)}
.login-foot .secure{display:flex;align-items:center;gap:6px}
.page-mini-footer{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);font-size:11.5px;color:var(--mist-lo);display:flex;gap:16px;z-index:5}
.page-mini-footer a{color:var(--mist-lo)}
@media(max-width:960px){.login-page{grid-template-columns:1fr}.hero{padding:36px 28px 40px;min-height:auto}.hero-mid h1{font-size:32px}.hero-mid p{font-size:15px}.hero-bottom{font-size:11.5px;gap:12px}.login-panel{padding:36px 24px}.login-card{max-width:440px}}
</style></head>
<body>
<main class="login-page">
  <section class="hero" aria-label="Apresentação">
    <div class="hero-top">
      <div class="hero-brand">
        <span class="mark">🖤</span>
        <span class="name">PXKK<small>Management Platform</small></span>
      </div>
    </div>
    <div class="hero-mid">
      <span class="eyebrow"><span class="dot"></span> Plano Profissional</span>
      <h1>Gerencie seu servidor com <span class="accent">precisão total</span>.</h1>
      <p>Toda a configuração do seu bot em um painel único, seguro e intuitivo.</p>
      <div class="features">
        <span class="feature"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>Tickets & Suporte</span>
        <span class="feature"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>Verificação AntiBot</span>
        <span class="feature"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>Sugestões & Feedback</span>
        <span class="feature"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>Níveis MEE6</span>
        <span class="feature"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>VIP & Staff</span>
      </div>
    </div>
    <div class="hero-bottom">
      <div class="stat"><b>OAuth2</b> seguro via Discord</div>
      <span class="divider"></span>
      <div class="stat"><b>Cloudflare</b> protegido</div>
      <span class="divider"></span>
      <div class="stat"><b>100%</b> em tempo real</div>
    </div>
  </section>
  <section class="login-panel" aria-label="Entrar">
    <div class="login-card">
      <div class="card-head">
        <h2>Bem-vindo de volta</h2>
        <p>Autentique-se com sua conta do Discord para acessar o painel.</p>
      </div>
      <a href="/auth" class="btn-discord">
        <span class="left">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.3.5a14.7 14.7 0 0 1 4.3 2.2 15 15 0 0 0-12.8 0A14.6 14.6 0 0 1 10.9 3.5L10.6 3a19.7 19.7 0 0 0-4.9 1.4C2.6 8.6 1.9 12.7 2.3 16.7a19.8 19.8 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14 14 0 0 0 12.8 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.8 19.8 0 0 0 6-3c.5-4.6-.7-8.6-3.4-12.3ZM9 14.6c-1.2 0-2.2-1.1-2.2-2.4S7.8 9.8 9 9.8s2.2 1.1 2.2 2.4S10.2 14.6 9 14.6Zm6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
          Entrar com Discord
        </span>
        <svg class="arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </a>
      <div class="login-foot">
        <div class="status"><span class="dot"></span> Sistema operacional</div>
        <div class="secure"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Conexão segura</div>
      </div>
    </div>
  </section>
</main>
<footer class="page-mini-footer">
  <span>© 2026 PXKK</span><a href="#">Suporte</a><a href="#">Termos</a><a href="#">Privacidade</a>
</footer>
</body></html>"""

NOT_OWNER_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acesso negado — PXKK</title><meta name="robots" content="noindex">
<meta name="theme-color" content="#000000">
""" + STYLE + """
<style>
.denied{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(900px 600px at 50% -10%,rgba(201,99,99,.10),transparent 60%),var(--ink-900)}
.denied-card{max-width:460px;width:100%;background:var(--ink-800);border:1px solid var(--ink-600);border-radius:var(--radius-lg);padding:52px 36px;text-align:center;box-shadow:var(--shadow-lg);position:relative;overflow:hidden}
.denied-icon{width:72px;height:72px;margin:0 auto 22px;border-radius:18px;background:rgba(201,99,99,.10);border:1px solid rgba(201,99,99,.28);display:grid;place-items:center;font-size:32px}
.denied-card h1{font-size:24px;font-weight:800;letter-spacing:-0.03em;margin-bottom:10px;color:var(--mist-hi)}
.denied-card p{color:var(--mist);font-size:14.5px;line-height:1.6}
.denied-card .user-chip{display:inline-flex;align-items:center;gap:8px;background:var(--ink-900);border:1px solid var(--ink-600);padding:8px 16px;border-radius:99px;margin:22px 0 26px;font-size:13px;color:var(--mist);font-weight:500}
.denied-card .user-chip b{color:var(--mist-hi)}
.btn-back{display:inline-flex;align-items:center;gap:8px;padding:12px 24px;border-radius:var(--radius);background:var(--ink-700);border:1px solid var(--ink-500);color:var(--mist-hi);font-weight:600;font-size:14px;transition:all .18s var(--ease)}
.btn-back:hover{background:var(--ink-600);border-color:var(--purple);color:var(--mist-hi);transform:translateY(-1px)}
</style></head>
<body>
<div class="denied"><div class="denied-card">
<div class="denied-icon">🚫</div>
<h1>Acesso negado</h1>
<p>Este painel é privado e restrito à equipe autorizada.</p>
<div class="user-chip"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/></svg><b>{{user.username}}</b></div>
<br>
<a href="/logout" class="btn-back">
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
Sair da conta
</a>
</div></div></body></html>"""

DASHBOARD_HTML = """<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#000000"><meta name="robots" content="noindex">
<title>Dashboard — PXKK</title>
""" + STYLE + """
<style>
.topbar{position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:16px;height:64px;padding:0 24px;
  background:rgba(28,32,44,.85);backdrop-filter:blur(20px) saturate(1.3);-webkit-backdrop-filter:blur(20px) saturate(1.3);border-bottom:1px solid var(--ink-700)}
.hamburger{display:none;width:40px;height:40px;border-radius:10px;align-items:center;justify-content:center;flex-direction:column;gap:5px;transition:background .18s var(--ease)}
.hamburger:hover{background:var(--ink-700)}
.hamburger span{display:block;width:18px;height:1.5px;background:var(--mist);border-radius:2px;transition:transform .25s var(--ease),opacity .2s}
.hamburger.open span:nth-child(1){transform:translateY(6.5px) rotate(45deg)}
.hamburger.open span:nth-child(2){opacity:0}
.hamburger.open span:nth-child(3){transform:translateY(-6.5px) rotate(-45deg)}
.brand{display:flex;align-items:center;gap:12px;color:var(--mist-hi);text-decoration:none;flex-shrink:0}
.brand-icon{width:36px;height:36px;border-radius:10px;background:var(--purple);display:grid;place-items:center;font-size:16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 6px 18px -8px rgba(138,43,226,.7)}
.brand-text{display:flex;flex-direction:column;line-height:1.1}
.brand-text .name{font-weight:800;font-size:15.5px;letter-spacing:-0.02em}
.brand-text .sub{font-size:10px;color:var(--mist-lo);font-weight:600;letter-spacing:.14em;text-transform:uppercase}
.spacer{flex:1}
.user-wrap{position:relative}
.user-trigger{display:flex;align-items:center;gap:10px;padding:5px 12px 5px 5px;border-radius:99px;background:var(--ink-700);border:1px solid var(--ink-600);transition:all .18s var(--ease)}
.user-trigger:hover{background:var(--ink-600);border-color:var(--ink-500)}
.user-trigger .avatar{width:32px;height:32px;border-radius:50%;border:1.5px solid var(--ink-500)}
.user-trigger .name{font-size:13.5px;font-weight:600;color:var(--mist-hi)}
.role-badge{font-size:9.5px;padding:3px 8px;border-radius:99px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#fff;white-space:nowrap}
.role-owner{background:var(--purple)}.role-dev{background:#3e6d99}.role-staff{background:var(--ink-500)}
.user-trigger .chev{transition:transform .22s var(--ease);color:var(--mist-lo)}
.user-trigger.open .chev{transform:rotate(180deg)}
.dropdown{position:absolute;top:calc(100% + 10px);right:0;min-width:250px;background:var(--ink-800);border:1px solid var(--ink-600);border-radius:var(--radius);padding:8px;box-shadow:var(--shadow-lg);opacity:0;visibility:hidden;transform:translateY(-6px);transition:opacity .18s var(--ease),transform .18s var(--ease),visibility .18s}
.dropdown.open{opacity:1;visibility:visible;transform:none}
.dd-head{display:flex;gap:12px;align-items:center;padding:12px 10px;border-bottom:1px solid var(--ink-700);margin-bottom:6px}
.dd-head img{width:40px;height:40px;border-radius:50%}
.dd-head .dd-name{font-weight:700;font-size:14px;color:var(--mist-hi)}
.dd-head .dd-id{font-size:11px;color:var(--mist-lo);font-family:ui-monospace,'SF Mono',monospace}
.dd-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;color:var(--mist);font-size:13.5px;transition:background .15s var(--ease),color .15s var(--ease);text-decoration:none;font-weight:500}
.dd-item:hover{background:var(--ink-700);color:var(--mist-hi)}
.layout{display:flex;min-height:calc(100vh - 64px);position:relative}
.overlay{display:none;position:fixed;inset:0;background:rgba(15,17,25,.7);z-index:90;backdrop-filter:blur(4px)}
.overlay.show{display:block}
.sidebar{width:270px;flex-shrink:0;background:var(--ink-800);border-right:1px solid var(--ink-700);padding:20px 14px;overflow-y:auto;position:sticky;top:64px;height:calc(100vh - 64px)}
.sidebar-title{font-size:10px;font-weight:700;color:var(--mist-lo);text-transform:uppercase;letter-spacing:.16em;padding:8px 14px;margin-bottom:8px}
.nav-btn{display:flex;align-items:center;gap:12px;width:100%;padding:11px 14px;border-radius:10px;color:var(--mist);font-size:14px;font-weight:500;text-align:left;transition:all .16s var(--ease);margin-bottom:2px;position:relative;letter-spacing:-0.005em}
.nav-btn:hover{background:var(--ink-700);color:var(--mist-hi)}
.nav-btn.active{background:rgba(138,43,226,.14);color:var(--mist-hi);font-weight:600}
.nav-btn.active::before{content:'';position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--purple-hi)}
.nav-icon{width:26px;height:26px;border-radius:7px;flex-shrink:0;display:grid;place-items:center;font-size:13px;background:var(--ink-700);transition:background .16s var(--ease)}
.nav-btn.active .nav-icon{background:rgba(138,43,226,.28)}
.nav-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;letter-spacing:-0.005em}
.content{flex:1;min-width:0;padding:40px 48px 56px;display:flex;flex-direction:column}
.content-inner{max-width:920px;width:100%;margin:0 auto;flex:1}
.alert{display:flex;align-items:center;gap:10px;background:rgba(95,168,125,.08);border:1px solid rgba(95,168,125,.28);color:#8ecba8;padding:14px 18px;border-radius:var(--radius);font-size:14px;margin-bottom:24px;font-weight:500;animation:slideDown .32s var(--ease)}
.alert.warn{background:rgba(201,161,90,.08);border-color:rgba(201,161,90,.28);color:#dfbf85}
@keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.section{display:none;background:var(--ink-800);border:1px solid var(--ink-700);border-radius:var(--radius-lg);padding:36px 40px}
.section.active{display:block;animation:fadeUp .32s var(--ease)}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.section-head{margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid var(--ink-700)}
.section-head h2{font-size:22px;font-weight:800;letter-spacing:-0.03em;margin-bottom:8px;color:var(--mist-hi);display:flex;align-items:center;gap:12px}
.section-head p{color:var(--mist);font-size:13.5px;line-height:1.6}
.f{margin-bottom:22px}
.f label{display:block;font-size:13px;color:var(--mist);font-weight:600;margin-bottom:9px;letter-spacing:-0.005em}
.f .hint{font-size:12px;color:var(--mist-lo);margin-top:7px;line-height:1.5}
input[type=text],input[type=number],textarea,select{width:100%;padding:12px 14px;border-radius:var(--radius-sm);border:1px solid var(--ink-600);background:var(--ink-900);color:var(--mist-hi);font:inherit;font-size:14px;transition:border-color .16s var(--ease),box-shadow .16s var(--ease),background .16s var(--ease)}
input[type=text]:focus,input[type=number]:focus,textarea:focus,select:focus{outline:none;border-color:var(--purple);background:var(--ink-800);box-shadow:0 0 0 3px rgba(138,43,226,.20)}
input::placeholder,textarea::placeholder{color:var(--ink-400)}
textarea{min-height:110px;resize:vertical;font-family:inherit;line-height:1.6}
select[multiple]{min-height:160px;padding:8px}
select[multiple] option{padding:8px 10px;border-radius:6px;margin:2px 0}
input[type=color]{width:70px;height:44px;border:1px solid var(--ink-600);border-radius:var(--radius-sm);background:var(--ink-900);padding:4px;cursor:pointer}
input[type=color]::-webkit-color-swatch-wrapper{padding:0}
input[type=color]::-webkit-color-swatch{border:0;border-radius:6px}
.sw{display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--ink-900);border:1px solid var(--ink-600);border-radius:var(--radius-sm);transition:border-color .16s var(--ease);cursor:pointer}
.sw:hover{border-color:var(--ink-500)}
.sw input[type=checkbox]{appearance:none;-webkit-appearance:none;width:42px;height:24px;border-radius:99px;background:var(--ink-500);position:relative;cursor:pointer;flex-shrink:0;transition:background .22s var(--ease)}
.sw input[type=checkbox]::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .22s var(--ease);box-shadow:0 1px 3px rgba(0,0,0,.35)}
.sw input[type=checkbox]:checked{background:var(--purple)}
.sw input[type=checkbox]:checked::after{transform:translateX(18px)}
.sw label{margin:0;color:var(--mist-hi);font-size:14px;font-weight:500;cursor:pointer;flex:1;letter-spacing:-0.005em}
.save-bar{position:fixed;bottom:0;left:270px;right:0;z-index:50;padding:16px 32px;background:rgba(28,32,44,.94);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-top:1px solid var(--ink-700);display:flex;justify-content:flex-end;align-items:center;gap:16px}
.save-hint{color:var(--mist-lo);font-size:12.5px;flex:1;letter-spacing:-0.005em}
.save-btn{padding:13px 30px;border-radius:var(--radius-sm);background:var(--purple);color:#fff;font-weight:700;font-size:14px;letter-spacing:-0.005em;transition:all .2s var(--ease);box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 8px 22px -10px rgba(138,43,226,.85);display:inline-flex;align-items:center;gap:8px}
.save-btn:hover{background:var(--purple-hi);transform:translateY(-1px)}
.save-btn:disabled{opacity:.5;cursor:not-allowed}
.empty{text-align:center;padding:80px 24px;background:var(--ink-800);border:1px dashed var(--ink-600);border-radius:var(--radius-lg)}
.empty .ic{font-size:52px;margin-bottom:16px;opacity:.5}
.empty h2{font-size:19px;font-weight:700;margin-bottom:8px;color:var(--mist-hi);letter-spacing:-0.02em}
.empty p{color:var(--mist);font-size:14px;max-width:400px;margin:0 auto;line-height:1.6}
.footer{border-top:1px solid var(--ink-700);background:var(--ink-800);padding:28px 48px;margin-left:270px}
.footer-inner{max-width:920px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--mist-lo)}
.footer-brand{display:flex;align-items:center;gap:10px;font-weight:600;color:var(--mist)}
.footer-brand .mini-icon{width:26px;height:26px;border-radius:7px;background:var(--purple);display:grid;place-items:center;font-size:12px}
.footer-links{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.footer-links a{color:var(--mist-lo);padding:5px 9px;border-radius:6px;transition:all .16s var(--ease)}
.footer-links a:hover{color:var(--mist-hi);background:var(--ink-700)}
.footer-links .sep{opacity:.4}
.footer-version{font-size:10.5px;padding:3px 8px;border-radius:99px;background:var(--ink-900);border:1px solid var(--ink-600);color:var(--mist-lo);font-family:ui-monospace,'SF Mono',monospace}
@media(max-width:960px){
  .hamburger{display:flex}
  .brand-text .sub{display:none}
  .user-trigger .name{display:none}
  .user-trigger{padding:5px}
  .user-trigger .chev{display:none}
  .sidebar{position:fixed;top:64px;left:0;bottom:0;height:calc(100vh - 64px);z-index:95;transform:translateX(-100%);transition:transform .28s var(--ease);box-shadow:24px 0 60px -10px rgba(0,0,0,.7);width:280px}
  .sidebar.open{transform:none}
  .content{padding:28px 22px 48px}
  .section{padding:28px 22px;border-radius:var(--radius)}
  .save-bar{left:0;padding:14px 20px}
  .save-hint{display:none}
  .save-btn{width:100%;justify-content:center}
  .footer{margin-left:0;padding:24px 22px 100px}
  .footer-inner{flex-direction:column;text-align:center;gap:14px}
}
@media(max-width:480px){
  .section-head h2{font-size:19px}
  .content{padding:22px 16px 44px}
  .section{padding:24px 18px}
}
</style></head>
<body>
<header class="topbar">
  <button class="hamburger" id="hamburger" aria-label="Abrir menu" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>
  <a href="/" class="brand" aria-label="PXKK Dashboard">
    <span class="brand-icon" aria-hidden="true">🖤</span>
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
      <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>
          {{m}}
        </div>
      {% endfor %}
      {% if not cfg.get('guild_id') %}
        <div class="alert warn" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>
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
          {% for key,label,typ in fields %}{% set v = cfg.get(key) %}
          <div class="f">
            {% if typ=='bool' %}
              <label class="sw" for="{{key}}">
                <input type="checkbox" id="{{key}}" name="{{key}}" {{'checked' if v}}>
                <span>{{label}}</span>
              </label>
            {% else %}
              <label for="{{key}}">{{label}}</label>
              {% if typ=='text' %}<input type="text" id="{{key}}" name="{{key}}" value="{{v or ''}}">
              {% elif typ=='area' %}<textarea id="{{key}}" name="{{key}}">{{v or ''}}</textarea>
              {% elif typ=='list' %}<textarea id="{{key}}" name="{{key}}">{{ (v or [])|join('\n') }}</textarea><div class="hint">Uma linha por item</div>
              {% elif typ=='num' %}<input type="number" id="{{key}}" name="{{key}}" value="{{v or 0}}" min="0">
              {% elif typ=='color' %}<input type="color" id="{{key}}" name="{{key}}" value="{{hexcolor(v)}}">
              {% elif typ.startswith('choice') %}<select id="{{key}}" name="{{key}}">{% for o in typ[7:].split(',') %}{% set kv=o.split('=') %}<option value="{{kv[0]}}" {{'selected' if v==kv[0]}}>{{kv[1]}}</option>{% endfor %}</select>
              {% elif typ=='role_single' %}<select id="{{key}}" name="{{key}}"><option value="">— nenhum —</option>{% for i,n in dd.role %}<option value="{{i}}" {{'selected' if v and i|int==v}}>{{n}}</option>{% endfor %}</select>
              {% elif typ=='role' %}<select id="{{key}}" name="{{key}}" multiple size="6">{% for i,n in dd.role %}<option value="{{i}}" {{'selected' if i|int in (v or [])}}>{{n}}</option>{% endfor %}</select><div class="hint">Ctrl/Cmd para selecionar vários</div>
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

{% if sections %}
<div class="save-bar" role="region" aria-label="Salvar alterações">
  <div class="save-hint">Alterações aplicam automaticamente no bot em até 5 segundos.</div>
  <button class="save-btn" form="cfgForm" type="submit">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
    Salvar alterações
  </button>
</div>
{% endif %}

<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <span class="mini-icon" aria-hidden="true">🖤</span>
      <span>© 2026 PXKK · Todos os direitos reservados</span>
    </div>
    <nav class="footer-links" aria-label="Links do rodapé">
      <a href="#">Suporte</a><span class="sep">·</span>
      <a href="#">Termos</a><span class="sep">·</span>
      <a href="#">Privacidade</a><span class="sep">·</span>
      <a href="/logout">Sair</a>
    </nav>
    <span class="footer-version">v2.0</span>
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
</script>
</body></html>"""
