import os, json, time, hmac, hashlib, secrets, requests
from flask import Flask, request, session, redirect, url_for, render_template_string, flash, jsonify

CONFIG_FILE = "/app/data/config.json"
TOKEN = os.getenv("DISCORD_TOKEN", "")
PASSWORD = os.getenv("PANEL_PASSWORD", "")
if not PASSWORD:
    raise SystemExit("Defina PANEL_PASSWORD no .env para proteger o painel.")

app = Flask(__name__)
app.secret_key = os.getenv("PANEL_SECRET") or hashlib.sha256(("pxk" + PASSWORD).encode()).hexdigest()
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")

# ---------- Esquema dos campos ----------
# tipos: text, area, color, bool, num, choice, ch (canal texto), vc (voz), cat (categoria), role (multi cargos)
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
    ]),
    ("👋 Boas-vindas e saída", [
        ("welcome_channel_id", "Canal de boas-vindas", "ch"),
        ("welcome_message", "Mensagem de boas-vindas", "area"),
        ("welcome_image_url", "Imagem de boas-vindas (URL)", "text"),
        ("leave_channel_id", "Canal de saída", "ch"),
        ("leave_message", "Mensagem de saída", "area"),
    ]),
    ("✅ Verificação", [
        ("verification_method", "Método", "choice:math=Conta matemática,button=Botão"),
        ("verification_difficulty", "Dificuldade (1-3)", "num"),
        ("verification_kick_minutes", "Kick após X min sem verificar (0 = desligado)", "num"),
        ("verified_role_ids", "Cargos dados ao verificar", "role"),
        ("verification_unverified_role_ids", "Cargos de não verificado", "role"),
        ("verification_channel_id", "Canal de verificação", "ch"),
        ("verification_panel_channel_id", "Canal do painel de verificação", "ch"),
        ("verification_log_channel_id", "Canal de logs de verificação", "ch"),
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
        ("ticket_doubt_desc", "Dúvidas — descrição", "text"),
        ("ticket_doubt_emoji", "Dúvidas — emoji", "text"),
        ("ticket_purchase_label", "Compras — nome", "text"),
        ("ticket_purchase_desc", "Compras — descrição", "text"),
        ("ticket_purchase_emoji", "Compras — emoji", "text"),
        ("feedback_channel_id", "Canal de avaliações", "ch"),
    ]),
    ("💡 Sugestões", [
        ("suggestions_channel_id", "Canal onde sugestões chegam", "ch"),
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
    ("🔊 Voz, status e logs", [
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

# ---------- Config ----------
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

# ---------- Discord (canais / cargos) ----------
_cache = {"t": 0, "gid": None, "data": None}

def discord_data(gid):
    if not gid or not TOKEN:
        return {"ch": [], "vc": [], "cat": [], "role": []}
    if _cache["data"] and _cache["gid"] == gid and time.time() - _cache["t"] < 60:
        return _cache["data"]
    h = {"Authorization": f"Bot {TOKEN}"}
    out = {"ch": [], "vc": [], "cat": [], "role": []}
    try:
        chs = requests.get(f"https://discord.com/api/v10/guilds/{gid}/channels", headers=h, timeout=8).json()
        roles = requests.get(f"https://discord.com/api/v10/guilds/{gid}/roles", headers=h, timeout=8).json()
        cats = {c["id"]: c["name"] for c in chs if c["type"] == 4}
        for c in sorted(chs, key=lambda x: x.get("position", 0)):
            label = c["name"]
            if c.get("parent_id") in cats:
                label = f"{cats[c['parent_id']]} › {label}"
            if c["type"] in (0, 5): out["ch"].append((c["id"], "#" + label))
            elif c["type"] == 2: out["vc"].append((c["id"], "🔊 " + label))
            elif c["type"] == 4: out["cat"].append((c["id"], c["name"]))
        out["role"] = [(r["id"], "@" + r["name"]) for r in sorted(roles, key=lambda r: -r["position"]) if r["name"] != "@everyone"]
        _cache.update(t=time.time(), gid=gid, data=out)
    except Exception:
        pass
    return out

# ---------- Auth ----------
def csrf():
    if "csrf" not in session:
        session["csrf"] = secrets.token_hex(16)
    return session["csrf"]

app.jinja_env.globals["csrf"] = csrf

@app.before_request
def guard():
    if request.endpoint in ("login", "static"):
        return
    if not session.get("ok"):
        return redirect(url_for("login"))
    if request.method == "POST" and not hmac.compare_digest(request.form.get("_csrf", ""), session.get("csrf", "x")):
        return "CSRF inválido", 400

_tries = {}

@app.route("/login", methods=["GET", "POST"])
def login():
    err = None
    if request.method == "POST":
        ip = request.remote_addr
        n, t = _tries.get(ip, (0, 0))
        if n >= 5 and time.time() - t < 300:
            err = "Muitas tentativas. Aguarde 5 minutos."
        elif hmac.compare_digest(request.form.get("password", ""), PASSWORD):
            _tries.pop(ip, None)
            session["ok"] = True
            return redirect(url_for("index"))
        else:
            _tries[ip] = (n + 1, time.time())
            err = "Senha incorreta."
    return render_template_string(LOGIN, err=err)

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

# ---------- Página principal ----------
def int_or_none(v):
    v = (v or "").strip()
    return int(v) if v.isdigit() else None

@app.route("/", methods=["GET", "POST"])
def index():
    cfg = read_config()
    if request.method == "POST":
        for _, fields in SECTIONS:
            for key, _label, typ in fields:
                if typ in ("text", "area", "choice") or typ.startswith("choice"):
                    cfg[key] = request.form.get(key, "").strip() if typ != "area" else request.form.get(key, "").replace("\r\n", "\n")
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
    dd = discord_data(cfg.get("guild_id"))
    return render_template_string(PAGE, sections=SECTIONS, cfg=cfg, dd=dd,
                                  hexcolor=lambda n: "#%06x" % (n if isinstance(n, int) else 0))

@app.route("/healthz")
def healthz():
    return jsonify(ok=True)

# ---------- Templates ----------
STYLE = """
<style>
:root{--bg:#0d0b14;--card:#171225;--line:#2b2340;--tx:#ece7f7;--mut:#9d93b8;--pri:#8a2be2;--pri2:#b026ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,sans-serif}
a{color:var(--pri2)}
</style>"""

LOGIN = """<!doctype html><html lang="pt-br"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel do Bot</title>""" + STYLE + """
<style>form{max-width:340px;margin:18vh auto;background:var(--card);border:1px solid var(--line);padding:28px;border-radius:14px}
h1{margin:0 0 16px;font-size:20px}input{width:100%;padding:11px;border-radius:8px;border:1px solid var(--line);background:#0f0b1a;color:var(--tx);margin-bottom:12px}
button{width:100%;padding:11px;border:0;border-radius:8px;background:linear-gradient(90deg,var(--pri),var(--pri2));color:#fff;font-weight:600;cursor:pointer}.e{color:#ff6b8b;margin-bottom:10px}</style>
<form method="post"><h1>🖤 Painel do Bot</h1>{% if err %}<div class="e">{{err}}</div>{% endif %}
<input type="password" name="password" placeholder="Senha do painel" autofocus required><button>Entrar</button></form></html>"""

PAGE = """<!doctype html><html lang="pt-br"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel do Bot</title>""" + STYLE + """
<style>
header{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:#0d0b14ee;backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
header b{font-size:17px}main{max-width:900px;margin:0 auto;padding:20px 16px 120px}
nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
nav button{background:var(--card);color:var(--mut);border:1px solid var(--line);padding:8px 14px;border-radius:999px;cursor:pointer;font-size:14px}
nav button.on{color:#fff;border-color:var(--pri2);background:#2a1748}
section{display:none;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}section.on{display:block}
.f{margin-bottom:16px}label{display:block;font-size:13px;color:var(--mut);margin-bottom:5px}
input[type=text],input[type=number],textarea,select{width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:#0f0b1a;color:var(--tx);font:inherit}
textarea{min-height:110px;resize:vertical}select[multiple]{min-height:130px}
input[type=color]{width:60px;height:38px;border:1px solid var(--line);border-radius:8px;background:none;padding:2px}
.sw{display:flex;align-items:center;gap:10px}.sw input{width:20px;height:20px;accent-color:var(--pri2)}.sw label{margin:0;color:var(--tx);font-size:15px}
.bar{position:fixed;bottom:0;left:0;right:0;padding:14px;background:#0d0b14f2;border-top:1px solid var(--line);text-align:center}
.bar button{padding:12px 34px;border:0;border-radius:10px;background:linear-gradient(90deg,var(--pri),var(--pri2));color:#fff;font-weight:600;font-size:15px;cursor:pointer}
.ok{background:#12301f;border:1px solid #1f6b3f;color:#8ff0b5;padding:10px 14px;border-radius:10px;margin-bottom:16px}
.hint{font-size:12px;color:var(--mut);margin-top:4px}.warn{background:#2c2312;border:1px solid #6b5a1f;color:#f0d98f;padding:10px 14px;border-radius:10px;margin-bottom:16px;font-size:13px}
</style>
<header><b>🖤 Painel do Bot</b><a href="/logout">Sair</a></header>
<main>
{% for m in get_flashed_messages() %}<div class="ok">{{m}}</div>{% endfor %}
{% if not cfg.get('guild_id') %}<div class="warn">O bot ainda não registrou um servidor (guild_id). Inicie o bot primeiro para os menus de canais/cargos aparecerem.</div>{% endif %}
<form method="post"><input type="hidden" name="_csrf" value="{{csrf()}}">
<nav>{% for title, _ in sections %}<button type="button" data-t="{{loop.index0}}" class="{{'on' if loop.first}}">{{title}}</button>{% endfor %}</nav>
{% for title, fields in sections %}<section id="s{{loop.index0}}" class="{{'on' if loop.first}}">
{% for key,label,typ in fields %}{% set v = cfg.get(key) %}<div class="f">
{% if typ=='bool' %}<div class="sw"><input type="checkbox" id="{{key}}" name="{{key}}" {{'checked' if v}}><label for="{{key}}">{{label}}</label></div>
{% else %}<label for="{{key}}">{{label}}</label>
{% if typ=='text' %}<input type="text" id="{{key}}" name="{{key}}" value="{{v or ''}}">
{% elif typ=='area' %}<textarea id="{{key}}" name="{{key}}">{{v or ''}}</textarea>
{% elif typ=='num' %}<input type="number" id="{{key}}" name="{{key}}" value="{{v or 0}}" min="0">
{% elif typ=='color' %}<input type="color" id="{{key}}" name="{{key}}" value="{{hexcolor(v)}}">
{% elif typ.startswith('choice') %}<select id="{{key}}" name="{{key}}">{% for o in typ[7:].split(',') %}{% set kv=o.split('=') %}<option value="{{kv[0]}}" {{'selected' if v==kv[0]}}>{{kv[1]}}</option>{% endfor %}</select>
{% elif typ=='role' %}<select id="{{key}}" name="{{key}}" multiple>{% for i,n in dd.role %}<option value="{{i}}" {{'selected' if i|int in (v or [])}}>{{n}}</option>{% endfor %}</select><div class="hint">Ctrl/Cmd + clique para vários.</div>
{% else %}<select id="{{key}}" name="{{key}}"><option value="">— nenhum —</option>{% for i,n in dd[typ] %}<option value="{{i}}" {{'selected' if v and i|int==v}}>{{n}}</option>{% endfor %}</select>
{% endif %}{% endif %}</div>{% endfor %}</section>{% endfor %}
<div class="bar"><button>💾 Salvar alterações</button></div></form></main>
<script>
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
 document.querySelectorAll('nav button,section').forEach(e=>e.classList.remove('on'));
 b.classList.add('on');document.getElementById('s'+b.dataset.t).classList.add('on');});
</script></html>"""

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
