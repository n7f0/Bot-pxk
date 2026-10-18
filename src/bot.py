import discord
from discord import app_commands, ui
from discord.ext import commands, tasks
import json, os, datetime, random, logging, aiohttp, asyncio, re, shutil, time
from database import *

TOKEN = os.getenv("DISCORD_TOKEN")
if not TOKEN: raise ValueError("DISCORD_TOKEN não definido.")

CONFIG_FILE = "/app/data/config.json"
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
for n in ("discord.voice_state","discord.voice_client","discord.player","discord.gateway"):
    logging.getLogger(n).setLevel(logging.WARNING)

FFMPEG_AVAILABLE = shutil.which("ffmpeg") is not None

# ===================== EMOJIS =====================
EMOJI = {
    "nitro_boo":"<a:912822415908827136:924037624467980329>",
    "minecraft":"<:g_minecraft25:926135884762472478>",
    "insta":"<:insta:916911739185004605>",
    "verificado":"<a:verificado_rosa:926137751483584552>",
    "tdj_1":"<a:tdj_1:925370141997428816>","tdj_2":"<a:tdj_2:925370171462418452>",
    "tdj_3":"<a:tdj_3:925370195130867772>","tdj_4":"<a:tdj_4:925370224868462663>",
    "tdj_5":"<a:tdj_5:925370243348586496>","tdj_6":"<a:tdj_6:925370266345963561>",
    "tdj_7":"<a:tdj_7:925370296259719168>","tdj_8":"<a:tdj_8:925370322264391701>",
    "tdj_9":"<a:tdj_9:925370350051684393>","seta":"<a:seta:924046181879918652>",
    "nitroboo":"<a:nitroboo:964501440838107166>","hellokitty":"<:HelloKitty:942496467539603466>",
}

def _parse_emoji(raw):
    if not raw: return None
    m = re.match(r"<(a?):([^:]+):(\d+)>", raw)
    if not m: return raw if raw.strip() else None
    try: return discord.PartialEmoji(name=m.group(2), id=int(m.group(3)), animated=m.group(1)=="a")
    except Exception: return raw

def E(key): return _parse_emoji(EMOJI.get(key,""))

# ===================== CONFIG =====================
DEFAULT_CONFIG = {
    "brand_name":"𝚙𝚡𝚔","brand_emoji":"🖤","brand_footer":"🖤 𝚙𝚡𝚔 • Sistema Oficial",
    "brand_color_primary":0x8A2BE2,"brand_color_secondary":0x9B30FF,
    "brand_color_success":0x00FF88,"brand_color_danger":0xFF3366,
    "avatar_url":"","_last_avatar_url":"",
    "banner_painel_url":"","banner_ticket_url":"","banner_welcome_url":"",
    "guild_id":None,
    "panel_color_main":0x8A2BE2,"panel_color_ticket":0x8A2BE2,
    "panel_color_verification":0x9B30FF,"panel_color_feedback":0x8A2BE2,
    "panel_color_suggestions":0x8A2BE2,"panel_color_levels":0xFFD700,
    "panel_color_staff":0xFF3366,"panel_color_vip":0xFFD700,
    "auto_emoji_channels":True,
    "verification_enabled":True,"verification_method":"math","verification_difficulty":1,
    "verification_kick_minutes":0,"verification_timeout_delete_minutes":5,
    "verified_role_ids":[],"verification_unverified_role_ids":[],
    "verification_channel_id":None,"verification_panel_channel_id":None,
    "verification_panel_message_id":None,"verification_log_channel_id":None,
    "verification_temp_category_id":None,"verification_temp_delete_seconds":5,
    "welcome_channel_id":None,"welcome_message":"Seja muito bem-vindo(a) ao servidor! 💜",
    "welcome_image_url":"","leave_channel_id":None,
    "leave_message":"Sentiremos sua falta. Volte quando quiser! 💜",
    "auto_role_id":None,
    "welcome_mention_channel_id":None,
    "welcome_mention_message":"Bem-vindo(a) {user}! 🎉",
    "welcome_mention_delete_seconds":5,
    "voice_join_log_channel_id":None,"voice_leave_log_channel_id":None,
    "voice_channel_id":None,"voice_mute":True,"bot_status":"online",
    "activity_rotate_enabled":False,"activity_rotate_seconds":30,
    "activity_type":"watching","activity_messages":[],
    "admin_role_ids":[],"addcargo_allowed_role_ids":[],
    "addcargo_panel_channel_id":None,"addcargo_panel_message_id":None,
    "painel_channel_id":None,"painel_message_id":None,
    "ticket_category_movcall_id":None,"ticket_category_movchat_id":None,
    "ticket_category_recrute_id":None,"ticket_category_support_id":None,
    "ticket_category_others_id":None,
    "ticket_logs_channel_id":None,"ticket_panel_channel_id":None,
    "ticket_panel_message_id":None,"ticket_support_role_ids":[],
    "ticket_panel_title":"🎫 Central de Tickets — {brand}",
    "ticket_panel_description":"### 💬 Escolha o tipo de atendimento\nSelecione uma opção no **menu abaixo** para abrir um ticket privado.",
    "ticket_panel_select_placeholder":"🎫 Selecione o tipo de ticket...",
    "ticket_label_movcall":"MOV CALL","ticket_emoji_movcall":"🎙️",
    "ticket_label_movchat":"MOV CHAT","ticket_emoji_movchat":"💬",
    "ticket_label_recrute":"RECRUTE-S","ticket_emoji_recrute":"📢",
    "ticket_label_support":"SUPORTE","ticket_emoji_support":"🛠️",
    "ticket_label_others":"OUTROS","ticket_emoji_others":"❓",
    "feedback_channel_id":None,"feedback_panel_channel_id":None,
    "feedback_panel_message_id":None,
    "feedback_panel_title":"⭐ Avaliações & Feedback — {brand}",
    "feedback_panel_description":"### 💜 Sua opinião é muito importante!\nAvalie o servidor de **1 a 5 estrelas**.",
    "suggestions_channel_id":None,"suggestions_panel_channel_id":None,
    "suggestions_panel_message_id":None,
    "moderation_logs_channel_id":None,
    "antibot_channel_id":None,"antibot_panel_message_id":None,
    "antibot_banner_url":"","antibot_title":"• Não envie mensagem nesse canal!",
    "antibot_description":"Sistema criado para prevenir bots de divulgação.",
    "antibot_punish_ban":True,"antibot_delete_messages":True,
    "antibot_log_channel_id":None,
    "levels_enabled":True,"levels_xp_per_message":15,"levels_xp_cooldown_seconds":60,
    "levels_announce_channel_id":None,
    "levels_message_up":"🎉 {user} subiu para o **level {level}**!",
    "filters_enabled":True,"filters_punish_after_warnings":3,
    "filters_links_allowed_role_ids":[],"filters_log_channel_id":None,
    "filters_blocked_words":[],"filters_allowed_domains":[],
    "vip_enabled":True,"vip_role_base_id":None,
    "vip_allow_custom_color":True,"vip_allow_custom_name":True,
    "vip_allow_custom_tag":True,"vip_max_members":5,
    "vip_panel_channel_id":None,
    "staff_role_ids":[],"staff_movchat_role_ids":[],
    "staff_movchat_goal":1000,"staff_call_goal_hours":30,
    "staff_report_channel_id":None,"staff_punish_channel_id":None,
    "staff_warn_ban_threshold":3,
}

def load_config():
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    data = {}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE,"r",encoding="utf-8") as f: data=json.load(f)
        except Exception: data={}
    for k,v in DEFAULT_CONFIG.items(): data.setdefault(k,v)
    save_config(data); return data

def save_config(data):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE,"w",encoding="utf-8") as f: json.dump(data,f,indent=4,ensure_ascii=False)

config = load_config()

_cfg_mtime = os.path.getmtime(CONFIG_FILE) if os.path.exists(CONFIG_FILE) else 0

@tasks.loop(seconds=5)
async def task_reload_config():
    global _cfg_mtime
    try: m = os.path.getmtime(CONFIG_FILE)
    except OSError: return
    if m == _cfg_mtime: return
    _cfg_mtime = m
    try:
        with open(CONFIG_FILE,"r",encoding="utf-8") as f: data=json.load(f)
    except Exception: return
    for k,v in DEFAULT_CONFIG.items(): data.setdefault(k,v)
    config.clear(); config.update(data)
    try:
        await update_status(force=True); await update_voice_name_impl()
    except Exception: pass

# ===================== HELPERS =====================
def bname(): return config.get("brand_name") or "Bot"
def bemoji(): return config.get("brand_emoji") or "🖤"
def bfooter(): return config.get("brand_footer") or "Sistema Oficial"
def c_primary(): return config.get("brand_color_primary",0x8A2BE2)
def c_secondary(): return config.get("brand_color_secondary",0x9B30FF)
def c_success(): return config.get("brand_color_success",0x00FF88)
def c_danger(): return config.get("brand_color_danger",0xFF3366)
def c_panel(key, fallback=0x8A2BE2): return config.get(f"panel_color_{key}") or fallback
def avatar_url(): return config.get("avatar_url") or None
def banner_painel(): return config.get("banner_painel_url") or None
def banner_ticket(): return config.get("banner_ticket_url") or None
def banner_welcome(): return config.get("welcome_image_url") or config.get("banner_welcome_url") or None

def _fmt_text(t):
    if not t: return ""
    g = get_guild(); m = g.member_count if g else 0
    return str(t).replace("{brand}",bname()).replace("{emoji}",bemoji()).replace("{members}",str(m))

def _fmt_ts(dt=None, style="f"):
    return f"<t:{int((dt or datetime.datetime.now()).timestamp())}:{style}>"

async def _delete_message_after(message, delay):
    try:
        await asyncio.sleep(max(1,int(delay))); await message.delete()
    except Exception: pass

async def send_log_card(channel, title, *, subtitle=None, user=None, fields=None,
                        thumbnail_url=None, accent=None, extra=None, compact=False):
    if not channel: return False
    comps = [ui.TextDisplay(f"## {title}")]
    thumb = thumbnail_url
    if user and not thumb:
        try: thumb = user.display_avatar.with_size(256).url
        except Exception: thumb = None
    if user:
        try: header = f"### {user.display_name}\n-# {user.mention}"
        except Exception: header = f"### {getattr(user,'name','Usuário')}"
        comps.append(ui.Section(ui.TextDisplay(header), accessory=ui.Thumbnail(media=thumb or _thumb())))
    elif subtitle and thumb:
        comps.append(ui.Section(ui.TextDisplay(f"### {subtitle}"), accessory=ui.Thumbnail(media=thumb)))
    elif subtitle:
        comps.append(ui.TextDisplay(f"### {subtitle}"))
    if fields:
        comps.append(ui.Separator(spacing=discord.SeparatorSpacing.small))
        for item in fields:
            if isinstance(item, tuple) and len(item)==2:
                comps.append(ui.TextDisplay(f"**{item[0]}**\n> {item[1]}"))
            else: comps.append(ui.TextDisplay(str(item)))
    if extra:
        comps.append(ui.Separator(spacing=discord.SeparatorSpacing.small))
        comps.append(ui.TextDisplay(extra))
    if not compact: comps.append(ui.Separator(spacing=discord.SeparatorSpacing.small))
    comps.append(ui.TextDisplay(f"-# {bfooter()} • {_fmt_ts()}"))
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=accent or c_primary()))
    try: await channel.send(view=layout); return True
    except Exception as e: logger.error(f"log card '{title}': {e}"); return False

async def log_admin_action(interaction, action, detail=""):
    if not interaction.guild: return
    try: log_moderation(action, interaction.user.id, 0, detail[:500])
    except Exception: pass
    cid = config.get("moderation_logs_channel_id")
    if not cid: return
    ch = interaction.guild.get_channel(cid)
    if not ch: return
    fields = [("🛠️ Ação", f"`{action}`")]
    if interaction.channel: fields.append(("📍 Canal", interaction.channel.mention))
    if detail: fields.append(("📄 Detalhes", f"`{detail[:300]}`"))
    await send_log_card(ch, "🛡️ Ação Administrativa", user=interaction.user, fields=fields)

# ===================== BOT =====================
intents = discord.Intents.default()
intents.members = True; intents.voice_states = True
intents.message_content = True; intents.guilds = True; intents.messages = True
bot = commands.Bot(command_prefix="!", intents=intents)

def get_guild():
    gid = config.get("guild_id"); return bot.get_guild(gid) if gid else None

def get_voice_channel():
    g = get_guild()
    if g:
        cid = config.get("voice_channel_id"); return g.get_channel(cid) if cid else None
    return None

def sanitize_channel_name(name):
    name = name.strip().lower()
    name = re.sub(r"\s+","-",name)
    name = re.sub(r"[^a-z0-9\-_áàâãäéèêëíìîïóòôõöúùûüçñ]","",name)
    return (re.sub(r"-+","-",name).strip("-") or "ticket")[:100]

async def update_voice_name_impl():
    g = get_guild()
    if not g: return
    ch = get_voice_channel()
    if not ch or not isinstance(ch, discord.VoiceChannel): return
    new = f"👥・{g.member_count} membros"
    if ch.name != new:
        try: await ch.edit(name=new)
        except Exception: pass

_last_activity_time = 0.0; _activity_index = 0; _last_activity_signature = None
_ACTIVITY_TYPES = {"watching":discord.ActivityType.watching,"playing":discord.ActivityType.playing,
                   "listening":discord.ActivityType.listening,"competing":discord.ActivityType.competing}

def _current_activity_text():
    global _last_activity_time, _activity_index
    g = get_guild()
    if config.get("activity_rotate_enabled"):
        msgs = [m for m in (config.get("activity_messages") or []) if str(m).strip()]
        if msgs:
            now = time.time(); interval = max(10, int(config.get("activity_rotate_seconds",30)))
            if _last_activity_time==0: _last_activity_time = now
            if now - _last_activity_time >= interval:
                _last_activity_time = now; _activity_index = (_activity_index+1) % len(msgs)
            if _activity_index >= len(msgs): _activity_index = 0
            return _fmt_text(msgs[_activity_index])
    if g: return f"{bemoji()} {g.member_count} membros em {bname()}"
    return f"{bemoji()} {bname()}"

async def update_status(force=False):
    global _last_activity_signature
    status_map = {"online":discord.Status.online,"idle":discord.Status.idle,
                  "dnd":discord.Status.dnd,"invisible":discord.Status.invisible}
    status = status_map.get(config.get("bot_status","online"),discord.Status.online)
    text = _current_activity_text()
    atype = _ACTIVITY_TYPES.get(config.get("activity_type","watching"),discord.ActivityType.watching)
    sig = (status.value, atype.value, text)
    if not force and sig == _last_activity_signature: return
    _last_activity_signature = sig
    try: await bot.change_presence(status=status, activity=discord.Activity(type=atype, name=text))
    except Exception: pass

async def update_voice_mute():
    g = get_guild()
    if not g: return
    vc = g.voice_client
    if not vc or not vc.is_connected(): return
    try: await g.me.edit(mute=config.get("voice_mute",True))
    except Exception: pass

def text_channel_options():
    g = get_guild(); opts = []
    if g:
        for c in g.text_channels:
            try:
                if c.permissions_for(g.me).send_messages:
                    opts.append(discord.SelectOption(label=f"#{c.name}"[:100], value=str(c.id)))
            except Exception: continue
    return opts[:25] or [discord.SelectOption(label="Nenhum canal", value="none")]

def voice_channel_options():
    g = get_guild(); opts = []
    if g:
        for c in g.voice_channels:
            opts.append(discord.SelectOption(label=c.name[:100], value=str(c.id)))
    return opts[:25] or [discord.SelectOption(label="Nenhum canal de voz", value="none")]

def category_options():
    g = get_guild(); opts = []
    if g:
        for c in g.categories: opts.append(discord.SelectOption(label=c.name[:100], value=str(c.id)))
    return opts[:25] or [discord.SelectOption(label="Nenhuma categoria", value="none")]

# ===================== UI HELPERS =====================
P = discord.ButtonStyle.primary; S = discord.ButtonStyle.secondary
SU = discord.ButtonStyle.success; D = discord.ButtonStyle.danger

def _btn(label, cid, style=P, emoji=None):
    if isinstance(emoji,str) and emoji.startswith("<"): emoji = _parse_emoji(emoji)
    return ui.Button(label=label, style=style, custom_id=cid, emoji=emoji)

def _thumb(): return avatar_url() or "https://cdn.discordapp.com/embed/avatars/0.png"

def _safe_media_gallery(url):
    if not url: return None
    MG = getattr(ui,"MediaGallery",None) or getattr(discord,"MediaGallery",None)
    MGI = getattr(ui,"MediaGalleryItem",None) or getattr(discord,"MediaGalleryItem",None)
    if not MG or not MGI: return None
    try: return MG(MGI(media=url))
    except Exception: return None

def _safe_select(placeholder, options, custom_id=None, min_values=1, max_values=1):
    if not options: options = [discord.SelectOption(label="Nenhuma opção", value="none")]
    options = options[:25]; n = len(options)
    safe_max = max(1, min(max_values, n)); safe_min = max(0, min(min_values, safe_max))
    kwargs = dict(placeholder=placeholder, options=options, min_values=safe_min, max_values=safe_max)
    if custom_id: kwargs["custom_id"] = custom_id
    return ui.Select(**kwargs)

def premium_submenu(title, description, sections, accent=None):
    layout = ui.LayoutView(timeout=300)
    comps = [ui.TextDisplay(f"# {title}"),
             ui.Section(ui.TextDisplay(description), accessory=ui.Thumbnail(media=_thumb()))]
    for sec in sections:
        comps.append(ui.Separator(spacing=discord.SeparatorSpacing.small))
        comps.append(ui.TextDisplay(f"### {sec['title']}"))
        for row in sec["rows"]: comps.append(ui.ActionRow(*row))
    comps.append(ui.Separator(spacing=discord.SeparatorSpacing.large))
    comps.append(ui.ActionRow(_btn("Voltar ao Menu","back_main",D,E("seta"))))
    layout.add_item(ui.Container(*comps, accent_color=accent or c_primary()))
    return layout

# ===================== CARGO AUTO / WELCOME =====================
def _build_welcome_card(member, action="join"):
    now = int(datetime.datetime.now().timestamp())
    avatar = member.display_avatar.with_size(256).url
    if action == "join":
        header = "✨ Novo Membro"; lead = "acabou de entrar no servidor"
        msg = config.get("welcome_message") or "Seja bem-vindo(a)!"
        info = [f"👤 {member.mention}",
                f"👥 Você é o membro **nº {member.guild.member_count}**",
                f"📅 Conta criada <t:{int(member.created_at.timestamp())}:R>"]
    else:
        header = "🔒 Até Logo"; lead = "acabou de sair do servidor"
        msg = config.get("leave_message") or "Sentiremos sua falta."
        info = [f"👤 {member.mention}"]
        if member.joined_at:
            delta = datetime.datetime.now(datetime.timezone.utc) - member.joined_at
            info.append(f"📥 Entrou <t:{int(member.joined_at.timestamp())}:R>")
            info.append(f"⏳ Ficou **{delta.days}** dia(s)")
        info.append(f"👥 Restam **{member.guild.member_count}** membros")
    comps = [ui.TextDisplay(f"## {header}"),
             ui.Section(ui.TextDisplay(f"### {member.display_name}\n-# {lead}"),
                        accessory=ui.Thumbnail(media=avatar)),
             ui.Separator(spacing=discord.SeparatorSpacing.small),
             ui.TextDisplay(f"> {msg}"),
             ui.Separator(spacing=discord.SeparatorSpacing.small),
             ui.TextDisplay("\n".join(info)),
             ui.TextDisplay(f"-# {bfooter()} • <t:{now}:f>")]
    if action == "join":
        b = banner_welcome()
        if b:
            mg = _safe_media_gallery(b)
            if mg is not None: comps.insert(2, mg)
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=c_primary()))
    return layout

async def send_welcome_message(member):
    cid = config.get("welcome_channel_id")
    if not cid: return
    ch = member.guild.get_channel(cid)
    if ch:
        try: await ch.send(view=_build_welcome_card(member,"join"))
        except Exception as e: logger.error(f"welcome: {e}")

async def send_leave_message(member):
    cid = config.get("leave_channel_id")
    if not cid: return
    ch = member.guild.get_channel(cid)
    if ch:
        try: await ch.send(view=_build_welcome_card(member,"leave"))
        except Exception as e: logger.error(f"leave: {e}")

async def send_voice_log(member, channel, action):
    if action == "join":
        cid = config.get("voice_join_log_channel_id"); title = "🔊 Entrou na Call"; accent = c_success()
    else:
        cid = config.get("voice_leave_log_channel_id"); title = "🔇 Saiu da Call"; accent = c_danger()
    if not cid: return
    ch = member.guild.get_channel(cid)
    if not ch: return
    fields = [("🎧 Canal", channel.mention)]
    try: current = len([m for m in channel.members if not m.bot])
    except Exception: current = len(channel.members)
    if action == "join":
        fields += [("👥 Membros na Call", f"**{current}**"),("🕐 Entrou às", _fmt_ts(style="T"))]
    else:
        fields += [("👥 Restam na Call", f"**{current}**"),("🕐 Saiu às", _fmt_ts(style="T"))]
    await send_log_card(ch, title, user=member, fields=fields, accent=accent)

async def _delete_all_user_messages(guild, user_id, limit_per_channel=300):
    deleted = 0
    for channel in guild.text_channels:
        try:
            perms = channel.permissions_for(guild.me)
            if not (perms.manage_messages and perms.read_message_history): continue
            async for msg in channel.history(limit=limit_per_channel):
                if msg.author.id == user_id:
                    try: await msg.delete(); deleted += 1; await asyncio.sleep(0.35)
                    except discord.NotFound: continue
                    except discord.HTTPException: await asyncio.sleep(1.5)
        except Exception: continue
    return deleted

# ===================== TICKETS (5 tipos) =====================
TICKET_TYPES = {
    "movcall":{"label_key":"ticket_label_movcall","emoji_key":"ticket_emoji_movcall","cat_key":"ticket_category_movcall_id"},
    "movchat":{"label_key":"ticket_label_movchat","emoji_key":"ticket_emoji_movchat","cat_key":"ticket_category_movchat_id"},
    "recrute":{"label_key":"ticket_label_recrute","emoji_key":"ticket_emoji_recrute","cat_key":"ticket_category_recrute_id"},
    "support":{"label_key":"ticket_label_support","emoji_key":"ticket_emoji_support","cat_key":"ticket_category_support_id"},
    "others":{"label_key":"ticket_label_others","emoji_key":"ticket_emoji_others","cat_key":"ticket_category_others_id"},
}

def ticket_panel_layout():
    title = _fmt_text(config.get("ticket_panel_title") or "🎫 Central de Tickets — {brand}")
    desc = _fmt_text(config.get("ticket_panel_description") or "")
    ph = _fmt_text(config.get("ticket_panel_select_placeholder") or "🎫 Selecione o tipo...")
    if not title.startswith("#"): title = f"# {title}"
    comps = [ui.TextDisplay(title),
             ui.Section(ui.TextDisplay(desc or "-# Configure no painel admin."),
                        accessory=ui.Thumbnail(media=_thumb())),
             ui.Separator(spacing=discord.SeparatorSpacing.small)]
    b = banner_ticket()
    if b:
        mg = _safe_media_gallery(b)
        if mg is not None: comps.append(mg)
    opts = []
    for key, meta in TICKET_TYPES.items():
        opts.append(discord.SelectOption(
            label=(config.get(meta["label_key"]) or key)[:100],
            value=key, emoji=config.get(meta["emoji_key"]) or "🎫"))
    sel = _safe_select(ph, opts, custom_id="ticket_panel_select", min_values=1, max_values=1)
    async def on_ticket_select(interaction):
        val = sel.values[0]
        await handle_ticket_open(interaction, val)
    sel.callback = on_ticket_select
    comps.append(ui.ActionRow(sel))
    comps.append(ui.TextDisplay(f"-# {bfooter()}"))
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=c_panel("ticket", c_primary())))
    return layout

def ticket_actions_layout():
    comps = [ui.TextDisplay("### 🔧 Ações do Ticket"),
             ui.TextDisplay("-# Use os botões abaixo para gerenciar."),
             ui.Separator(spacing=discord.SeparatorSpacing.small),
             ui.ActionRow(_btn("Fechar Ticket","close_ticket",D,E("seta")),
                          _btn("Adicionar Membro","add_member",S,E("tdj_1")),
                          _btn("Editar Nome","edit_ticket_name",P,E("tdj_2")))]
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=c_panel("ticket", c_primary())))
    return layout

async def handle_ticket_open(interaction, tipo):
    try: count = count_user_tickets_last_hours(interaction.user.id, 8)
    except Exception: count = 0
    if count >= 3:
        await interaction.response.send_message("❌ Limite de 3 tickets em 8h.", ephemeral=True); return
    guild = interaction.guild
    meta = TICKET_TYPES.get(tipo)
    if not meta:
        await interaction.response.send_message("❌ Tipo inválido.", ephemeral=True); return
    cid = config.get(meta["cat_key"])
    if not cid:
        await interaction.response.send_message("❌ Categoria não configurada.", ephemeral=True); return
    category = guild.get_channel(cid)
    if not category or not isinstance(category, discord.CategoryChannel):
        await interaction.response.send_message("❌ Categoria inválida.", ephemeral=True); return
    overwrites = {guild.default_role: discord.PermissionOverwrite(view_channel=False),
                  interaction.user: discord.PermissionOverwrite(view_channel=True, send_messages=True,
                                                                  read_message_history=True, attach_files=True)}
    mentions = []
    for rid in config.get("ticket_support_role_ids", []):
        role = guild.get_role(rid)
        if role:
            overwrites[role] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True)
            mentions.append(role.mention)
    nome = f"ticket-{tipo}-{interaction.user.name[:20]}".lower().replace(" ","-")
    try:
        channel = await guild.create_text_channel(name=nome, category=category, overwrites=overwrites,
                                                   reason=f"Ticket {tipo} por {interaction.user}")
    except Exception as e:
        await interaction.response.send_message(f"❌ Erro: {e}", ephemeral=True); return
    try: add_open_ticket(interaction.user.id, channel.id)
    except Exception: pass
    welcome_comps = [ui.TextDisplay(f"# {bemoji()} Ticket {tipo.upper()} — {bname()}"),
                     ui.Section(ui.TextDisplay(
                         f"**Olá {interaction.user.mention}!** Bem-vindo(a) ao atendimento. 💜\n\n"
                         "Descreva seu pedido abaixo e nossa equipe responderá."),
                         accessory=ui.Thumbnail(media=interaction.user.display_avatar.url))]
    b = banner_ticket()
    if b:
        mg = _safe_media_gallery(b)
        if mg is not None: welcome_comps.append(mg)
    wl = ui.LayoutView(timeout=None)
    wl.add_item(ui.Container(*welcome_comps, accent_color=c_panel("ticket", c_primary())))
    await channel.send(view=wl)
    if mentions:
        await channel.send(view=ui.LayoutView(
            ui.Container(ui.TextDisplay(f"📢 {', '.join(mentions)} — novo ticket de {interaction.user.mention}."))))
    await channel.send(view=ticket_actions_layout())
    log_id = config.get("ticket_logs_channel_id")
    if log_id:
        log_ch = guild.get_channel(log_id)
        if log_ch:
            await send_log_card(log_ch, "🎫 Novo Ticket Aberto", user=interaction.user,
                                fields=[("📁 Tipo", f"`{tipo}`"),("📍 Canal", channel.mention),
                                        ("📂 Categoria", category.name if category else "—"),
                                        ("🕐 Aberto em", _fmt_ts(style="f"))])
    await interaction.response.send_message(f"✅ Ticket criado em {channel.mention}!", ephemeral=True)

# ===================== VERIFICAÇÃO =====================
_pending_kicks = {}; _math_answers = {}; _button_verification_target = {}
_temp_verification_channels = {}; _verification_timeouts = {}

def _schedule_verification_timeout(guild, member):
    minutes = config.get("verification_timeout_delete_minutes",5)
    if minutes <= 0: return
    key = (guild.id, member.id)
    if key in _verification_timeouts: _verification_timeouts[key].cancel()
    async def _timeout():
        try:
            await asyncio.sleep(minutes*60)
            if member.id not in _temp_verification_channels: return
            await _delete_temp_channel(guild, member.id, delay=0)
        except asyncio.CancelledError: pass
        finally: _verification_timeouts.pop(key, None)
    _verification_timeouts[key] = asyncio.create_task(_timeout())

def cancel_verification_timeout(guild_id, user_id):
    t = _verification_timeouts.pop((guild_id, user_id), None)
    if t: t.cancel()

def schedule_verification_kick(guild, member):
    minutes = config.get("verification_kick_minutes",0)
    if minutes <= 0: return
    key = (guild.id, member.id)
    if key in _pending_kicks: _pending_kicks[key].cancel()
    async def _kick():
        try:
            await asyncio.sleep(minutes*60)
            m = guild.get_member(member.id)
            if not m: return
            unver = config.get("verification_unverified_role_ids",[])
            if any(r.id in unver for r in m.roles):
                try:
                    await guild.kick(m, reason="Não completou verificação a tempo")
                    await _delete_temp_channel(guild, member.id)
                except Exception as e: logger.error(f"kick: {e}")
        except asyncio.CancelledError: pass
        finally: _pending_kicks.pop(key, None)
    _pending_kicks[key] = asyncio.create_task(_kick())

def cancel_verification_kick(guild_id, user_id):
    t = _pending_kicks.pop((guild_id, user_id), None)
    if t: t.cancel()

def _generate_math_challenge():
    diff = config.get("verification_difficulty",1)
    if diff == 1:
        a, b = random.randint(1,10), random.randint(1,10); return f"{a} + {b}", a+b
    elif diff == 2:
        if random.random()<0.5:
            a, b = random.randint(10,50), random.randint(10,50); return f"{a} + {b}", a+b
        a, b = random.randint(2,12), random.randint(2,12); return f"{a} × {b}", a*b
    else:
        if random.random()<0.5:
            a, b = random.randint(100,500), random.randint(100,500); return f"{a} + {b}", a+b
        a, b = random.randint(2,15), random.randint(2,15); return f"{a} × {b}", a*b

async def _create_temp_verification_channel(guild, member):
    cat_id = config.get("verification_temp_category_id")
    category = guild.get_channel(cat_id) if cat_id else None
    if category and not isinstance(category, discord.CategoryChannel): category = None
    overwrites = {guild.default_role: discord.PermissionOverwrite(view_channel=False),
                  member: discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True),
                  guild.me: discord.PermissionOverwrite(view_channel=True, send_messages=True, manage_channels=True, manage_messages=True)}
    try:
        ch = await guild.create_text_channel(name=f"verificar-{member.name}"[:100], category=category,
                                               overwrites=overwrites,
                                               reason=f"Canal temp verificação {member}")
        _temp_verification_channels[member.id] = ch.id
        return ch
    except Exception as e: logger.error(f"temp ch: {e}"); return None

async def _delete_temp_channel(guild, user_id, delay=None):
    cid = _temp_verification_channels.pop(user_id, None)
    if not cid: return
    if delay: await asyncio.sleep(delay)
    ch = guild.get_channel(cid)
    if ch:
        try: await ch.delete(reason="Verificação — canal temporário")
        except Exception as e: logger.debug(f"del temp: {e}")

async def _log_verification(guild, member, success, extra=""):
    cid = config.get("verification_log_channel_id")
    if not cid: return
    ch = guild.get_channel(cid)
    if not ch: return
    title = "✅ Verificação Concluída" if success else "❌ Verificação Falhou"
    accent = c_success() if success else c_danger()
    method = "🧮 Matemática" if config.get("verification_method","math")=="math" else "🔘 Botão"
    fields = [("📊 Resultado", "🟢 Sucesso" if success else "🔴 Falhou"),("🔀 Método", method)]
    if extra: fields.append(("📄 Detalhes", f"`{extra}`"))
    await send_log_card(ch, title, user=member, fields=fields, accent=accent)

async def send_captcha_challenge(member, channel):
    method = config.get("verification_method","math")
    if method == "button":
        comps = [ui.TextDisplay(f"# ✅ Verificação — {bname()}"),
                 ui.Section(ui.TextDisplay(f"Olá {member.mention}! Clique abaixo para se verificar."),
                            accessory=ui.Thumbnail(media=member.display_avatar.url)),
                 ui.Separator(spacing=discord.SeparatorSpacing.small),
                 ui.ActionRow(_btn("Verificar Agora","captcha_button_verify",SU,E("verificado")))]
        layout = ui.LayoutView(timeout=None)
        layout.add_item(ui.Container(*comps, accent_color=c_panel("verification", c_secondary())))
        _button_verification_target[member.id] = True
        try: await channel.send(view=layout)
        except Exception as e: logger.error(f"btn verify: {e}")
        return
    question, answer = _generate_math_challenge()
    _math_answers[member.id] = answer
    comps = [ui.TextDisplay(f"# 🧮 Verificação — {bname()}"),
             ui.Section(ui.TextDisplay(f"Olá {member.mention}!\n\nResolva:\n\n# `{question}`"),
                        accessory=ui.Thumbnail(media=member.display_avatar.url)),
             ui.Separator(spacing=discord.SeparatorSpacing.small),
             ui.ActionRow(_btn("Resolver","captcha_solve",SU,E("tdj_1")))]
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=c_panel("verification", c_secondary())))
    try: await channel.send(view=layout)
    except Exception as e: logger.error(f"math verify: {e}")

async def _grant_verification(guild, member):
    for rid in config.get("verified_role_ids",[]):
        r = guild.get_role(rid)
        if r and r not in member.roles:
            try: await member.add_roles(r)
            except Exception: pass
    for rid in config.get("verification_unverified_role_ids",[]):
        r = guild.get_role(rid)
        if r and r in member.roles:
            try: await member.remove_roles(r)
            except Exception: pass
    cancel_verification_kick(guild.id, member.id); cancel_verification_timeout(guild.id, member.id)
    _math_answers.pop(member.id, None); _button_verification_target.pop(member.id, None)
    await _log_verification(guild, member, True, "verificado")
    delay = max(1, int(config.get("verification_temp_delete_seconds",5)))
    asyncio.create_task(_delete_temp_channel(guild, member.id, delay=delay))

async def handle_captcha_start(interaction):
    if not config.get("verification_enabled", True):
        await interaction.response.send_message("❌ Verificação temporariamente desativada.", ephemeral=True); return
    member = interaction.user; guild = interaction.guild
    existing = guild.get_channel(_temp_verification_channels.get(member.id)) if member.id in _temp_verification_channels else None
    if not existing:
        existing = await _create_temp_verification_channel(guild, member)
        if existing: _schedule_verification_timeout(guild, member)
    if not existing:
        await interaction.response.send_message("❌ Não consegui criar canal temp.", ephemeral=True); return
    await send_captcha_challenge(member, existing)
    await interaction.response.send_message(f"✅ Canal criado: {existing.mention}\n-# Será apagado após verificação ou timeout.", ephemeral=True)

async def handle_button_verify(interaction):
    member = interaction.user
    await _grant_verification(interaction.guild, member)
    await interaction.response.send_message("✅ **Verificado!** 🖤", ephemeral=True)

def verification_panel_layout():
    comps = [ui.TextDisplay(f"# {E('verificado')} Verificação — {bname()}"),
             ui.Section(ui.TextDisplay(
                 "### 🔐 Sistema de Verificação\n"
                 f"Olá! Para ter acesso completo ao **{bname()}**, você precisa se verificar.\n\n"
                 "**Como funciona:**\n> • Clique em **✅ Verificar Agora**\n> • Um **canal temporário** será criado\n"
                 "> • Resolva o desafio e receba os cargos\n> • O canal se apaga automaticamente 🖤"),
                        accessory=ui.Thumbnail(media=_thumb())),
             ui.Separator(spacing=discord.SeparatorSpacing.small)]
    b = banner_welcome() or banner_painel()
    if b:
        mg = _safe_media_gallery(b)
        if mg is not None: comps.append(mg)
    if config.get("verification_enabled", True):
        comps.append(ui.ActionRow(_btn("Verificar Agora","verify_now",SU,E("verificado"))))
    else:
        comps.append(ui.ActionRow(ui.Button(label="Verificação Desativada", style=S,
                                             custom_id="verify_disabled", disabled=True)))
    comps.append(ui.TextDisplay(f"-# {bfooter()}"))
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=c_panel("verification", c_secondary())))
    return layout

class CaptchaModal(ui.Modal, title="🧮 Verificação"):
    def __init__(self, guild_id, user_id):
        super().__init__()
        self.guild_id = guild_id; self.user_id = user_id
        self.resposta = ui.TextInput(label="Resposta", required=True, max_length=10)
        self.add_item(self.resposta)
    @classmethod
    def from_button(cls, interaction): return cls(guild_id=interaction.guild.id, user_id=interaction.user.id)
    async def on_submit(self, interaction):
        guild = bot.get_guild(self.guild_id)
        if not guild:
            await interaction.response.send_message("❌ Servidor não encontrado.", ephemeral=True); return
        member = guild.get_member(self.user_id) or interaction.user
        expected = _math_answers.get(self.user_id)
        if expected is None:
            await _grant_verification(guild, member)
            await interaction.response.send_message("✅ Verificado!", ephemeral=True); return
        try: val = int(self.resposta.value.strip())
        except ValueError:
            await interaction.response.send_message("❌ Digite apenas números.", ephemeral=True); return
        if val == expected:
            await _grant_verification(guild, member)
            await interaction.response.send_message("✅ **Verificado com sucesso!** 🖤", ephemeral=True)
        else:
            await _log_verification(guild, member, False, "errou o desafio")
            await interaction.response.send_message("❌ Resposta incorreta. Tente novamente.", ephemeral=True)
            cid = _temp_verification_channels.get(member.id)
            ch = guild.get_channel(cid) if cid else None
            if ch: await send_captcha_challenge(member, ch)

# ===================== NÍVEIS (MEE6) =====================
_level_cooldowns = {}

def _calc_level_for_xp(xp):
    lvl = 0; needed = 100; total = 0
    while total + needed <= xp:
        total += needed; lvl += 1; needed = int(needed * 1.5)
    return lvl

def _calc_xp_for_next_level(level):
    needed = 100
    for _ in range(level): needed = int(needed * 1.5)
    return needed

async def _process_levels(message):
    if not config.get("levels_enabled", True): return
    if message.author.bot or not message.guild: return
    gid = message.guild.id; uid = message.author.id
    now = time.time(); cd = max(1, int(config.get("levels_xp_cooldown_seconds", 60)))
    if now - _level_cooldowns.get((gid, uid), 0) < cd: return
    _level_cooldowns[(gid, uid)] = now
    xp_add = max(1, int(config.get("levels_xp_per_message", 15)))
    try: add_user_xp(uid, gid, xp_add)
    except Exception: return
    try:
        data = get_user_level(uid, gid)
        if not data: return
        new_lvl = _calc_level_for_xp(data["xp"])
        if new_lvl > data["level"]:
            set_user_level(uid, gid, new_lvl)
            rewards = get_level_rewards(gid)
            for lvl, rid in rewards.items():
                if int(lvl) <= new_lvl:
                    r = message.guild.get_role(rid)
                    if r and r not in message.author.roles:
                        try: await message.author.add_roles(r, reason=f"Level {lvl}")
                        except Exception: pass
            cid = config.get("levels_announce_channel_id")
            if cid:
                ch = message.guild.get_channel(cid)
                if ch:
                    msg = (config.get("levels_message_up") or "🎉 {user} subiu para o **level {level}**!")
                    msg = msg.replace("{user}", message.author.mention).replace("{level}", str(new_lvl)).replace("{xp}", str(data["xp"]))
                    await send_log_card(ch, "🏆 Level Up!",
                        user=message.author,
                        fields=[("⭐ Novo Nível", f"**{new_lvl}**"),
                                ("💎 XP Total", f"`{data['xp']}`"),
                                ("🎯 Próximo Nível", f"`{_calc_xp_for_next_level(new_lvl) - (data['xp'])}` XP restantes")],
                        accent=c_panel("levels", 0xFFD700),
                        extra=msg)
    except Exception as e: logger.debug(f"level: {e}")

# ===================== FILTROS =====================
_URL_RE = re.compile(r'https?://([^\s/]+)', re.IGNORECASE)

async def _process_filters(message):
    if not config.get("filters_enabled", True): return False
    if not message.guild or message.author.bot: return False
    if message.author.guild_permissions.administrator: return False
    content = message.content.lower()

    blocked = [w.lower() for w in config.get("filters_blocked_words") or [] if w.strip()]
    matched_word = next((w for w in blocked if w in content), None)

    matched_domain = None
    if not matched_word:
        allowed_roles = set(config.get("filters_links_allowed_role_ids") or [])
        has_role = any(r.id in allowed_roles for r in message.author.roles)
        if not has_role:
            allowed_domains = [d.lower() for d in config.get("filters_allowed_domains") or [] if d.strip()]
            for m in _URL_RE.findall(message.content):
                dom = m.lower()
                if not any(dom == d or dom.endswith("." + d) for d in allowed_domains):
                    matched_domain = dom; break

    if not matched_word and not matched_domain: return False

    try: await message.delete()
    except Exception: pass

    reason = f"palavra bloqueada: `{matched_word}`" if matched_word else f"link bloqueado: `{matched_domain}`"
    try: add_user_warning(message.author.id, message.guild.id, reason, 0)
    except Exception: pass

    count = 0
    try: count = count_user_warnings(message.author.id, message.guild.id, days=30)
    except Exception: pass

    warn_threshold = int(config.get("filters_punish_after_warnings", 3) or 0)

    try:
        embed = discord.Embed(
            title=f"⚠️ Aviso — {bname()}",
            description=f"Você recebeu um aviso em **{message.guild.name}**.",
            color=c_danger(), timestamp=datetime.datetime.now())
        embed.add_field(name="Motivo", value=reason, inline=False)
        embed.add_field(name="Avisos (30d)", value=f"**{count}**", inline=True)
        if warn_threshold > 0:
            embed.add_field(name="Limite", value=f"{warn_threshold}", inline=True)
        embed.set_footer(text=bfooter())
        await message.author.send(embed=embed)
    except Exception: pass

    log_id = config.get("filters_log_channel_id")
    if log_id:
        log_ch = message.guild.get_channel(log_id)
        if log_ch:
            await send_log_card(log_ch, "🛡️ Filtro Aplicado",
                user=message.author,
                fields=[("📄 Motivo", reason),("⚠️ Avisos (30d)", f"**{count}**"),
                        ("📍 Canal", message.channel.mention)],
                accent=c_danger())

    if warn_threshold > 0 and count >= warn_threshold:
        try:
            await message.author.timeout(datetime.timedelta(hours=1), reason=f"Castigo: {count} avisos por filtros")
            try: add_punishment(message.author.id, message.guild.id, "timeout",
                                f"{count} avisos por filtros",
                                (datetime.datetime.now() + datetime.timedelta(hours=1)).isoformat(),
                                0)
            except Exception: pass
            log_id = config.get("filters_log_channel_id")
            if log_id:
                log_ch = message.guild.get_channel(log_id)
                if log_ch:
                    await send_log_card(log_ch, "🔨 Castigo Aplicado",
                        user=message.author,
                        fields=[("⏱️ Duração", "**1 hora**"),("📄 Motivo", f"`{count} avisos`")],
                        accent=c_danger())
        except Exception as e: logger.debug(f"timeout: {e}")
    return True

# ===================== VIP =====================
def vip_panel_layout(user_role=None):
    role = user_role
    comps = [ui.TextDisplay(f"# 💎 Painel VIP — {bname()}"),
             ui.Section(ui.TextDisplay(
                 "### ✨ Personalize seu cargo VIP\n"
                 "Configure **cor, nome e tag** do seu cargo exclusivo e gerencie quem pode usá-lo."),
                        accessory=ui.Thumbnail(media=_thumb())),
             ui.Separator(spacing=discord.SeparatorSpacing.small)]
    if role:
        comps.append(ui.TextDisplay(
            f"### 🎨 Cargo Atual\n"
            f"> **Nome:** {role.name}\n"
            f"> **Cor:** `#{role.color.value:06X}`\n"
            f"> **Tag:** {config.get('vip_tag', '—') or '—'}"))
        comps.append(ui.ActionRow(
            _btn("Mudar Cor","vip_color",P,"🎨"),
            _btn("Mudar Nome","vip_name",P,"✏️"),
            _btn("Mudar Tag","vip_tag",P,"🏷️")))
        comps.append(ui.ActionRow(
            _btn("Dar a Membro","vip_give",SU,"➕"),
            _btn("Remover de Membro","vip_remove",D,"➖")))
    else:
        comps.append(ui.TextDisplay("-# Você precisa do cargo VIP configurado pelo servidor para usar este painel."))
    comps.append(ui.TextDisplay(f"-# {bfooter()}"))
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=c_panel("vip", 0xFFD700)))
    return layout

async def _refresh_vip_panel(guild, user_id):
    pass

async def _open_vip_panel(interaction):
    if not config.get("vip_enabled", True):
        await interaction.response.send_message("❌ Sistema VIP desativado.", ephemeral=True); return
    base_id = config.get("vip_role_base_id")
    base = interaction.guild.get_role(base_id) if base_id else None
    if not base or base not in interaction.user.roles:
        await interaction.response.send_message("❌ Você não tem o cargo VIP base.", ephemeral=True); return
    vip = get_vip_role(interaction.user.id, interaction.guild.id)
    role = interaction.guild.get_role(vip["role_id"]) if vip else None
    await interaction.response.send_message(view=vip_panel_layout(role), ephemeral=True)

# ===================== STAFF PANEL =====================
def staff_panel_layout():
    comps = [ui.TextDisplay(f"# 👮 Painel Staff — {bname()}"),
             ui.Section(ui.TextDisplay(
                 "### 🛡️ Ferramentas de moderação\n"
                 "Mutar, punir, apagar mensagens e visualizar relatórios."),
                        accessory=ui.Thumbnail(media=_thumb())),
             ui.Separator(spacing=discord.SeparatorSpacing.small),
             ui.TextDisplay("### 🔨 Moderação"),
             ui.ActionRow(_btn("Mutar Usuário","staff_mute",D,"🔇"),
                          _btn("Castigar","staff_punish",D,"⚡")),
             ui.ActionRow(_btn("Apagar Msgs de User","staff_purge",D,"🗑️"),
                          _btn("Ver Punições","staff_punishments",S,"📋")),
             ui.Separator(spacing=discord.SeparatorSpacing.small),
             ui.TextDisplay("### 📊 Relatórios"),
             ui.ActionRow(_btn("Rank Staff Geral","staff_rank_all",P,"🏆"),
                          _btn("Meu Relatório","staff_rank_me",P,"📊")),
             ui.ActionRow(_btn("Ver MovChat","staff_movchat",P,"💬"),
                          _btn("Ver Horas de Call","staff_callhours",P,"🎙️"))]
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=c_panel("staff", c_danger())))
    return layout

def staff_rank_layout(entries, title="🏆 Rank Staff"):
    lines = ["### " + title, ""]
    for i, e in enumerate(entries, 1):
        medal = ["🥇","🥈","🥉"][i-1] if i <= 3 else f"**#{i}**"
        lines.append(f"{medal} <@{e['user_id']}> — **{e.get('seconds_hours',0):.1f}h** call • **{e.get('messages',0)}** msgs")
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(
        ui.TextDisplay(lines[0]),
        ui.TextDisplay("\n".join(lines[1:]) if len(lines)>1 else "_Sem dados ainda._"),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(_btn("Voltar","back_staff",D,E("seta"))),
        accent_color=c_panel("staff", c_danger())))
    return layout

# ===================== PAINEL PRINCIPAL =====================
def painel_layout():
    layout = ui.LayoutView(timeout=None)
    header = [ui.TextDisplay(f"# {E('nitroboo')} {bname()} — Central de Controle"),
              ui.Section(ui.TextDisplay(
                  f"### {E('tdj_1')} Painel Administrativo Premium\n"
                  "Gerencie **todo o seu servidor** em um só lugar.\n"
                  f"-# {E('seta')} Selecione uma categoria abaixo."),
                  accessory=ui.Thumbnail(media=_thumb()))]
    layout.add_item(ui.Container(*header, accent_color=c_panel("main", c_primary())))
    select = _safe_select(
        placeholder="🖤 Escolha uma categoria...",
        options=[
            discord.SelectOption(label="Identidade Visual", value="identity", emoji=E("tdj_1")),
            discord.SelectOption(label="Cores dos Painéis", value="colors", emoji="🌈"),
            discord.SelectOption(label="Auto-Emoji", value="autoemoji", emoji="✨"),
            discord.SelectOption(label="Anti-Bot", value="antibot", emoji=E("tdj_2")),
            discord.SelectOption(label="Verificação Captcha", value="captcha", emoji=E("verificado")),
            discord.SelectOption(label="Boas-vindas & Saída", value="welcome", emoji=E("tdj_3")),
            discord.SelectOption(label="Logs de Voz", value="voicelogs", emoji=E("tdj_4")),
            discord.SelectOption(label="Voz & Status", value="voice", emoji=E("tdj_5")),
            discord.SelectOption(label="Cargos de Admin", value="admin", emoji=E("tdj_6")),
            discord.SelectOption(label="Cargos /addcargo", value="addcargo_cfg", emoji=E("tdj_7")),
            discord.SelectOption(label="Painel Fixo", value="painel_fixo", emoji=E("tdj_8")),
            discord.SelectOption(label="Tickets (5 opções)", value="tickets", emoji=E("tdj_9")),
            discord.SelectOption(label="Painel de Avaliações", value="feedback_panel", emoji="⭐"),
            discord.SelectOption(label="Sugestões", value="suggestions", emoji=E("minecraft")),
            discord.SelectOption(label="Níveis (MEE6)", value="levels_cfg", emoji="🏆"),
            discord.SelectOption(label="Filtros de Palavras/Links", value="filters_cfg", emoji="🛡️"),
            discord.SelectOption(label="Painel VIP", value="vip_cfg", emoji="💎"),
            discord.SelectOption(label="Painel Staff", value="staff_cfg", emoji="👮"),
            discord.SelectOption(label="Limpeza de Chat", value="chat_cleanup", emoji=E("hellokitty")),
            discord.SelectOption(label="Ver Configuração", value="show_config", emoji=E("nitro_boo")),
        ], custom_id="pxk_main_menu", min_values=1, max_values=1)
    select.callback = main_menu_callback
    layout.add_item(ui.Container(
        ui.TextDisplay(f"## {E('seta')} Categorias"),
        ui.TextDisplay("-# Cada categoria abre um submenu com botões organizados."),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(select),
        accent_color=c_secondary()))
    return layout

async def main_menu_callback(interaction):
    v = interaction.data["values"][0]
    await log_admin_action(interaction, "menu_open", f"categoria={v}")
    routes = {
        "identity": lambda: interaction.response.send_message(view=identity_view(), ephemeral=True),
        "colors": lambda: interaction.response.send_message(view=colors_view(), ephemeral=True),
        "autoemoji": lambda: interaction.response.send_message(view=autoemoji_view(), ephemeral=True),
        "antibot": lambda: interaction.response.send_message(view=antibot_view(), ephemeral=True),
        "captcha": lambda: interaction.response.send_message(view=captcha_view(), ephemeral=True),
        "welcome": lambda: interaction.response.send_message(view=welcome_view(), ephemeral=True),
        "voicelogs": lambda: interaction.response.send_message(view=voicelogs_view(), ephemeral=True),
        "voice": lambda: interaction.response.send_message(view=voice_view(), ephemeral=True),
        "admin": lambda: interaction.response.send_message(view=admin_view(), ephemeral=True),
        "addcargo_cfg": lambda: interaction.response.send_message(view=addcargo_cfg_view(), ephemeral=True),
        "painel_fixo": lambda: interaction.response.send_message(view=painel_fixo_view(), ephemeral=True),
        "tickets": lambda: interaction.response.send_message(view=tickets_view(), ephemeral=True),
        "feedback_panel": lambda: interaction.response.send_message(view=feedback_panel_view(), ephemeral=True),
        "suggestions": lambda: interaction.response.send_message(view=suggestions_view(), ephemeral=True),
        "levels_cfg": lambda: interaction.response.send_message(view=levels_view(), ephemeral=True),
        "filters_cfg": lambda: interaction.response.send_message(view=filters_view(), ephemeral=True),
        "vip_cfg": lambda: interaction.response.send_message(view=vip_cfg_view(), ephemeral=True),
        "staff_cfg": lambda: interaction.response.send_message(view=staff_cfg_view(), ephemeral=True),
        "chat_cleanup": lambda: interaction.response.send_message(view=chat_cleanup_view(), ephemeral=True),
        "show_config": lambda: interaction.response.send_message(view=show_config_view(), ephemeral=True),
    }
    fn = routes.get(v)
    if fn: await fn()

# ===================== SUBMENUS =====================
def identity_view():
    return premium_submenu("🎨 Identidade Visual",
        "Personalize nome, emoji, cores e imagens do bot.",
        [{"title":"🏷️ Marca","rows":[[_btn("Nome","id_name",P,E("tdj_1")),_btn("Emoji","id_emoji",P,E("tdj_2")),_btn("Rodapé","id_footer",P,E("tdj_3"))]]},
         {"title":"🎨 Paleta de Cores","rows":[[_btn("Primária","id_c1",P,E("tdj_1")),_btn("Secundária","id_c2",P,E("tdj_2")),_btn("Sucesso","id_c3",SU,E("tdj_3")),_btn("Perigo","id_c4",D,E("tdj_4"))]]},
         {"title":"🖼️ Imagens","rows":[[_btn("Avatar","id_avatar",S,E("nitroboo")),_btn("Banner Painel","id_bp",S,E("tdj_5"))],
                                       [_btn("Banner Ticket","id_bt",S,E("tdj_6")),_btn("Banner Welcome","id_bw",S,E("tdj_7"))]]},
         {"title":"⚙️ Ações","rows":[[_btn("Aplicar Avatar","id_apply",SU,E("verificado")),_btn("Preview","id_preview",S,E("seta"))]]}],
        accent=c_panel("main", c_primary()))

def colors_view():
    return premium_submenu("🌈 Cores dos Painéis",
        "Configure a cor de cada painel individual.",
        [{"title":"🎨 Painéis","rows":[[_btn("Principal","col_main",P,"🖤"),_btn("Ticket","col_ticket",P,"🎫")],
                                        [_btn("Verificação","col_verification",P,"✅"),_btn("Feedback","col_feedback",P,"⭐")],
                                        [_btn("Sugestões","col_suggestions",P,"💡"),_btn("Níveis","col_levels",P,"🏆")],
                                        [_btn("Staff","col_staff",P,"👮"),_btn("VIP","col_vip",P,"💎")]]}],
        accent=c_primary())

def autoemoji_view():
    on = config.get("auto_emoji_channels", True)
    return premium_submenu("✨ Auto-Emoji",
        f"**Status:** `{'Ativado' if on else 'Desativado'}`",
        [{"title":"⚙️ Controle","rows":[[_btn(f"Auto-Emoji: {'ON' if on else 'OFF'}","ae_toggle",SU if on else D,"✨"),
                                          _btn("Sincronizar","ae_sync",P,E("verificado"))]]}],
        accent=c_primary())

def antibot_view():
    ban_on = config.get("antibot_punish_ban", True); del_on = config.get("antibot_delete_messages", True)
    total = get_antibot_count()
    return premium_submenu("🚫 Anti-Bot",
        f"**Banir:** `{'ON' if ban_on else 'OFF'}` | **Apagar:** `{'ON' if del_on else 'OFF'}` | **Punidos:** `{total}`",
        [{"title":"📢 Canais","rows":[[_btn("Canal Anti-Bot","ab_ch",P,E("tdj_1")),_btn("Canal de Log","ab_log",P,E("tdj_2"))]]},
         {"title":"⚙️ Ações","rows":[[_btn(f"Banir: {'ON' if ban_on else 'OFF'}","ab_toggle_ban",SU if ban_on else D,E("tdj_6")),
                                       _btn(f"Apagar: {'ON' if del_on else 'OFF'}","ab_toggle_del",SU if del_on else D,E("tdj_7"))]]},
         {"title":"🎛️ Painel","rows":[[_btn("Postar","ab_post",SU,E("verificado")),_btn("Preview","ab_preview",S,E("seta"))]]}],
        accent=c_primary())

def captcha_view():
    method = config.get("verification_method","math")
    diff = config.get("verification_difficulty",1)
    kick = config.get("verification_kick_minutes",0)
    timeout_del = config.get("verification_timeout_delete_minutes",5)
    enabled = config.get("verification_enabled", True)
    m_label = "🧮 Matemática" if method=="math" else "🔘 Botão"
    d_label = {1:"Fácil",2:"Médio",3:"Difícil"}.get(diff,"Fácil")
    k_label = "Desativado" if not kick else f"{kick} min"
    t_label = "Desativado" if timeout_del<=0 else f"{timeout_del} min"
    return premium_submenu("✅ Verificação Captcha",
        f"**Status:** `{'🟢 ON' if enabled else '🔴 OFF'}` | **Método:** `{m_label}`\n"
        f"**Dificuldade:** `{d_label}` | **Kick:** `{k_label}` | **Deletar canal:** `{t_label}`",
        [{"title":"🔛 Controle","rows":[[_btn(f"Verificação: {'ON' if enabled else 'OFF'}","cap_toggle",SU if enabled else D,E("verificado"))]]},
         {"title":"👑 Cargos","rows":[[_btn("Verificados","cap_roles",P,E("verificado")),_btn("Não Verificados","cap_unver",P,E("tdj_1"))]]},
         {"title":"⚙️ Configuração","rows":[[_btn("Método","cap_method",P,E("tdj_2")),_btn("Dificuldade","cap_diff",P,E("tdj_3"))]]},
         {"title":"⏰ Automação","rows":[[_btn("Kick Auto","cap_kick",D,E("tdj_4")),_btn("Deletar Canal Após","cap_timeout",D,E("tdj_5"))]]},
         {"title":"📢 Canais","rows":[[_btn("Canal Verificação","cap_ch",P,E("tdj_6")),_btn("Painel","cap_pch",P,E("tdj_7"))],
                                       [_btn("Log","cap_log",P,E("tdj_8")),_btn("Categoria Temp","cap_tmpcat",P,E("tdj_9"))]]}],
        accent=c_panel("verification", c_secondary()))

def welcome_view():
    mention_ch = "✅" if config.get("welcome_mention_channel_id") else "❌"
    auto_role = "✅" if config.get("auto_role_id") else "❌"
    delay = config.get("welcome_mention_delete_seconds", 5)
    return premium_submenu("💌 Boas-vindas & Saída",
        f"**Cargo Auto:** {auto_role} | **Menção:** {mention_ch} (apaga em `{delay}s`)",
        [{"title":"🎉 Entrada","rows":[[_btn("Canal Card","wel_ch",P,E("tdj_1")),_btn("Mensagem","wel_msg",P,E("tdj_2"))],
                                        [_btn("Banner","wel_img",S,E("tdj_3")),_btn("Testar","wel_test",SU,E("verificado"))]]},
         {"title":"👋 Saída","rows":[[_btn("Canal","lev_ch",P,E("tdj_4")),_btn("Mensagem","lev_msg",P,E("tdj_5"))],
                                      [_btn("Testar","lev_test",SU,E("verificado"))]]},
         {"title":"🤖 Cargo Auto","rows":[[_btn("Definir Cargo","wel_autorole",P,E("tdj_6"))]]},
         {"title":"💬 Menção Auto-Delete","rows":[[_btn("Canal","wel_mention_ch",P,E("tdj_7")),_btn("Mensagem","wel_mention_msg",P,E("tdj_8"))],
                                                   [_btn("Segundos","wel_mention_delay",S,E("tdj_9"))]]}],
        accent=c_primary())

def voicelogs_view():
    return premium_submenu("🎙️ Logs de Voz",
        "Registre quem entra e sai das calls.",
        [{"title":"🔊 Entrada","rows":[[_btn("Canal","vl_join_ch",P,E("tdj_1")),_btn("Testar","vl_join_test",SU,E("verificado"))]]},
         {"title":"🔇 Saída","rows":[[_btn("Canal","vl_leave_ch",P,E("tdj_2")),_btn("Testar","vl_leave_test",SU,E("verificado"))]]}],
        accent=c_secondary())

def voice_view():
    rot = config.get("activity_rotate_enabled", False)
    tipo = config.get("activity_type","watching")
    return premium_submenu("🔊 Voz & Status",
        f"**Rotação:** `{'ON' if rot else 'OFF'}` | **Tipo:** `{tipo}`",
        [{"title":"🎙️ Voz 24h","rows":[[_btn("Canal de Voz","v_ch",P,E("tdj_1"))]]},
         {"title":"🎭 Presença","rows":[[_btn("Mute","v_mute",P,E("tdj_2")),_btn("Status","v_status",P,E("tdj_3"))]]},
         {"title":"🎞️ Atividade","rows":[[_btn(f"Rotação: {'ON' if rot else 'OFF'}","act_toggle",SU if rot else D,E("tdj_4")),
                                            _btn("Mensagens","act_msgs",P,E("tdj_5"))],
                                          [_btn("Tipo","act_type",P,E("tdj_6")),_btn("Intervalo","act_interval",P,E("tdj_7"))],
                                          [_btn("Preview","act_preview",S,E("seta"))]]}],
        accent=c_primary())

def admin_view():
    return premium_submenu("👑 Cargos de Admin", "Quem pode usar este painel.",
        [{"title":"🔐 Permissões","rows":[[_btn("Selecionar Cargos","adm_roles",P,E("tdj_1"))]]}],
        accent=c_primary())

def addcargo_cfg_view():
    allowed = len(config.get("addcargo_allowed_role_ids", []) or [])
    ch_ok = "✅" if config.get("addcargo_panel_channel_id") else "❌"
    return premium_submenu("➕ /addcargo", f"**Cargos:** `{allowed}` | **Painel:** {ch_ok}",
        [{"title":"👑 Cargos","rows":[[_btn("Selecionar","acfg_roles",P,E("tdj_1"))]]},
         {"title":"📢 Painel","rows":[[_btn("Canal","acfg_ch",P,E("tdj_2")),_btn("Postar","acfg_post",SU,E("verificado"))],
                                        [_btn("Preview","acfg_preview",S,E("seta"))]]}],
        accent=c_primary())

def painel_fixo_view():
    return premium_submenu("📌 Painel Fixo", "Onde o painel principal fica fixado.",
        [{"title":"📢 Canal","rows":[[_btn("Definir","pf_ch",P,E("tdj_1"))]]}],
        accent=c_primary())

def tickets_view():
    ch_ok = "✅" if config.get("ticket_panel_channel_id") else "❌"
    return premium_submenu("🎫 Tickets (5 opções)", f"**Painel:** {ch_ok}",
        [{"title":"📂 Categorias","rows":[[_btn("MOV CALL","tk_cat_movcall",P,E("tdj_1")),_btn("MOV CHAT","tk_cat_movchat",P,E("tdj_2"))],
                                            [_btn("RECRUTE-S","tk_cat_recrute",P,E("tdj_3")),_btn("SUPORTE","tk_cat_support",P,E("tdj_4"))],
                                            [_btn("OUTROS","tk_cat_others",P,E("tdj_5"))]]},
         {"title":"👥 Staff & Logs","rows":[[_btn("Cargos Staff","tk_sup",P,E("tdj_6")),_btn("Logs Ticket","tk_logs",P,E("tdj_7"))]]},
         {"title":"📢 Painel","rows":[[_btn("Canal Painel","tk_panel",P,E("tdj_8")),_btn("Logs Moderação","tk_mod",P,E("tdj_9"))]]},
         {"title":"🎨 Customização","rows":[[_btn("Personalizar","tk_customize",SU,E("verificado"))]]}],
        accent=c_panel("ticket", c_primary()))

def ticket_panel_custom_view():
    return premium_submenu("🎨 Personalizar Painel Tickets",
        "Placeholders: `{brand}`, `{emoji}`, `{members}`",
        [{"title":"🏷️ Cabeçalho","rows":[[_btn("Título","tpc_title",P,E("tdj_1")),_btn("Descrição","tpc_desc",P,E("tdj_2"))],
                                          [_btn("Banner","tpc_banner",P,E("tdj_3")),_btn("Placeholder","tpc_ph",P,E("tdj_4"))]]},
         {"title":"❓ Dúvidas","rows":[[_btn("Label","tpc_dlabel",P,E("tdj_5")),_btn("Emoji","tpc_demoji",P,E("tdj_6"))]]},
         {"title":"🛒 Compras","rows":[[_btn("Label","tpc_plabel",P,E("tdj_7")),_btn("Emoji","tpc_pemoji",P,E("tdj_8"))]]},
         {"title":"⚙️ Ações","rows":[[_btn("Atualizar","tpc_refresh",SU,E("verificado")),_btn("Preview","tpc_preview",S,E("seta"))],
                                       [_btn("Resetar","tpc_reset",D,E("seta"))]]}],
        accent=c_panel("ticket", c_primary()))

def feedback_panel_view():
    ch_ok = "✅" if config.get("feedback_panel_channel_id") else "❌"
    return premium_submenu("⭐ Painel de Avaliações", f"**Painel:** {ch_ok}",
        [{"title":"📢 Canais","rows":[[_btn("Painel","fbp_ch",P,E("tdj_1")),_btn("Logs","fbp_log",P,E("tdj_2"))],
                                        [_btn("Postar","fbp_post",SU,E("verificado")),_btn("Preview","fbp_prev",S,E("seta"))]]},
         {"title":"🎨 Personalizar","rows":[[_btn("Título","fbp_title",P,E("tdj_3")),_btn("Descrição","fbp_desc",P,E("tdj_4"))]]}],
        accent=c_panel("feedback", c_primary()))

def suggestions_view():
    return premium_submenu("💡 Sugestões", "Painel e canal de sugestões.",
        [{"title":"📢 Canais","rows":[[_btn("Painel","sg_pch",P,E("tdj_1")),_btn("Canal","sg_ch",P,E("tdj_2"))]]},
         {"title":"⚙️ Ações","rows":[[_btn("Atualizar","sg_refresh",SU,E("verificado")),_btn("Preview","sg_prev",S,E("seta"))]]}],
        accent=c_panel("suggestions", c_primary()))

def levels_view():
    en = config.get("levels_enabled", True)
    xp = config.get("levels_xp_per_message", 15)
    cd = config.get("levels_xp_cooldown_seconds", 60)
    ch_ok = "✅" if config.get("levels_announce_channel_id") else "❌"
    return premium_submenu("🏆 Sistema de Níveis (MEE6)",
        f"**Status:** `{'ON' if en else 'OFF'}` | **XP/msg:** `{xp}` | **Cooldown:** `{cd}s` | **Canal:** {ch_ok}",
        [{"title":"⚙️ Controle","rows":[[_btn(f"Ativar: {'ON' if en else 'OFF'}","lv_toggle",SU if en else D,E("verificado"))]]},
         {"title":"📊 Configuração","rows":[[_btn("XP por Msg","lv_xp",P,E("tdj_1")),_btn("Cooldown","lv_cd",P,E("tdj_2"))],
                                             [_btn("Canal Anúncio","lv_ch",P,E("tdj_3")),_btn("Mensagem","lv_msg",P,E("tdj_4"))]]},
         {"title":"🎁 Cargos por Nível","rows":[[_btn("Gerenciar","lv_rewards",P,E("tdj_5")),_btn("Rank","lv_rank",S,E("tdj_6"))]]}],
        accent=c_panel("levels", 0xFFD700))

def filters_view():
    en = config.get("filters_enabled", True)
    words = len(config.get("filters_blocked_words") or [])
    domains = len(config.get("filters_allowed_domains") or [])
    return premium_submenu("🛡️ Filtros",
        f"**Status:** `{'ON' if en else 'OFF'}` | **Palavras:** `{words}` | **Domínios:** `{domains}`",
        [{"title":"⚙️ Controle","rows":[[_btn(f"Filtros: {'ON' if en else 'OFF'}","ft_toggle",SU if en else D,E("verificado"))]]},
         {"title":"📝 Filtros","rows":[[_btn("Palavras Bloqueadas","ft_words",P,"🚫"),_btn("Domínios Permitidos","ft_domains",P,"🌐")]]},
         {"title":"⚙️ Ações","rows":[[_btn("Cargos que Podem Link","ft_roles",P,E("tdj_1")),
                                       _btn("Canal de Log","ft_log",P,E("tdj_2"))],
                                     [_btn("Avisos até Castigo","ft_punish",P,E("tdj_3"))]]}],
        accent=c_primary())

def vip_cfg_view():
    en = config.get("vip_enabled", True)
    base = "✅" if config.get("vip_role_base_id") else "❌"
    return premium_submenu("💎 Painel VIP",
        f"**Status:** `{'ON' if en else 'OFF'}` | **Cargo Base:** {base}",
        [{"title":"⚙️ Controle","rows":[[_btn(f"Ativar: {'ON' if en else 'OFF'}","vip_toggle",SU if en else D,E("verificado"))]]},
         {"title":"👑 Cargo Base","rows":[[_btn("Definir","vip_base",P,E("tdj_1"))]]},
         {"title":"⚙️ Permissões","rows":[[_btn("Cor","vip_perm_color",P,"🎨"),_btn("Nome","vip_perm_name",P,"✏️")],
                                            [_btn("Tag","vip_perm_tag",P,"🏷️"),_btn("Limite Membros","vip_limit",P,"👥")]]},
         {"title":"📢 Painel Público","rows":[[_btn("Canal","vip_panel_ch",P,E("tdj_2"))]]}],
        accent=c_panel("vip", 0xFFD700))

def staff_cfg_view():
    roles = len(config.get("staff_role_ids") or [])
    return premium_submenu("👮 Staff / Moderação",
        f"**Cargos Staff:** `{roles}`",
        [{"title":"👥 Cargos","rows":[[_btn("Cargos Staff","stf_roles",P,E("tdj_1")),_btn("MOV CHAT","stf_movchat",P,E("tdj_2"))]]},
         {"title":"🎯 Metas","rows":[[_btn("Meta Msgs MovChat","stf_goal_msg",P,E("tdj_3")),
                                       _btn("Meta Horas Call","stf_goal_call",P,E("tdj_4"))]]},
         {"title":"📊 Canais","rows":[[_btn("Relatórios","stf_report",P,E("tdj_5")),_btn("Punições","stf_punish",P,E("tdj_6"))]]},
         {"title":"⚙️ Config","rows":[[_btn("Avisos p/ Ban","stf_threshold",P,E("tdj_7"))]]},
         {"title":"🎛️ Painel","rows":[[_btn("Abrir Painel Staff","stf_open_panel",SU,E("verificado"))]]}],
        accent=c_panel("staff", c_danger()))

# ===================== CHAT CLEANUP =====================
_cleanup_selection = {}

def _progress_bar(cur, tot, length=22):
    if tot<=0: return f"`[{'█'*length}]` **100%**"
    cur = max(0, min(cur, tot)); pct = int(cur/tot*100); f = int(length*cur/tot)
    return f"`[{'█'*f}{'░'*(length-f)}]` **{pct}%**"

def _fmt_elapsed(t):
    e = (datetime.datetime.now()-t).total_seconds()
    return f"{int(e//60):02d}:{int(e%60):02d}"

def _build_cleanup_progress_view(done, tot, cur_ch, cur_del, start, phase=""):
    lines = ["### 📊 Progresso", _progress_bar(done, tot),
             f"**Concluídos:** `{done}/{tot}`",
             f"**Status:** {'✅ Concluído' if done>=tot else '🔄 Em andamento...'}",
             f"**Tempo:** `{_fmt_elapsed(start)}`"]
    if cur_ch:
        lines += ["", f"### 📂 Canal Atual ({done+1}/{tot})", f"**{cur_ch.mention}**",
                  f"**Apagadas:** `{cur_del}`"]
        if phase: lines.append(f"**Fase:** {phase}")
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(ui.TextDisplay("# 🧹 Limpeza"),
        ui.TextDisplay("\n".join(lines)), accent_color=c_primary()))
    return layout

def _build_cleanup_final_view(summary):
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(ui.TextDisplay("# ✅ Limpeza Concluída"),
        ui.TextDisplay(summary),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(_btn("Voltar","back_main",D,E("seta"))), accent_color=c_primary()))
    return layout

def cleanup_channel_options():
    g = get_guild(); opts = []
    if g:
        for c in g.text_channels:
            try:
                p = c.permissions_for(g.me)
                if p.manage_messages and p.read_message_history:
                    opts.append(discord.SelectOption(label=f"💬 #{c.name}"[:100], value=str(c.id)))
            except Exception: continue
        for c in g.voice_channels:
            try:
                p = c.permissions_for(g.me)
                if p.manage_messages and p.read_message_history:
                    opts.append(discord.SelectOption(label=f"🔊 {c.name}"[:100], value=str(c.id)))
            except Exception: continue
    return opts[:25] or [discord.SelectOption(label="Nenhum canal", value="none")]

def chat_cleanup_view():
    layout = ui.LayoutView(timeout=600)
    opts = cleanup_channel_options(); n = len([o for o in opts if o.value != "none"])
    sel = _safe_select("🧹 Selecione canais para limpar...", opts,
                        custom_id="cleanup_multi_select", min_values=1, max_values=max(1, min(25, n)))
    sel.callback = _on_cleanup_select
    start_btn = ui.Button(label="Iniciar Limpeza", style=D, emoji=E("hellokitty"), custom_id="cleanup_start")
    async def on_start(i): await run_multi_cleanup(i)
    start_btn.callback = on_start
    layout.add_item(ui.Container(
        ui.TextDisplay("# 🧹 Limpeza de Chat"),
        ui.Section(ui.TextDisplay("Selecione canais e clique em iniciar.\n-# ⚠️ Ação irreversível."),
                   accessory=ui.Thumbnail(media=_thumb())),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel), ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(start_btn, _btn("Voltar","back_main",S,E("seta"))),
        accent_color=c_primary()))
    return layout

async def _on_cleanup_select(interaction):
    vals = interaction.data.get("values", [])
    _cleanup_selection[interaction.user.id] = [int(v) for v in vals if v != "none"]
    ids = _cleanup_selection[interaction.user.id]
    await log_admin_action(interaction, "cleanup_select", f"canais={ids}")
    if not ids:
        await interaction.response.send_message("❌ Nenhum canal selecionado.", ephemeral=True); return
    mentions = "\n".join(f"• <#{c}>" for c in ids)
    await interaction.response.send_message(f"✅ **{len(ids)} canal(is)** selecionado(s):\n{mentions}", ephemeral=True)

async def _purge_channel(channel, guild, on_progress):
    total = 0; erro = None
    cutoff = discord.utils.utcnow() - datetime.timedelta(days=13)
    is_text = isinstance(channel, discord.TextChannel)
    if is_text:
        try:
            while True:
                try: deleted = await channel.purge(limit=100, after=cutoff, bulk=True)
                except discord.HTTPException: break
                if not deleted: break
                total += len(deleted); await on_progress(total, "🟢 Bulk")
                await asyncio.sleep(0.9)
        except Exception: pass
    erros = 0
    try:
        hk = dict(limit=None, oldest_first=False)
        if is_text: hk["before"] = cutoff
        async for msg in channel.history(**hk):
            try:
                await msg.delete(); total += 1; erros = 0
                await on_progress(total, "🟡 Individual")
                await asyncio.sleep(0.4 if is_text else 1.1)
            except discord.NotFound: continue
            except discord.Forbidden as e: erro = str(e); break
            except discord.HTTPException as e:
                erros += 1
                if erros >= 5: erro = str(e); break
                await asyncio.sleep(2.0)
    except Exception as e: erro = str(e)
    return total, erro

async def run_multi_cleanup(interaction):
    uid = interaction.user.id
    ids = _cleanup_selection.get(uid, [])
    if not ids:
        await interaction.response.send_message("❌ Nenhum canal. Selecione primeiro.", ephemeral=True); return
    channels = []
    for cid in ids:
        ch = interaction.guild.get_channel(cid)
        if not ch or not isinstance(ch, (discord.TextChannel, discord.VoiceChannel)): continue
        p = ch.permissions_for(interaction.guild.me)
        if p.manage_messages and p.read_message_history: channels.append(ch)
    if not channels:
        await interaction.response.send_message("❌ Nenhum canal válido.", ephemeral=True); return
    await log_admin_action(interaction, "cleanup_start", f"canais={[c.id for c in channels]}")
    await interaction.response.defer(ephemeral=True)
    start = datetime.datetime.now(); total = 0; results = []
    pmsg = await interaction.edit_original_response(view=_build_cleanup_progress_view(0, len(channels), None, 0, start))
    for i, ch in enumerate(channels, 1):
        lu = {"t": datetime.datetime.now()}
        async def on_progress(d, phase):
            now = datetime.datetime.now()
            if (now-lu["t"]).total_seconds() < 1.8: return
            lu["t"] = now
            try: await pmsg.edit(view=_build_cleanup_progress_view(i-1, len(channels), ch, d, start, phase))
            except Exception: pass
        d_cnt, _ = await _purge_channel(ch, interaction.guild, on_progress)
        total += d_cnt; results.append((ch, d_cnt))
        try: await pmsg.edit(view=_build_cleanup_progress_view(i, len(channels), None, 0, start))
        except Exception: pass
    el = (datetime.datetime.now()-start).total_seconds(); m, s = int(el//60), int(el%60)
    lines = [f"### ✅ Resumo", f"**Tempo:** `{m:02d}m {s:02d}s`",
             f"**Canais:** `{len(results)}`", f"**Total:** `{total}` msgs", "", "### 📋 Por canal"]
    for c, n in results:
        lines.append(f"• {'🔊' if isinstance(c, discord.VoiceChannel) else '💬'} {c.mention} — `{n}`")
    try: await pmsg.edit(view=_build_cleanup_final_view("\n".join(lines)))
    except Exception: pass
    log_id = config.get("moderation_logs_channel_id")
    if log_id:
        log_ch = interaction.guild.get_channel(log_id)
        if log_ch:
            await send_log_card(log_ch, "🧹 Limpeza Concluída", user=interaction.user,
                fields=[("📂 Canais", f"**{len(results)}**"),("🗑️ Apagadas", f"**{total}**"),
                        ("⏱️ Tempo", f"`{m:02d}m {s:02d}s`")])
    _cleanup_selection.pop(uid, None)

# ===================== SHOW CONFIG =====================
def show_config_view():
    def rl(k):
        ids = config.get(k, [])
        return ", ".join(f"<@&{r}>" for r in ids) if ids else "—"
    def ch(k):
        cid = config.get(k); return f"<#{cid}>" if cid else "—"
    lines = ["### 🏷️ Marca", f"**Nome:** {bname()} {bemoji()}",
             f"**Guild:** `{config.get('guild_id')}`",
             "", "### ✅ Verificação",
             f"**Status:** `{'ON' if config.get('verification_enabled',True) else 'OFF'}`",
             f"**Cargos:** {rl('verified_role_ids')}",
             "", "### 🎫 Tickets",
             f"**Painel:** {ch('ticket_panel_channel_id')}",
             f"**Staff:** {rl('ticket_support_role_ids')}",
             "", "### 🏆 Níveis",
             f"**Status:** `{'ON' if config.get('levels_enabled',True) else 'OFF'}`",
             "", "### 🛡️ Filtros",
             f"**Status:** `{'ON' if config.get('filters_enabled',True) else 'OFF'}`",
             "", "### 💎 VIP",
             f"**Status:** `{'ON' if config.get('vip_enabled',True) else 'OFF'}`",
             "", "### 👮 Staff",
             f"**Cargos:** {rl('staff_role_ids')}"]
    layout = ui.LayoutView(timeout=300)
    layout.add_item(ui.Container(
        ui.TextDisplay("# 📋 Configuração Atual"),
        ui.Section(ui.TextDisplay("Tudo que está configurado agora."),
                   accessory=ui.Thumbnail(media=_thumb())),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.TextDisplay("\n".join(lines)),
        ui.Separator(spacing=discord.SeparatorSpacing.large),
        ui.ActionRow(_btn("Voltar","back_main",D,E("seta"))), accent_color=c_primary()))
    return layout

# ===================== VIEWS DE SELEÇÃO =====================
def multi_role_view(key, title, current_ids):
    layout = ui.LayoutView(timeout=180)
    selected = []
    for rid in current_ids[:25]:
        try:
            r = get_guild().get_role(rid)
            if r: selected.append(r)
        except Exception: pass
    sel = ui.RoleSelect(placeholder="Selecione cargos", min_values=0, max_values=25,
                        default_values=selected if selected else None)
    async def cb(interaction):
        ids = [int(r.id) for r in sel.values]
        config[key] = ids; save_config(config)
        await log_admin_action(interaction, f"set_roles:{key}", f"roles={ids}")
        await interaction.response.send_message(f"✅ **{title}:** `{len(ids)}` cargo(s).", ephemeral=True)
    sel.callback = cb
    layout.add_item(ui.Container(
        ui.TextDisplay(f"# 👑 {title}"),
        ui.Section(ui.TextDisplay("Selecione um ou mais cargos."),
                   accessory=ui.Thumbnail(media=_thumb())),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel), accent_color=c_primary()))
    return layout

def single_channel_view(key, title, admin_only=False):
    layout = ui.LayoutView(timeout=180)
    sel = _safe_select(title, text_channel_options(), min_values=1, max_values=1)
    async def cb(interaction):
        val = sel.values[0]
        if val == "none":
            await interaction.response.send_message("❌ Nenhum canal.", ephemeral=True); return
        config[key] = int(val); save_config(config)
        await log_admin_action(interaction, f"set_channel:{key}", f"canal={val}")
        await interaction.response.send_message(f"✅ **{title}:** <#{val}>", ephemeral=True)
    sel.callback = cb
    layout.add_item(ui.Container(
        ui.TextDisplay(f"# 📌 {title}"),
        ui.Section(ui.TextDisplay("Escolha o canal."),
                   accessory=ui.Thumbnail(media=_thumb())),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel), accent_color=c_primary()))
    return layout

def single_voice_view(key, title):
    layout = ui.LayoutView(timeout=180)
    sel = _safe_select(title, voice_channel_options(), min_values=1, max_values=1)
    async def cb(interaction):
        val = sel.values[0]
        if val == "none":
            await interaction.response.send_message("❌ Nenhum canal.", ephemeral=True); return
        config[key] = int(val); save_config(config)
        ch = interaction.guild.get_channel(int(val))
        await log_admin_action(interaction, f"set_voice:{key}", f"canal={val}")
        if ch and isinstance(ch, discord.VoiceChannel):
            try:
                if not interaction.guild.voice_client: await ch.connect()
                else: await interaction.guild.voice_client.move_to(ch)
                await update_voice_name_impl(); await update_voice_mute()
                if FFMPEG_AVAILABLE: await _play_silence(interaction.guild.voice_client)
            except Exception: pass
        await interaction.response.send_message(f"✅ **{title}:** {ch.name if ch else val}", ephemeral=True)
    sel.callback = cb
    layout.add_item(ui.Container(
        ui.TextDisplay(f"# 🔊 {title}"),
        ui.Section(ui.TextDisplay("Escolha o canal."),
                   accessory=ui.Thumbnail(media=_thumb())),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel), accent_color=c_primary()))
    return layout

def single_category_view(key, title):
    layout = ui.LayoutView(timeout=180)
    sel = _safe_select(title, category_options(), min_values=1, max_values=1)
    async def cb(interaction):
        val = sel.values[0]
        if val == "none":
            await interaction.response.send_message("❌ Nenhuma categoria.", ephemeral=True); return
        config[key] = int(val); save_config(config)
        await log_admin_action(interaction, f"set_category:{key}", f"cat={val}")
        await interaction.response.send_message(f"✅ **{title}** definida.", ephemeral=True)
    sel.callback = cb
    layout.add_item(ui.Container(
        ui.TextDisplay(f"# 📂 {title}"),
        ui.Section(ui.TextDisplay("Escolha a categoria."),
                   accessory=ui.Thumbnail(media=_thumb())),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel), accent_color=c_primary()))
    return layout

def single_role_view(key, title, current_id=None):
    layout = ui.LayoutView(timeout=180)
    default = []
    if current_id:
        try:
            r = get_guild().get_role(current_id)
            if r: default = [r]
        except Exception: pass
    sel = ui.RoleSelect(placeholder="Selecione cargo", min_values=1, max_values=1,
                        default_values=default if default else None)
    async def cb(interaction):
        rid = int(sel.values[0].id) if sel.values else None
        config[key] = rid; save_config(config)
        await log_admin_action(interaction, f"set_role:{key}", f"role={rid}")
        await interaction.response.send_message(f"✅ **{title}:** <@&{rid}>", ephemeral=True)
    sel.callback = cb
    layout.add_item(ui.Container(
        ui.TextDisplay(f"# 👑 {title}"),
        ui.Section(ui.TextDisplay("Selecione o cargo."),
                   accessory=ui.Thumbnail(media=_thumb())),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel), accent_color=c_primary()))
    return layout

def status_view():
    layout = ui.LayoutView(timeout=180)
    sel = _safe_select("Status", [
        discord.SelectOption(label="Online", value="online", emoji="🟢"),
        discord.SelectOption(label="Ausente", value="idle", emoji="🟡"),
        discord.SelectOption(label="Não perturbe", value="dnd", emoji="🔴"),
        discord.SelectOption(label="Invisível", value="invisible", emoji="⚫"),
    ], min_values=1, max_values=1)
    async def cb(interaction):
        config["bot_status"] = sel.values[0]; save_config(config)
        await update_status(force=True)
        await interaction.response.send_message(f"✅ Status: **{sel.values[0]}**", ephemeral=True)
    sel.callback = cb
    layout.add_item(ui.Container(
        ui.TextDisplay("# 🎭 Status do Bot"),
        ui.Section(ui.TextDisplay("Escolha o status."),
                   accessory=ui.Thumbnail(media=_thumb())),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel), accent_color=c_primary()))
    return layout

# ===================== FEEDBACK / SUGESTÕES PANELS =====================
def feedback_panel_layout():
    total = 0
    try: total = count_general_feedback()
    except Exception: pass
    title = _fmt_text(config.get("feedback_panel_title") or "⭐ Avaliações — {brand}")
    desc = _fmt_text(config.get("feedback_panel_description") or "")
    if not title.startswith("#"): title = f"# {title}"
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(
        ui.TextDisplay(title),
        ui.Section(ui.TextDisplay(desc), accessory=ui.Thumbnail(media=_thumb())),
        ui.Separator(spacing=discord.SeparatorSpacing.large),
        ui.TextDisplay(f"### 📊 Estatísticas\n> **Avaliações:** `{total}`\n> **Escala:** ⭐⭐⭐⭐⭐"),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(_btn("Avaliar Agora","fb_open_modal",SU,"⭐"),_btn("Como Funciona","fb_help_btn",S,"❓")),
        ui.TextDisplay(f"-# {bfooter()}"), accent_color=c_panel("feedback", c_primary())))
    return layout

def suggestion_panel_layout():
    total = 0
    try:
        conn = get_db(); c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM suggestions"); total = c.fetchone()[0]; conn.close()
    except Exception: pass
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(
        ui.TextDisplay(f"# 💡 Central de Sugestões — {bname()}"),
        ui.Section(ui.TextDisplay("### 🌟 Sua voz constrói o servidor!\nEnvie sua ideia pelo botão abaixo."),
                   accessory=ui.Thumbnail(media=_thumb())),
        ui.Separator(spacing=discord.SeparatorSpacing.large),
        ui.TextDisplay(f"### 📊 Estatísticas\n> **Sugestões:** `{total}`"),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(_btn("Enviar Sugestão","suggest_btn",SU,"✨"),_btn("Ver Regras","sug_rules_btn",S,"📜")),
        ui.TextDisplay(f"-# {bfooter()}"), accent_color=c_panel("suggestions", c_primary())))
    return layout

def antibot_panel_view():
    count = get_antibot_count()
    comps = []
    b = config.get("antibot_banner_url")
    if b:
        mg = _safe_media_gallery(b)
        if mg is not None: comps.append(mg)
    comps.append(ui.TextDisplay(f"# {config.get('antibot_title') or 'AntiBot'}"))
    comps.append(ui.TextDisplay(f"> {(config.get('antibot_description') or '').replace(chr(10), chr(10)+'> ')}"))
    comps.append(ui.Separator(spacing=discord.SeparatorSpacing.small))
    comps.append(ui.ActionRow(ui.Button(label=f"Punidos: {count}", style=S, disabled=True, custom_id="antibot_counter_display")))
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=c_primary()))
    return layout

def addcargo_public_panel():
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(
        ui.TextDisplay("# ➕ Adicionar Cargos"),
        ui.Section(ui.TextDisplay("Adicione cargos a um usuário."),
                   accessory=ui.Thumbnail(media=_thumb())),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(_btn("Abrir Painel","addcargo_open",P,E("nitroboo"))),
        ui.TextDisplay(f"-# {bfooter()}"), accent_color=c_primary()))
    return layout

# ===================== MODAIS =====================
class BrandNameModal(ui.Modal, title="✏️ Nome da Marca"):
    v = ui.TextInput(label="Nome", required=True, max_length=50)
    async def on_submit(self, i):
        config["brand_name"] = self.v.value.strip(); save_config(config)
        await update_status(force=True)
        await i.response.send_message(f"✅ **{config['brand_name']}**", ephemeral=True)

class BrandEmojiModal(ui.Modal, title="✨ Emoji da Marca"):
    v = ui.TextInput(label="Emoji", required=True, max_length=10)
    async def on_submit(self, i):
        config["brand_emoji"] = self.v.value.strip(); save_config(config)
        await update_status(force=True)
        await i.response.send_message(f"✅ {config['brand_emoji']}", ephemeral=True)

class BrandFooterModal(ui.Modal, title="📝 Rodapé"):
    v = ui.TextInput(label="Texto", required=True, max_length=120)
    async def on_submit(self, i):
        config["brand_footer"] = self.v.value.strip(); save_config(config)
        await i.response.send_message("✅ Rodapé atualizado!", ephemeral=True)

class ColorModal(ui.Modal):
    def __init__(self, key, label):
        super().__init__(title=f"🎨 {label}")
        self.key = key
        self.v = ui.TextInput(label="HEX (ex: 3D1A5C)", required=True, min_length=6, max_length=7)
        self.add_item(self.v)
    async def on_submit(self, i):
        raw = self.v.value.strip().replace("#","")
        try: config[self.key] = int(raw, 16)
        except ValueError:
            await i.response.send_message("❌ HEX inválido.", ephemeral=True); return
        save_config(config)
        await i.response.send_message(f"✅ `#{raw.upper()}`", ephemeral=True)

class URLModal(ui.Modal):
    def __init__(self, key, label):
        super().__init__(title=f"🖼️ {label}")
        self.key = key
        self.v = ui.TextInput(label="URL (ou 'limpar')", required=True)
        self.add_item(self.v)
    async def on_submit(self, i):
        val = self.v.value.strip()
        if val.lower() in ("limpar","clear","none","remover"):
            config[self.key] = ""; save_config(config)
            await i.response.send_message("✅ Removida.", ephemeral=True); return
        if not (val.startswith("http://") or val.startswith("https://")):
            await i.response.send_message("❌ URL inválida.", ephemeral=True); return
        config[self.key] = val; save_config(config)
        await i.response.send_message("✅ Salva!", ephemeral=True)

class GenericTextModal(ui.Modal):
    def __init__(self, key, title, label, default="", style=discord.TextStyle.short, max_length=200):
        super().__init__(title=title[:45])
        self.key = key
        self.input = ui.TextInput(label=label[:45], default=(default or "")[:max_length],
                                   style=style, required=True, max_length=max_length)
        self.add_item(self.input)
    async def on_submit(self, i):
        config[self.key] = self.input.value.strip(); save_config(config)
        await i.response.send_message("✅ Atualizado!", ephemeral=True)

class WelcomeDefaultMessageModal(ui.Modal, title="Mensagem de Boas-vindas"):
    msg = ui.TextInput(label="Nova mensagem", style=discord.TextStyle.paragraph, required=True)
    async def on_submit(self, i):
        config["welcome_message"] = self.msg.value; save_config(config)
        await i.response.send_message("✅ Atualizada!", ephemeral=True)

class LeaveMessageModal(ui.Modal, title="Mensagem de Saída"):
    msg = ui.TextInput(label="Nova mensagem", style=discord.TextStyle.paragraph, required=True)
    async def on_submit(self, i):
        config["leave_message"] = self.msg.value; save_config(config)
        await i.response.send_message("✅ Atualizada!", ephemeral=True)

class KickTimeModal(ui.Modal, title="⏰ Kick Auto"):
    def __init__(self):
        super().__init__()
        self.v = ui.TextInput(label="Minutos (0 = desativar)",
                              default=str(config.get("verification_kick_minutes",0)),
                              required=True, max_length=4)
        self.add_item(self.v)
    async def on_submit(self, i):
        try: val = max(0, int(self.v.value.strip()))
        except ValueError:
            await i.response.send_message("❌ Inválido.", ephemeral=True); return
        config["verification_kick_minutes"] = val; save_config(config)
        await i.response.send_message(f"✅ `{val} min`", ephemeral=True)

class VerifTimeoutModal(ui.Modal, title="⏰ Deletar Canal"):
    def __init__(self):
        super().__init__()
        self.v = ui.TextInput(label="Minutos (0 = desativar)",
                              default=str(config.get("verification_timeout_delete_minutes",5)),
                              required=True, max_length=4)
        self.add_item(self.v)
    async def on_submit(self, i):
        try: val = max(0, int(self.v.value.strip()))
        except ValueError:
            await i.response.send_message("❌ Inválido.", ephemeral=True); return
        config["verification_timeout_delete_minutes"] = val; save_config(config)
        await i.response.send_message(f"✅ `{val} min`", ephemeral=True)

class WelcomeMentionDelayModal(ui.Modal, title="⏱️ Segundos Menção"):
    def __init__(self):
        super().__init__()
        self.v = ui.TextInput(label="Segundos", default=str(config.get("welcome_mention_delete_seconds",5)),
                              required=True, max_length=4)
        self.add_item(self.v)
    async def on_submit(self, i):
        try: val = max(1, int(self.v.value.strip()))
        except ValueError:
            await i.response.send_message("❌ Inválido.", ephemeral=True); return
        config["welcome_mention_delete_seconds"] = val; save_config(config)
        await i.response.send_message(f"✅ `{val}s`", ephemeral=True)

class ActivityMessagesModal(ui.Modal, title="💬 Atividade"):
    def __init__(self):
        super().__init__()
        cur = "\n".join(config.get("activity_messages") or [])
        self.v = ui.TextInput(label="Uma mensagem por linha", style=discord.TextStyle.paragraph,
                              default=cur, required=False, max_length=2000)
        self.add_item(self.v)
    async def on_submit(self, i):
        msgs = [l.strip() for l in (self.v.value or "").replace("\r\n","\n").split("\n") if l.strip()]
        config["activity_messages"] = msgs; save_config(config)
        await i.response.send_message(f"✅ `{len(msgs)}` mensagens.", ephemeral=True)

class ActivityIntervalModal(ui.Modal, title="⏱️ Intervalo"):
    def __init__(self):
        super().__init__()
        self.v = ui.TextInput(label="Segundos (mín 10)",
                              default=str(config.get("activity_rotate_seconds",30)),
                              required=True, max_length=5)
        self.add_item(self.v)
    async def on_submit(self, i):
        try: val = max(10, int(self.v.value.strip()))
        except ValueError:
            await i.response.send_message("❌ Inválido.", ephemeral=True); return
        config["activity_rotate_seconds"] = val; save_config(config)
        await i.response.send_message(f"✅ `{val}s`", ephemeral=True)

class SuggestionModal(ui.Modal, title="💡 Enviar Sugestão"):
    s = ui.TextInput(label="Sua sugestão", style=discord.TextStyle.paragraph,
                     placeholder="Descreva sua ideia...", required=True, max_length=1500)
    async def on_submit(self, i):
        cid = config.get("suggestions_channel_id")
        if not cid:
            await i.response.send_message("❌ Canal não configurado.", ephemeral=True); return
        ch = i.guild.get_channel(cid)
        if not ch:
            await i.response.send_message("❌ Canal inválido.", ephemeral=True); return
        ph = ui.LayoutView(timeout=None)
        ph.add_item(ui.Container(ui.TextDisplay("# 💡 Nova Sugestão"),
                                  ui.TextDisplay("-# Carregando..."), accent_color=c_primary()))
        msg = await ch.send(view=ph)
        try: sid = add_suggestion(msg.id, ch.id, i.user.id, self.s.value)
        except Exception as e:
            logger.error(f"sug: {e}"); await msg.delete()
            await i.response.send_message("❌ Erro.", ephemeral=True); return
        card = suggestion_card_layout(sid, i.user, self.s.value, 0, 0, "open")
        try: await msg.edit(view=card)
        except Exception: pass
        await i.response.send_message(f"✅ {msg.jump_url}", ephemeral=True)

def suggestion_card_layout(sid, author, content, up, down, status="open"):
    total = up+down
    if total == 0:
        bar = "`[" + "░"*14 + "]` **0%**"
    else:
        filled = int(14*up/total); empty = 14 - filled
        bar = "`[" + "█"*filled + "░"*empty + "]` **" + str(int(up/total*100)) + "%**"
    avatar = author.display_avatar.with_size(256).url
    comps = [ui.TextDisplay(f"# 💡 Sugestão #{sid}"),
             ui.Section(ui.TextDisplay(f"### {author.display_name}\n-# Autor • {author.mention}"),
                        accessory=ui.Thumbnail(media=avatar)),
             ui.Separator(spacing=discord.SeparatorSpacing.small),
             ui.TextDisplay(f">>> {content}"),
             ui.Separator(spacing=discord.SeparatorSpacing.large),
             ui.TextDisplay(f"### 📊 Votação\n{bar}"),
             ui.TextDisplay(f"👍 **{up}** a favor  •  👎 **{down}** contra  •  📈 Total: **{total}**"),
             ui.Separator(spacing=discord.SeparatorSpacing.small),
             ui.ActionRow(ui.Button(label=f"A Favor • {up}", style=SU, custom_id=f"sug_up_{sid}", emoji="👍"),
                          ui.Button(label=f"Contra • {down}", style=D, custom_id=f"sug_down_{sid}", emoji="👎")),
             ui.TextDisplay(f"-# Status: {status}  •  {bfooter()}")]
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=c_panel("suggestions", c_primary())))
    return layout

class DirectFeedbackModal(ui.Modal, title="⭐ Enviar Feedback"):
    def __init__(self):
        super().__init__()
        self.rating = ui.Select(placeholder="Nota", options=[
            discord.SelectOption(label=f"{i} - {['Péssimo','Ruim','Regular','Bom','Excelente'][i-1]}",
                                 value=str(i), emoji="⭐") for i in range(1, 6)])
        self.add_item(self.rating)
        self.comment = ui.TextInput(label="Comentário (opcional)", style=discord.TextStyle.paragraph,
                                     required=False, max_length=1000)
        self.add_item(self.comment)
    async def on_submit(self, i):
        if not self.rating.values:
            await i.response.send_message("❌ Selecione uma nota.", ephemeral=True); return
        rating = int(self.rating.values[0])
        comment = (self.comment.value or "").strip() or "Sem comentário"
        try: add_general_feedback(i.user.id, rating, comment)
        except Exception: pass
        cid = config.get("feedback_channel_id")
        if cid:
            ch = i.guild.get_channel(cid)
            if ch:
                await send_log_card(ch, "⭐ Nova Avaliação", user=i.user,
                    fields=[("📊 Nota", f"{'⭐'*rating} **({rating}/5)**"),
                            ("💬 Comentário", f"```{comment[:800]}```")],
                    accent=c_panel("feedback", c_primary()))
        await i.response.send_message("✅ **Obrigado!** 💜", ephemeral=True)

class TicketNameModal(ui.Modal, title="✏️ Renomear Ticket"):
    def __init__(self, current):
        super().__init__()
        pretty = current[7:] if current.startswith("ticket-") else current
        self.v = ui.TextInput(label="Novo nome", default=pretty[:100], required=True, max_length=100)
        self.add_item(self.v)
    async def on_submit(self, i):
        new = sanitize_channel_name(self.v.value.strip())
        if not new:
            await i.response.send_message("❌ Inválido.", ephemeral=True); return
        try:
            old = i.channel.name
            await i.channel.edit(name=new)
            await i.response.send_message(f"✅ `{old}` → `{new}`", ephemeral=True)
        except Exception as e:
            await i.response.send_message(f"❌ {e}", ephemeral=True)

# ===================== VIEWS SIMPLES =====================
class ConfirmCloseView(ui.View):
    def __init__(self, channel_id):
        super().__init__(timeout=60); self.channel_id = channel_id
    @ui.button(label="✅ Sim, fechar", style=discord.ButtonStyle.danger)
    async def confirm(self, interaction, button):
        ch = interaction.guild.get_channel(self.channel_id)
        if ch:
            log_id = config.get("ticket_logs_channel_id")
            if log_id:
                log_ch = interaction.guild.get_channel(log_id)
                if log_ch:
                    await send_log_card(log_ch, "🔒 Ticket Fechado", user=interaction.user,
                        fields=[("🎫 Ticket", f"`{ch.name}`"),
                                ("📍 Categoria", ch.category.name if ch.category else "—"),
                                ("🕐 Fechado em", _fmt_ts())],
                        accent=c_danger())
            try: remove_open_ticket(ch.id)
            except Exception: pass
            try: await ch.delete()
            except Exception: pass
        await interaction.response.send_message("✅ Ticket fechado.", ephemeral=True)

class AddMemberView(ui.View):
    def __init__(self):
        super().__init__(timeout=60)
        g = get_guild(); opts = []
        if g:
            for m in g.members[:25]:
                if not m.bot: opts.append(discord.SelectOption(label=m.display_name[:100], value=str(m.id)))
        if not opts: opts = [discord.SelectOption(label="Nenhum", value="none")]
        sel = ui.Select(placeholder="Escolha um membro", options=opts[:25])
        sel.callback = self.on_select; self.add_item(sel)
    async def on_select(self, interaction):
        val = interaction.data["values"][0]
        if val == "none":
            await interaction.response.send_message("❌ Nenhum.", ephemeral=True); return
        m = interaction.guild.get_member(int(val))
        if m:
            try:
                await interaction.channel.set_permissions(m, view_channel=True, send_messages=True, read_message_history=True)
                await interaction.response.send_message(f"✅ {m.mention} adicionado.", ephemeral=True)
            except Exception as e:
                await interaction.response.send_message(f"❌ {e}", ephemeral=True)

# ===================== INTERACTION HANDLER =====================
@bot.event
async def on_interaction(interaction):
    if interaction.type != discord.InteractionType.component: return
    cid = interaction.data.get("custom_id","")
    if not cid: return
    if cid in ("pxk_main_menu","cleanup_multi_select","ticket_panel_select","antibot_counter_display"): return
    try:
        # IDENTITY
        if cid == "id_name": await interaction.response.send_modal(BrandNameModal())
        elif cid == "id_emoji": await interaction.response.send_modal(BrandEmojiModal())
        elif cid == "id_footer": await interaction.response.send_modal(BrandFooterModal())
        elif cid == "id_c1": await interaction.response.send_modal(ColorModal("brand_color_primary","Cor Primária"))
        elif cid == "id_c2": await interaction.response.send_modal(ColorModal("brand_color_secondary","Cor Secundária"))
        elif cid == "id_c3": await interaction.response.send_modal(ColorModal("brand_color_success","Sucesso"))
        elif cid == "id_c4": await interaction.response.send_modal(ColorModal("brand_color_danger","Perigo"))
        elif cid == "id_avatar": await interaction.response.send_modal(URLModal("avatar_url","Avatar"))
        elif cid == "id_bp": await interaction.response.send_modal(URLModal("banner_painel_url","Banner Painel"))
        elif cid == "id_bt": await interaction.response.send_modal(URLModal("banner_ticket_url","Banner Ticket"))
        elif cid == "id_bw": await interaction.response.send_modal(URLModal("banner_welcome_url","Banner Welcome"))
        elif cid == "id_apply":
            await interaction.response.defer(ephemeral=True)
            ok = await apply_avatar_if_needed(force=True)
            await interaction.followup.send("✅" if ok else "❌", ephemeral=True)
        elif cid == "id_preview":
            await interaction.response.send_message(view=painel_layout(), ephemeral=True)
        # COLORS
        elif cid == "col_main": await interaction.response.send_modal(ColorModal("panel_color_main","Painel Principal"))
        elif cid == "col_ticket": await interaction.response.send_modal(ColorModal("panel_color_ticket","Tickets"))
        elif cid == "col_verification": await interaction.response.send_modal(ColorModal("panel_color_verification","Verificação"))
        elif cid == "col_feedback": await interaction.response.send_modal(ColorModal("panel_color_feedback","Feedback"))
        elif cid == "col_suggestions": await interaction.response.send_modal(ColorModal("panel_color_suggestions","Sugestões"))
        elif cid == "col_levels": await interaction.response.send_modal(ColorModal("panel_color_levels","Níveis"))
        elif cid == "col_staff": await interaction.response.send_modal(ColorModal("panel_color_staff","Staff"))
        elif cid == "col_vip": await interaction.response.send_modal(ColorModal("panel_color_vip","VIP"))
        # AUTO-EMOJI
        elif cid == "ae_toggle":
            config["auto_emoji_channels"] = not config.get("auto_emoji_channels", True)
            save_config(config)
            await interaction.response.send_message(f"✅ Auto-emoji: {'ON' if config['auto_emoji_channels'] else 'OFF'}", ephemeral=True)
        elif cid == "ae_sync":
            await interaction.response.defer(ephemeral=True)
            total = await sync_all_channels_emoji(interaction.guild)
            await interaction.followup.send(f"✨ {total} canais atualizados!", ephemeral=True)
        # ANTIBOT
        elif cid == "ab_ch": await interaction.response.send_message(view=single_channel_view("antibot_channel_id","Canal Anti-Bot"), ephemeral=True)
        elif cid == "ab_log": await interaction.response.send_message(view=single_channel_view("antibot_log_channel_id","Log AntiBot"), ephemeral=True)
        elif cid == "ab_toggle_ban":
            config["antibot_punish_ban"] = not config.get("antibot_punish_ban", True)
            save_config(config); await interaction.response.send_message("✅", ephemeral=True)
        elif cid == "ab_toggle_del":
            config["antibot_delete_messages"] = not config.get("antibot_delete_messages", True)
            save_config(config); await interaction.response.send_message("✅", ephemeral=True)
        elif cid == "ab_post": await post_antibot_panel(interaction)
        elif cid == "ab_preview": await interaction.response.send_message(view=antibot_panel_view(), ephemeral=True)
        # CAPTCHA
        elif cid == "cap_toggle":
            config["verification_enabled"] = not config.get("verification_enabled", True)
            save_config(config)
            try: await refresh_all_panels()
            except Exception: pass
            await interaction.response.send_message(f"✅ Verificação: {'ON' if config['verification_enabled'] else 'OFF'}", ephemeral=True)
        elif cid == "cap_roles": await interaction.response.send_message(view=multi_role_view("verified_role_ids","Verificados",config.get("verified_role_ids",[])), ephemeral=True)
        elif cid == "cap_unver": await interaction.response.send_message(view=multi_role_view("verification_unverified_role_ids","Não Verificados",config.get("verification_unverified_role_ids",[])), ephemeral=True)
        elif cid == "cap_method":
            layout = ui.LayoutView(timeout=180)
            sel = _safe_select("Método", [discord.SelectOption(label="🧮 Matemática", value="math"),
                                          discord.SelectOption(label="🔘 Botão", value="button")])
            async def cb(i):
                config["verification_method"] = sel.values[0]; save_config(config)
                await i.response.send_message(f"✅ {sel.values[0]}", ephemeral=True)
            sel.callback = cb
            layout.add_item(ui.Container(ui.TextDisplay("# 🔀 Método"),
                ui.ActionRow(sel), accent_color=c_secondary()))
            await interaction.response.send_message(view=layout, ephemeral=True)
        elif cid == "cap_diff":
            layout = ui.LayoutView(timeout=180)
            sel = _safe_select("Dificuldade", [discord.SelectOption(label="Fácil", value="1"),
                                                discord.SelectOption(label="Médio", value="2"),
                                                discord.SelectOption(label="Difícil", value="3")])
            async def cb(i):
                config["verification_difficulty"] = int(sel.values[0]); save_config(config)
                await i.response.send_message(f"✅ Nível {sel.values[0]}", ephemeral=True)
            sel.callback = cb
            layout.add_item(ui.Container(ui.TextDisplay("# 🎚️ Dificuldade"),
                ui.ActionRow(sel), accent_color=c_secondary()))
            await interaction.response.send_message(view=layout, ephemeral=True)
        elif cid == "cap_kick": await interaction.response.send_modal(KickTimeModal())
        elif cid == "cap_timeout": await interaction.response.send_modal(VerifTimeoutModal())
        elif cid == "cap_ch": await interaction.response.send_message(view=single_channel_view("verification_channel_id","Canal Verificação"), ephemeral=True)
        elif cid == "cap_pch": await interaction.response.send_message(view=single_channel_view("verification_panel_channel_id","Painel Verificação"), ephemeral=True)
        elif cid == "cap_log": await interaction.response.send_message(view=single_channel_view("verification_log_channel_id","Log Verificação"), ephemeral=True)
        elif cid == "cap_tmpcat": await interaction.response.send_message(view=single_category_view("verification_temp_category_id","Categoria Temporária"), ephemeral=True)
        # WELCOME
        elif cid == "wel_ch": await interaction.response.send_message(view=single_channel_view("welcome_channel_id","Canal Welcome"), ephemeral=True)
        elif cid == "wel_msg": await interaction.response.send_modal(WelcomeDefaultMessageModal())
        elif cid == "wel_img": await interaction.response.send_modal(URLModal("welcome_image_url","Imagem Welcome"))
        elif cid == "wel_test":
            await interaction.response.defer(ephemeral=True)
            await send_welcome_message(interaction.user)
            await interaction.followup.send("✅ Teste enviado!", ephemeral=True)
        elif cid == "lev_ch": await interaction.response.send_message(view=single_channel_view("leave_channel_id","Canal Leave"), ephemeral=True)
        elif cid == "lev_msg": await interaction.response.send_modal(LeaveMessageModal())
        elif cid == "lev_test":
            await interaction.response.defer(ephemeral=True)
            await send_leave_message(interaction.user)
            await interaction.followup.send("✅ Teste enviado!", ephemeral=True)
        elif cid == "wel_autorole":
            await interaction.response.send_message(view=single_role_view("auto_role_id","Cargo Auto",config.get("auto_role_id")), ephemeral=True)
        elif cid == "wel_mention_ch": await interaction.response.send_message(view=single_channel_view("welcome_mention_channel_id","Canal Menção"), ephemeral=True)
        elif cid == "wel_mention_msg": await interaction.response.send_modal(GenericTextModal("welcome_mention_message","💬 Mensagem Menção","Use {user}",config.get("welcome_mention_message") or "",discord.TextStyle.paragraph,500))
        elif cid == "wel_mention_delay": await interaction.response.send_modal(WelcomeMentionDelayModal())
        # VOICE LOGS
        elif cid == "vl_join_ch": await interaction.response.send_message(view=single_channel_view("voice_join_log_channel_id","Log Entrada"), ephemeral=True)
        elif cid == "vl_leave_ch": await interaction.response.send_message(view=single_channel_view("voice_leave_log_channel_id","Log Saída"), ephemeral=True)
        elif cid == "vl_join_test":
            await interaction.response.defer(ephemeral=True)
            vc = interaction.guild.voice_client
            fc = vc.channel if vc and vc.channel else (interaction.guild.voice_channels[0] if interaction.guild.voice_channels else None)
            if fc:
                await send_voice_log(interaction.user, fc, "join")
                await interaction.followup.send("✅ Teste enviado!", ephemeral=True)
            else: await interaction.followup.send("❌ Nenhum canal.", ephemeral=True)
        elif cid == "vl_leave_test":
            await interaction.response.defer(ephemeral=True)
            vc = interaction.guild.voice_client
            fc = vc.channel if vc and vc.channel else (interaction.guild.voice_channels[0] if interaction.guild.voice_channels else None)
            if fc:
                await send_voice_log(interaction.user, fc, "leave")
                await interaction.followup.send("✅ Teste enviado!", ephemeral=True)
            else: await interaction.followup.send("❌ Nenhum canal.", ephemeral=True)
        # VOZ
        elif cid == "v_mute":
            config["voice_mute"] = not config.get("voice_mute", True)
            save_config(config); await update_voice_mute()
            await interaction.response.send_message("✅", ephemeral=True)
        elif cid == "v_status": await interaction.response.send_message(view=status_view(), ephemeral=True)
        elif cid == "v_ch": await interaction.response.send_message(view=single_voice_view("voice_channel_id","Canal Voz 24h"), ephemeral=True)
        elif cid == "act_toggle":
            config["activity_rotate_enabled"] = not config.get("activity_rotate_enabled", False)
            save_config(config); await update_status(force=True)
            await interaction.response.send_message("✅", ephemeral=True)
        elif cid == "act_msgs": await interaction.response.send_modal(ActivityMessagesModal())
        elif cid == "act_type":
            layout = ui.LayoutView(timeout=180)
            sel = _safe_select("Tipo", [discord.SelectOption(label="Assistindo", value="watching"),
                                        discord.SelectOption(label="Jogando", value="playing"),
                                        discord.SelectOption(label="Ouvindo", value="listening"),
                                        discord.SelectOption(label="Competindo", value="competing")])
            async def cb(i):
                config["activity_type"] = sel.values[0]; save_config(config); await update_status(force=True)
                await i.response.send_message("✅", ephemeral=True)
            sel.callback = cb
            layout.add_item(ui.Container(ui.TextDisplay("# 🎯 Tipo"), ui.ActionRow(sel), accent_color=c_primary()))
            await interaction.response.send_message(view=layout, ephemeral=True)
        elif cid == "act_interval": await interaction.response.send_modal(ActivityIntervalModal())
        elif cid == "act_preview":
            msgs = config.get("activity_messages") or []
            body = "\n".join(f"• {_fmt_text(m)}" for m in msgs) or "_Nenhuma_"
            await interaction.response.send_message(f"### 🎞️ Atividade\n{body}\n\n**Atual:** `{_current_activity_text()}`", ephemeral=True)
        # ADMIN
        elif cid == "adm_roles": await interaction.response.send_message(view=multi_role_view("admin_role_ids","Cargos Admin",config.get("admin_role_ids",[])), ephemeral=True)
        # ADDCARGO
        elif cid == "acfg_roles": await interaction.response.send_message(view=multi_role_view("addcargo_allowed_role_ids","Cargos /addcargo",config.get("addcargo_allowed_role_ids",[])), ephemeral=True)
        elif cid == "acfg_ch": await interaction.response.send_message(view=single_channel_view("addcargo_panel_channel_id","Canal Painel /addcargo"), ephemeral=True)
        elif cid == "acfg_post": await post_addcargo_panel(interaction)
        elif cid == "acfg_preview": await interaction.response.send_message(view=addcargo_public_panel(), ephemeral=True)
        elif cid == "addcargo_open":
            if not user_can_use_addcargo(interaction.user):
                await interaction.response.send_message("❌ Sem permissão.", ephemeral=True); return
            await interaction.response.send_message(view=build_addcargo_panel(), ephemeral=True)
        # PAINEL FIXO
        elif cid == "pf_ch": await interaction.response.send_message(view=single_channel_view("painel_channel_id","Canal Painel"), ephemeral=True)
        # TICKETS
        elif cid == "tk_cat_movcall": await interaction.response.send_message(view=single_category_view("ticket_category_movcall_id","Categoria MOV CALL"), ephemeral=True)
        elif cid == "tk_cat_movchat": await interaction.response.send_message(view=single_category_view("ticket_category_movchat_id","Categoria MOV CHAT"), ephemeral=True)
        elif cid == "tk_cat_recrute": await interaction.response.send_message(view=single_category_view("ticket_category_recrute_id","Categoria RECRUTE-S"), ephemeral=True)
        elif cid == "tk_cat_support": await interaction.response.send_message(view=single_category_view("ticket_category_support_id","Categoria SUPORTE"), ephemeral=True)
        elif cid == "tk_cat_others": await interaction.response.send_message(view=single_category_view("ticket_category_others_id","Categoria OUTROS"), ephemeral=True)
        elif cid == "tk_sup": await interaction.response.send_message(view=multi_role_view("ticket_support_role_ids","Cargos Staff",config.get("ticket_support_role_ids",[])), ephemeral=True)
        elif cid == "tk_logs": await interaction.response.send_message(view=single_channel_view("ticket_logs_channel_id","Logs Tickets"), ephemeral=True)
        elif cid == "tk_panel": await interaction.response.send_message(view=single_channel_view("ticket_panel_channel_id","Canal Painel"), ephemeral=True)
        elif cid == "tk_mod": await interaction.response.send_message(view=single_channel_view("moderation_logs_channel_id","Logs Moderação"), ephemeral=True)
        elif cid == "tk_customize": await interaction.response.send_message(view=ticket_panel_custom_view(), ephemeral=True)
        elif cid == "tpc_title": await interaction.response.send_modal(GenericTextModal("ticket_panel_title","✏️ Título","Título",config.get("ticket_panel_title") or "",discord.TextStyle.short,200))
        elif cid == "tpc_desc": await interaction.response.send_modal(GenericTextModal("ticket_panel_description","📝 Descrição","Descrição",config.get("ticket_panel_description") or "",discord.TextStyle.paragraph,2000))
        elif cid == "tpc_banner": await interaction.response.send_modal(URLModal("banner_ticket_url","Banner Ticket"))
        elif cid == "tpc_ph": await interaction.response.send_modal(GenericTextModal("ticket_panel_select_placeholder","Placeholder","Placeholder",config.get("ticket_panel_select_placeholder") or "",discord.TextStyle.short,150))
        elif cid == "tpc_dlabel": await interaction.response.send_modal(GenericTextModal("ticket_label_movcall","Label MOV CALL","Label",config.get("ticket_label_movcall") or "",discord.TextStyle.short,100))
        elif cid == "tpc_demoji": await interaction.response.send_modal(GenericTextModal("ticket_emoji_movcall","Emoji MOV CALL","Emoji",config.get("ticket_emoji_movcall") or "",discord.TextStyle.short,10))
        elif cid == "tpc_plabel": await interaction.response.send_modal(GenericTextModal("ticket_label_movchat","Label MOV CHAT","Label",config.get("ticket_label_movchat") or "",discord.TextStyle.short,100))
        elif cid == "tpc_pemoji": await interaction.response.send_modal(GenericTextModal("ticket_emoji_movchat","Emoji MOV CHAT","Emoji",config.get("ticket_emoji_movchat") or "",discord.TextStyle.short,10))
        elif cid == "tpc_refresh":
            await interaction.response.defer(ephemeral=True)
            ok = await refresh_ticket_panel()
            await interaction.followup.send("✅" if ok else "❌", ephemeral=True)
        elif cid == "tpc_preview": await interaction.response.send_message(view=ticket_panel_layout(), ephemeral=True)
        # FEEDBACK
        elif cid == "fbp_ch": await interaction.response.send_message(view=single_channel_view("feedback_panel_channel_id","Painel Feedback"), ephemeral=True)
        elif cid == "fbp_log": await interaction.response.send_message(view=single_channel_view("feedback_channel_id","Logs Feedback"), ephemeral=True)
        elif cid == "fbp_post":
            cid_ch = config.get("feedback_panel_channel_id")
            if not cid_ch:
                await interaction.response.send_message("❌ Defina o canal primeiro.", ephemeral=True); return
            ch = interaction.guild.get_channel(cid_ch)
            msg = await ch.send(view=feedback_panel_layout())
            config["feedback_panel_message_id"] = msg.id; save_config(config)
            await interaction.response.send_message("✅", ephemeral=True)
        elif cid == "fbp_prev": await interaction.response.send_message(view=feedback_panel_layout(), ephemeral=True)
        elif cid == "fbp_title": await interaction.response.send_modal(GenericTextModal("feedback_panel_title","✏️ Título","Título",config.get("feedback_panel_title") or "",discord.TextStyle.short,200))
        elif cid == "fbp_desc": await interaction.response.send_modal(GenericTextModal("feedback_panel_description","📝 Descrição","Descrição",config.get("feedback_panel_description") or "",discord.TextStyle.paragraph,2000))
        elif cid == "fb_open_modal": await interaction.response.send_modal(DirectFeedbackModal())
        elif cid == "fb_help_btn":
            await interaction.response.send_message("### ❓ Como funciona\n> 1. Escolha nota de 1 a 5\n> 2. Comentário opcional\n> 3. Envie", ephemeral=True)
        # SUGESTÕES
        elif cid.startswith("sug_up_") or cid.startswith("sug_down_"):
            await handle_suggestion_vote(interaction, cid)
        elif cid == "sug_rules_btn":
            await interaction.response.send_message("### 📜 Regras\n> 1. Seja claro\n> 2. Sem spam\n> 3. Vote consciente", ephemeral=True)
        elif cid == "suggest_btn": await interaction.response.send_modal(SuggestionModal())
        elif cid == "sg_pch": await interaction.response.send_message(view=single_channel_view("suggestions_panel_channel_id","Painel Sugestões"), ephemeral=True)
        elif cid == "sg_ch": await interaction.response.send_message(view=single_channel_view("suggestions_channel_id","Canal Sugestões"), ephemeral=True)
        elif cid == "sg_refresh":
            await interaction.response.defer(ephemeral=True)
            await interaction.followup.send("✅", ephemeral=True)
        elif cid == "sg_prev": await interaction.response.send_message(view=suggestion_panel_layout(), ephemeral=True)
        # LEVELS
        elif cid == "lv_toggle":
            config["levels_enabled"] = not config.get("levels_enabled", True)
            save_config(config)
            await interaction.response.send_message(f"✅ Níveis: {'ON' if config['levels_enabled'] else 'OFF'}", ephemeral=True)
        elif cid == "lv_xp": await interaction.response.send_modal(GenericTextModal("levels_xp_per_message","XP por Msg","XP",str(config.get("levels_xp_per_message",15)),discord.TextStyle.short,10))
        elif cid == "lv_cd": await interaction.response.send_modal(GenericTextModal("levels_xp_cooldown_seconds","Cooldown","Segundos",str(config.get("levels_xp_cooldown_seconds",60)),discord.TextStyle.short,10))
        elif cid == "lv_ch": await interaction.response.send_message(view=single_channel_view("levels_announce_channel_id","Canal Anúncio"), ephemeral=True)
        elif cid == "lv_msg": await interaction.response.send_modal(GenericTextModal("levels_message_up","Mensagem Level Up","Use {user}, {level}, {xp}",config.get("levels_message_up") or "",discord.TextStyle.paragraph,500))
        elif cid == "lv_rank": await interaction.response.send_message("⚠️ Use `/rank` no chat", ephemeral=True)
        elif cid == "lv_rewards":
            await interaction.response.send_message("⚠️ Use `/levelrewards` no chat", ephemeral=True)
        # FILTERS
        elif cid == "ft_toggle":
            config["filters_enabled"] = not config.get("filters_enabled", True)
            save_config(config)
            await interaction.response.send_message(f"✅ Filtros: {'ON' if config['filters_enabled'] else 'OFF'}", ephemeral=True)
        elif cid == "ft_words":
            await interaction.response.send_modal(GenericTextModal("filters_blocked_words","Palavras Bloqueadas","Uma por linha",
                "\n".join(config.get("filters_blocked_words") or []),discord.TextStyle.paragraph,2000))
        elif cid == "ft_domains":
            await interaction.response.send_modal(GenericTextModal("filters_allowed_domains","Domínios Permitidos","Um por linha",
                "\n".join(config.get("filters_allowed_domains") or []),discord.TextStyle.paragraph,2000))
        elif cid == "ft_roles": await interaction.response.send_message(view=multi_role_view("filters_links_allowed_role_ids","Podem Link",config.get("filters_links_allowed_role_ids",[])), ephemeral=True)
        elif cid == "ft_log": await interaction.response.send_message(view=single_channel_view("filters_log_channel_id","Log Filtros"), ephemeral=True)
        elif cid == "ft_punish": await interaction.response.send_modal(GenericTextModal("filters_punish_after_warnings","Avisos até Castigo","Avisos",str(config.get("filters_punish_after_warnings",3)),discord.TextStyle.short,3))
        # VIP
        elif cid == "vip_toggle":
            config["vip_enabled"] = not config.get("vip_enabled", True)
            save_config(config)
            await interaction.response.send_message(f"✅ VIP: {'ON' if config['vip_enabled'] else 'OFF'}", ephemeral=True)
        elif cid == "vip_base": await interaction.response.send_message(view=single_role_view("vip_role_base_id","Cargo Base VIP",config.get("vip_role_base_id")), ephemeral=True)
        elif cid == "vip_perm_color":
            config["vip_allow_custom_color"] = not config.get("vip_allow_custom_color", True)
            save_config(config); await interaction.response.send_message("✅", ephemeral=True)
        elif cid == "vip_perm_name":
            config["vip_allow_custom_name"] = not config.get("vip_allow_custom_name", True)
            save_config(config); await interaction.response.send_message("✅", ephemeral=True)
        elif cid == "vip_perm_tag":
            config["vip_allow_custom_tag"] = not config.get("vip_allow_custom_tag", True)
            save_config(config); await interaction.response.send_message("✅", ephemeral=True)
        elif cid == "vip_limit": await interaction.response.send_modal(GenericTextModal("vip_max_members","Limite Membros","Membros",str(config.get("vip_max_members",5)),discord.TextStyle.short,3))
        elif cid == "vip_panel_ch": await interaction.response.send_message(view=single_channel_view("vip_panel_channel_id","Canal Painel VIP"), ephemeral=True)
        # VIP (ações do painel do usuário)
        elif cid == "vip_color": await interaction.response.send_modal(ColorModal(f"vip_user_color_{interaction.user.id}","Nova Cor"))
        elif cid == "vip_name": await interaction.response.send_modal(GenericTextModal(f"vip_user_name_{interaction.user.id}","Nome do Cargo","Novo nome","",discord.TextStyle.short,100))
        elif cid == "vip_tag": await interaction.response.send_modal(GenericTextModal(f"vip_user_tag_{interaction.user.id}","Tag","Nova tag","",discord.TextStyle.short,10))
        elif cid == "vip_give":
            await interaction.response.send_message("⚠️ Use `/vipdar @user` no chat", ephemeral=True)
        elif cid == "vip_remove":
            await interaction.response.send_message("⚠️ Use `/vipremover @user` no chat", ephemeral=True)
        # STAFF
        elif cid == "stf_roles": await interaction.response.send_message(view=multi_role_view("staff_role_ids","Cargos Staff",config.get("staff_role_ids",[])), ephemeral=True)
        elif cid == "stf_movchat": await interaction.response.send_message(view=multi_role_view("staff_movchat_role_ids","Cargos MOV CHAT",config.get("staff_movchat_role_ids",[])), ephemeral=True)
        elif cid == "stf_goal_msg": await interaction.response.send_modal(GenericTextModal("staff_movchat_goal","Meta Msgs","Mensagens",str(config.get("staff_movchat_goal",1000)),discord.TextStyle.short,6))
        elif cid == "stf_goal_call": await interaction.response.send_modal(GenericTextModal("staff_call_goal_hours","Meta Horas","Horas",str(config.get("staff_call_goal_hours",30)),discord.TextStyle.short,3))
        elif cid == "stf_report": await interaction.response.send_message(view=single_channel_view("staff_report_channel_id","Canal Relatórios"), ephemeral=True)
        elif cid == "stf_punish": await interaction.response.send_message(view=single_channel_view("staff_punish_channel_id","Canal Punições"), ephemeral=True)
        elif cid == "stf_threshold": await interaction.response.send_modal(GenericTextModal("staff_warn_ban_threshold","Avisos p/ Ban","Avisos",str(config.get("staff_warn_ban_threshold",3)),discord.TextStyle.short,3))
        elif cid == "stf_open_panel": await interaction.response.send_message(view=staff_panel_layout(), ephemeral=True)
        elif cid == "staff_mute": await interaction.response.send_message("⚠️ Use `/mutar @user` no chat", ephemeral=True)
        elif cid == "staff_punish": await interaction.response.send_message("⚠️ Use `/castigar @user` no chat", ephemeral=True)
        elif cid == "staff_purge": await interaction.response.send_message("⚠️ Use `/limparchat` no chat", ephemeral=True)
        elif cid == "staff_punishments": await interaction.response.send_message("⚠️ Use `/punições @user` no chat", ephemeral=True)
        elif cid == "staff_rank_all":
            await interaction.response.defer(ephemeral=True)
            g = interaction.guild
            staff_roles = set(config.get("staff_role_ids") or [])
            entries = []
            for m in g.members:
                if any(r.id in staff_roles for r in m.roles):
                    secs = get_staff_call_seconds(m.id, g.id, days=30)
                    msgs = get_staff_message_count(m.id, g.id, days=30)
                    entries.append({"user_id": m.id, "seconds_hours": secs/3600, "messages": msgs})
            entries.sort(key=lambda x: (-x["seconds_hours"], -x["messages"]))
            await interaction.followup.send(view=staff_rank_layout(entries[:15], "🏆 Rank Staff (30d)"), ephemeral=True)
        elif cid == "staff_rank_me":
            await interaction.response.defer(ephemeral=True)
            secs = get_staff_call_seconds(interaction.user.id, interaction.guild.id, days=30)
            msgs = get_staff_message_count(interaction.user.id, interaction.guild.id, days=30)
            actions = get_staff_actions(interaction.user.id, interaction.guild.id, days=30)
            await interaction.followup.send(
                f"### 📊 Seu Relatório (30d)\n"
                f"> **Horas em Call:** `{secs/3600:.1f}h`\n"
                f"> **Mensagens:** `{msgs}`\n"
                f"> **Ações Staff:** `{actions}`", ephemeral=True)
        elif cid == "staff_movchat":
            await interaction.response.defer(ephemeral=True)
            g = interaction.guild
            staff_roles = set(config.get("staff_role_ids") or [])
            movchat_roles = set(config.get("staff_movchat_role_ids") or staff_roles)
            goal = int(config.get("staff_movchat_goal", 1000))
            lines = ["### 💬 MOV CHAT — Mensagens (30d)\n"]
            for m in g.members:
                if any(r.id in staff_roles for r in m.roles):
                    cnt = get_staff_message_count(m.id, g.id, days=30)
                    pct = int(cnt/goal*100) if goal > 0 else 0
                    bar_len = 12
                    f = min(bar_len, int(bar_len*cnt/goal)) if goal > 0 else 0
                    lines.append(f"**{m.display_name}** — `{cnt}/{goal}` `[{'█'*f}{'░'*(bar_len-f)}]` **{pct}%**")
            if len(lines) == 1: lines.append("_Nenhum staff com cargos configurados._")
            await interaction.followup.send("\n".join(lines[:30]), ephemeral=True)
        elif cid == "staff_callhours":
            await interaction.response.defer(ephemeral=True)
            g = interaction.guild
            staff_roles = set(config.get("staff_role_ids") or [])
            goal = int(config.get("staff_call_goal_hours", 30)) * 3600
            lines = ["### 🎙️ Horas em Call (30d)\n"]
            for m in g.members:
                if any(r.id in staff_roles for r in m.roles):
                    secs = get_staff_call_seconds(m.id, g.id, days=30)
                    pct = int(secs/goal*100) if goal > 0 else 0
                    lines.append(f"**{m.display_name}** — `{secs/3600:.1f}h / {goal/3600:.0f}h` **{pct}%**")
            if len(lines) == 1: lines.append("_Nenhum staff._")
            await interaction.followup.send("\n".join(lines[:30]), ephemeral=True)
        elif cid == "back_staff":
            await interaction.response.edit_message(view=staff_panel_layout())
        # CLEANUP
        elif cid == "cleanup_voice_open":
            await interaction.response.send_message("⚠️ Use `/limparchatvoz` no chat", ephemeral=True)
        # VOLTAR
        elif cid == "back_main":
            await interaction.response.edit_message(view=painel_layout())
        # VERIFICAÇÃO
        elif cid == "verify_now": await handle_captcha_start(interaction)
        elif cid == "captcha_solve": await interaction.response.send_modal(CaptchaModal.from_button(interaction))
        elif cid == "captcha_button_verify": await handle_button_verify(interaction)
        elif cid == "verify_disabled":
            await interaction.response.send_message("❌ Verificação desativada.", ephemeral=True)
        # TICKET AÇÕES
        elif cid == "close_ticket":
            await interaction.response.send_message("⚠️ Fechar?", view=ConfirmCloseView(interaction.channel.id), ephemeral=True)
        elif cid == "add_member":
            await interaction.response.send_message(view=AddMemberView(), ephemeral=True)
        elif cid == "edit_ticket_name":
            await interaction.response.send_modal(TicketNameModal(interaction.channel.name))
    except discord.errors.NotFound: pass
    except discord.errors.InteractionResponded: pass
    except Exception as e:
        logger.error(f"interaction {cid}: {e}", exc_info=True)

async def handle_suggestion_vote(interaction, custom_id):
    parts = custom_id.split("_"); vt = parts[1]
    try: sid = int(parts[2])
    except (IndexError, ValueError):
        await interaction.response.send_message("❌", ephemeral=True); return
    up, down, acao = vote_suggestion(sid, interaction.user.id, vt)
    s = get_suggestion(sid)
    if not s:
        await interaction.response.send_message("❌", ephemeral=True); return
    author = interaction.guild.get_member(s["user_id"]) or interaction.user
    card = suggestion_card_layout(sid, author, s["content"], up, down, s["status"] or "open")
    await interaction.response.edit_message(view=card)
    msgs = {"added":"✅","changed":"🔄","removed":"↩️"}
    try: await interaction.followup.send(msgs.get(acao, "✅"), ephemeral=True)
    except Exception: pass

# ===================== POSTS =====================
async def post_antibot_panel(interaction):
    cid = config.get("antibot_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Defina o canal.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Inválido.", ephemeral=True); return
    try: msg = await ch.send(view=antibot_panel_view())
    except Exception as e:
        await interaction.response.send_message(f"❌ {e}", ephemeral=True); return
    config["antibot_panel_message_id"] = msg.id; save_config(config)
    await interaction.response.send_message(f"✅ {ch.mention}", ephemeral=True)

async def post_addcargo_panel(interaction):
    cid = config.get("addcargo_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Defina o canal.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Inválido.", ephemeral=True); return
    try: msg = await ch.send(view=addcargo_public_panel())
    except Exception as e:
        await interaction.response.send_message(f"❌ {e}", ephemeral=True); return
    config["addcargo_panel_message_id"] = msg.id; save_config(config)
    await interaction.response.send_message(f"✅ {ch.mention}", ephemeral=True)

# ===================== ADD CARGO PANEL =====================
def user_can_use_addcargo(member):
    if not isinstance(member, discord.Member): return False
    if member.guild_permissions.administrator: return True
    allowed = config.get("addcargo_allowed_role_ids", []) or []
    return any(r.id in allowed for r in member.roles)

def build_addcargo_panel():
    state = {"roles":[],"user":None}
    layout = ui.LayoutView(timeout=600)
    role_select = ui.RoleSelect(placeholder="👑 Cargos", min_values=1, max_values=10)
    user_select = ui.UserSelect(placeholder="👤 Usuário", min_values=1, max_values=1)
    confirm = ui.Button(label="Aplicar", style=SU, emoji=E("verificado"))
    cancel = ui.Button(label="Cancelar", style=D)
    async def on_roles(i):
        state["roles"] = list(role_select.values)
        try: await i.response.defer()
        except Exception: pass
    async def on_user(i):
        vals = user_select.values; state["user"] = vals[0] if vals else None
        try: await i.response.defer()
        except Exception: pass
    async def on_confirm(i):
        roles, user = state["roles"], state["user"]
        if not roles or not user:
            await i.response.send_message("❌ Selecione cargo e usuário.", ephemeral=True); return
        me = i.guild.me
        if not me.guild_permissions.manage_roles:
            await i.response.send_message("❌ Sem perm Gerenciar Cargos.", ephemeral=True); return
        target = user if isinstance(user, discord.Member) else i.guild.get_member(user.id)
        if not target:
            await i.response.send_message("❌ Usuário fora do servidor.", ephemeral=True); return
        applied, failed = [], []
        for role in roles:
            if role.is_default() or role >= me.top_role or role in target.roles:
                failed.append(role.mention); continue
            try: await target.add_roles(role, reason=f"{i.user} via painel"); applied.append(role.mention)
            except Exception: failed.append(role.mention)
        parts = []
        if applied: parts.append(f"✅ **Adicionados a {target.mention}:**\n" + "\n".join(f"• {r}" for r in applied))
        if failed: parts.append(f"❌ **Falhas:**\n" + "\n".join(f"• {r}" for r in failed))
        await i.response.send_message("\n\n".join(parts) or "✅", ephemeral=True)
    async def on_cancel(i):
        try: await i.response.edit_message(view=None)
        except Exception: pass
    role_select.callback = on_roles; user_select.callback = on_user
    confirm.callback = on_confirm; cancel.callback = on_cancel
    layout.add_item(ui.Container(
        ui.TextDisplay("# ➕ Adicionar Cargos"),
        ui.Section(ui.TextDisplay("Selecione **cargos** e **usuário**."),
                   accessory=ui.Thumbnail(media=_thumb())),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(role_select), ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(user_select), ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(confirm, cancel), accent_color=c_primary()))
    return layout

# ===================== REFRESH / AUX =====================
async def refresh_ticket_panel():
    cid = config.get("ticket_panel_channel_id")
    if not cid: return False
    g = get_guild()
    if not g: return False
    ch = g.get_channel(cid)
    if not ch: return False
    mid = config.get("ticket_panel_message_id")
    if mid:
        try:
            msg = await ch.fetch_message(mid)
            await msg.edit(view=ticket_panel_layout()); return True
        except Exception: pass
    try:
        msg = await ch.send(view=ticket_panel_layout())
        config["ticket_panel_message_id"] = msg.id; save_config(config); return True
    except Exception: return False

async def refresh_all_panels():
    for ch_key, msg_key, builder in [
        ("painel_channel_id","painel_message_id", painel_layout),
        ("feedback_panel_channel_id","feedback_panel_message_id", feedback_panel_layout),
        ("suggestions_panel_channel_id","suggestions_panel_message_id", suggestion_panel_layout),
        ("verification_panel_channel_id","verification_panel_message_id", verification_panel_layout),
        ("addcargo_panel_channel_id","addcargo_panel_message_id", addcargo_public_panel),
        ("antibot_channel_id","antibot_panel_message_id", antibot_panel_view),
    ]:
        cid = config.get(ch_key); mid = config.get(msg_key)
        if not cid or not mid: continue
        g = get_guild()
        if not g: continue
        ch = g.get_channel(cid)
        if not ch: continue
        try:
            msg = await ch.fetch_message(mid)
            await msg.edit(view=builder())
        except Exception: pass

async def apply_avatar_if_needed(force=False):
    url = avatar_url()
    if not url: return False
    if not force and config.get("_last_avatar_url") == url: return True
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(url) as r:
                if r.status != 200: return False
                data = await r.read()
        await bot.user.edit(avatar=data)
        config["_last_avatar_url"] = url; save_config(config); return True
    except Exception as e:
        logger.warning(f"avatar: {e}"); return False

async def _play_silence(vc):
    if not FFMPEG_AVAILABLE or not vc or not vc.is_connected(): return
    if vc.is_playing() or vc.is_paused(): return
    try:
        src = discord.FFmpegPCMAudio("anullsrc=channel_layout=stereo:sample_rate=48000",
                                      before_options="-f lavfi", options="-t 300")
        vc.play(src)
    except Exception: pass

async def bot_join_voice():
    g = get_guild()
    if not g: return
    cid = config.get("voice_channel_id")
    if not cid: return
    ch = g.get_channel(cid)
    if not ch or not isinstance(ch, discord.VoiceChannel): return
    try:
        if not g.voice_client: await ch.connect(timeout=15.0, reconnect=True)
        else: await g.voice_client.move_to(ch)
        await update_voice_name_impl(); await update_voice_mute()
        await _play_silence(g.voice_client)
    except Exception as e: logger.warning(f"voz: {e}")

# ===================== AUTO-EMOJI =====================
CHANNEL_EMOJI_RULES = {
    ("bemvindo","bem-vindo","welcome","entrada"): "✨",
    ("saiu","saida","leave","despedida"): "🔒",
    ("regras","regra","rules"): "📜",
    ("aviso","avisos","anuncio","announcement"): "📢",
    ("chat","geral","general","conversa"): "💬",
    ("ticket","tickets","suporte","support"): "🎫",
    ("sugestao","sugestão","suggestions"): "💡",
    ("feedback","avaliacao","review"): "⭐",
    ("bot","comando","commands"): "🤖",
    ("musica","music"): "🎵",
    ("call","voz","voice","vocal"): "🔊",
    ("foto","midia","media","galeria"): "📸",
    ("membro","membros","members"): "👥",
    ("verificacao","verify"): "✅",
    ("log","logs"): "📋",
    ("nitro","boost"): "🚀",
    ("parceria","partner"): "🤝",
    ("level","nivel","rank"): "🏆",
    ("jogo","game","gaming"): "🎮",
    ("evento","event","sorteio","giveaway"): "🎉",
    ("meme","humor"): "😂",
    ("arte","art","desenho"): "🎨",
    ("filme","movie","serie"): "🎬",
    ("anime","manga","otaku"): "🌸",
    ("presente","gift","doacao"): "🎁",
    ("dica","tips","tutorial"): "📚",
    ("duvida","pergunta"): "❓",
    ("compra","shop","loja","venda"): "🛒",
    ("status","info"): "ℹ️",
    ("confissao","desabafo"): "💭",
    ("amizade","friend","amigo"): "💖",
    ("roleplay","rpg"): "🎭",
    ("stream","live","twitch"): "📺",
    ("enquete","poll","votacao"): "📊",
    ("comunidade","community"): "🌐",
    ("apresentacao","intro"): "👋",
    ("cargo","role","cargos"): "👑",
    ("premio","recompensa","reward"): "🏅",
    ("aniversario","birthday","niver"): "🎂",
    ("namoro","casal","love"): "💕",
    ("minecraft","mc"): "⛏️",
}
EMOJI_SEPARATOR = "・"
_EMOJI_PREFIX_RE = re.compile(r'^([\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2190-\u21FF\u2000-\u3300\uFE0F]+)\s*[・•|·\-_]\s*(.+)$')

def _split_emoji_prefix(name):
    m = _EMOJI_PREFIX_RE.match(name)
    if m: return m.group(1), m.group(2).strip()
    return None, name.strip()

def _normalize_name(n):
    n = n.lower(); n = re.sub(r'[・•·|_\-]+','',n); return re.sub(r'\s+','',n)

def _find_emoji_for_name(name):
    nn = _normalize_name(name)
    if not nn: return None
    for kws, em in CHANNEL_EMOJI_RULES.items():
        for kw in kws:
            if _normalize_name(kw) in nn: return em
    return None

async def auto_emoji_channel(channel):
    if not config.get("auto_emoji_channels", True): return False
    if not isinstance(channel, (discord.TextChannel, discord.VoiceChannel, discord.CategoryChannel, discord.ForumChannel)): return False
    if channel.name.startswith("verificar-") or channel.name.startswith("ticket-"): return False
    cur, base = _split_emoji_prefix(channel.name)
    if not base: return False
    em = _find_emoji_for_name(base) or cur
    if not em: return False
    new = f"{em}{EMOJI_SEPARATOR}{base}"
    if new == channel.name or len(new) > 100: return False
    try:
        await channel.edit(name=new, reason="Auto-emoji")
        return True
    except Exception: return False

async def sync_all_channels_emoji(guild):
    total = 0
    for ch in list(guild.channels):
        try:
            if await auto_emoji_channel(ch):
                total += 1; await asyncio.sleep(0.7)
        except Exception: pass
    return total

# ===================== COMANDOS =====================
@bot.tree.command(name="painelpxkadmin", description="🖤 Painel administrativo")
@app_commands.default_permissions(administrator=True)
async def cmd_painel(interaction):
    cid = config.get("painel_channel_id")
    if cid:
        ch = interaction.guild.get_channel(cid)
        if ch and config.get("painel_message_id"):
            try:
                msg = await ch.fetch_message(config["painel_message_id"])
                await msg.edit(view=painel_layout())
                await interaction.response.send_message(f"✅ Atualizado em {ch.mention}", ephemeral=True)
                return
            except Exception: pass
    msg = await interaction.channel.send(view=painel_layout())
    config["painel_channel_id"] = interaction.channel.id
    config["painel_message_id"] = msg.id; save_config(config)
    await interaction.response.send_message("✅ Painel enviado!", ephemeral=True)

@bot.tree.command(name="painelticket", description="🎫 Painel de tickets")
@app_commands.default_permissions(administrator=True)
async def cmd_pt(interaction):
    cid = config.get("ticket_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Defina o canal.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Inválido.", ephemeral=True); return
    msg = await ch.send(view=ticket_panel_layout())
    config["ticket_panel_message_id"] = msg.id; save_config(config)
    await interaction.response.send_message(f"✅ {ch.mention}", ephemeral=True)

@bot.tree.command(name="painelverificacao", description="✅ Painel de verificação")
@app_commands.default_permissions(administrator=True)
async def cmd_pv(interaction):
    cid = config.get("verification_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Defina o canal.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Inválido.", ephemeral=True); return
    msg = await ch.send(view=verification_panel_layout())
    config["verification_panel_message_id"] = msg.id; save_config(config)
    await interaction.response.send_message(f"✅ {ch.mention}", ephemeral=True)

@bot.tree.command(name="painelfeedback", description="⭐ Painel de avaliações")
@app_commands.default_permissions(administrator=True)
async def cmd_pfb(interaction):
    cid = config.get("feedback_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Defina o canal.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Inválido.", ephemeral=True); return
    msg = await ch.send(view=feedback_panel_layout())
    config["feedback_panel_message_id"] = msg.id; save_config(config)
    await interaction.response.send_message(f"✅ {ch.mention}", ephemeral=True)

@bot.tree.command(name="painelsugestoes", description="💡 Painel de sugestões")
@app_commands.default_permissions(administrator=True)
async def cmd_ps(interaction):
    cid = config.get("suggestions_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Defina o canal.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Inválido.", ephemeral=True); return
    msg = await ch.send(view=suggestion_panel_layout())
    config["suggestions_panel_message_id"] = msg.id; save_config(config)
    await interaction.response.send_message(f"✅ {ch.mention}", ephemeral=True)

@bot.tree.command(name="painelantibot", description="🚫 Painel Anti-Bot")
@app_commands.default_permissions(administrator=True)
async def cmd_pab(interaction):
    cid = config.get("antibot_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Defina o canal.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Inválido.", ephemeral=True); return
    msg = await ch.send(view=antibot_panel_view())
    config["antibot_panel_message_id"] = msg.id; save_config(config)
    await interaction.response.send_message(f"✅ {ch.mention}", ephemeral=True)

@bot.tree.command(name="paineladdcargo", description="➕ Painel /addcargo")
@app_commands.default_permissions(administrator=True)
async def cmd_pac(interaction):
    cid = config.get("addcargo_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Defina o canal.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Inválido.", ephemeral=True); return
    msg = await ch.send(view=addcargo_public_panel())
    config["addcargo_panel_message_id"] = msg.id; save_config(config)
    await interaction.response.send_message(f"✅ {ch.mention}", ephemeral=True)

@bot.tree.command(name="painelstaff", description="👮 Painel Staff")
async def cmd_pstaff(interaction):
    staff_roles = set(config.get("staff_role_ids") or [])
    if not interaction.user.guild_permissions.administrator and not any(r.id in staff_roles for r in interaction.user.roles):
        await interaction.response.send_message("❌ Sem permissão.", ephemeral=True); return
    await interaction.response.send_message(view=staff_panel_layout(), ephemeral=True)

@bot.tree.command(name="painelvip", description="💎 Painel VIP")
async def cmd_pvip(interaction):
    await _open_vip_panel(interaction)

@bot.tree.command(name="sincronizaremojis", description="✨ Sincroniza auto-emojis")
@app_commands.default_permissions(administrator=True)
async def cmd_se(interaction):
    await interaction.response.defer(ephemeral=True)
    total = await sync_all_channels_emoji(interaction.guild)
    await interaction.followup.send(f"✨ {total} canais atualizados!", ephemeral=True)

@bot.tree.command(name="addcargo", description="➕ Adiciona cargo")
@app_commands.describe(cargo="Cargo", usuario="Usuário")
async def cmd_ac(interaction, cargo: discord.Role = None, usuario: discord.Member = None):
    if not user_can_use_addcargo(interaction.user):
        await interaction.response.send_message("❌ Sem permissão.", ephemeral=True); return
    if cargo is None and usuario is None:
        await interaction.response.send_message(view=build_addcargo_panel(), ephemeral=True); return
    if not cargo or not usuario:
        await interaction.response.send_message("❌ Use ambos ou nenhum.", ephemeral=True); return
    me = interaction.guild.me
    if not me.guild_permissions.manage_roles or cargo.is_default() or cargo >= me.top_role or cargo in usuario.roles:
        await interaction.response.send_message("❌ Impossível aplicar.", ephemeral=True); return
    try: await usuario.add_roles(cargo, reason=f"Adicionado por {interaction.user}")
    except Exception as e:
        await interaction.response.send_message(f"❌ {e}", ephemeral=True); return
    await interaction.response.send_message(f"✅ {cargo.mention} → {usuario.mention}", ephemeral=True)

@bot.tree.command(name="limparchat", description="🧹 Limpa canal de texto")
@app_commands.default_permissions(administrator=True)
@app_commands.describe(canal="Canal")
async def cmd_lc(interaction, canal: discord.TextChannel):
    p = canal.permissions_for(interaction.guild.me)
    if not (p.manage_messages and p.read_message_history):
        await interaction.response.send_message("❌ Sem permissão.", ephemeral=True); return
    await interaction.response.defer(ephemeral=True)
    start = datetime.datetime.now()
    pmsg = await interaction.edit_original_response(view=_build_cleanup_progress_view(0, 1, None, 0, start))
    lu = {"t": datetime.datetime.now()}
    async def cb(d, phase):
        now = datetime.datetime.now()
        if (now-lu["t"]).total_seconds() < 1.8: return
        lu["t"] = now
        try: await pmsg.edit(view=_build_cleanup_progress_view(0, 1, canal, d, start, phase))
        except Exception: pass
    total, erro = await _purge_channel(canal, interaction.guild, cb)
    el = (datetime.datetime.now()-start).total_seconds(); m, s = int(el//60), int(el%60)
    summary = f"### ✅ Resumo\n**Tempo:** `{m:02d}m {s:02d}s`\n**Apagadas:** `{total}`\n**Canal:** {canal.mention}"
    if erro: summary += f"\n**Erro:** `{erro}`"
    await pmsg.edit(view=_build_cleanup_final_view(summary))

@bot.tree.command(name="rank", description="🏆 Ver seu rank")
async def cmd_rank(interaction, usuario: discord.Member = None):
    u = usuario or interaction.user
    if not interaction.guild:
        await interaction.response.send_message("❌ Use no servidor.", ephemeral=True); return
    data = get_user_level(u.id, interaction.guild.id)
    if not data:
        await interaction.response.send_message(f"ℹ️ {u.mention} ainda não tem XP.", ephemeral=True); return
    lvl = data["level"]; xp = data["xp"]
    need = _calc_xp_for_next_level(lvl)
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(
        ui.TextDisplay(f"# 🏆 Rank — {u.display_name}"),
        ui.Section(ui.TextDisplay(f"### Level {lvl}\n-# {u.mention}"),
                   accessory=ui.Thumbnail(media=u.display_avatar.with_size(256).url)),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.TextDisplay(f"**XP Total:** `{xp}`\n**Próximo:** `{need - (xp % need if need else xp)}` XP\n**Mensagens:** `{data['messages']}`"),
        accent_color=c_panel("levels", 0xFFD700)))
    await interaction.response.send_message(view=layout)

@bot.tree.command(name="levelrewards", description="🎁 Gerenciar cargos por nível")
@app_commands.default_permissions(administrator=True)
async def cmd_lr(interaction):
    rewards = get_level_rewards(interaction.guild.id)
    lines = ["### 🎁 Recompensas por Nível\n"]
    for lvl, rid in sorted(rewards.items()):
        r = interaction.guild.get_role(rid)
        if r: lines.append(f"**Level {lvl}** → {r.mention}")
    if not rewards: lines.append("_Nenhuma recompensa configurada._")
    lines.append("\n-# Use `/setlevelreward <nível> <cargo>` para adicionar")
    await interaction.response.send_message("\n".join(lines), ephemeral=True)

@bot.tree.command(name="setlevelreward", description="🎁 Define cargo para nível")
@app_commands.default_permissions(administrator=True)
@app_commands.describe(nivel="Nível", cargo="Cargo")
async def cmd_slr(interaction, nivel: int, cargo: discord.Role):
    set_level_reward(interaction.guild.id, nivel, cargo.id)
    await interaction.response.send_message(f"✅ Level **{nivel}** → {cargo.mention}", ephemeral=True)

@bot.tree.command(name="vipdar", description="💎 Dá VIP a um membro")
async def cmd_vipdar(interaction, usuario: discord.Member):
    if not config.get("vip_enabled", True):
        await interaction.response.send_message("❌ VIP desativado.", ephemeral=True); return
    base_id = config.get("vip_role_base_id")
    base = interaction.guild.get_role(base_id) if base_id else None
    if not base or base not in interaction.user.roles:
        await interaction.response.send_message("❌ Você não tem cargo VIP base.", ephemeral=True); return
    members = get_vip_members(interaction.user.id, interaction.guild.id)
    max_m = int(config.get("vip_max_members", 5))
    if len(members) >= max_m:
        await interaction.response.send_message(f"❌ Limite {max_m} atingido.", ephemeral=True); return
    if usuario.id in members:
        await interaction.response.send_message("ℹ️ Já adicionado.", ephemeral=True); return
    try: await usuario.add_roles(base, reason=f"VIP de {interaction.user}")
    except Exception as e:
        await interaction.response.send_message(f"❌ {e}", ephemeral=True); return
    add_vip_member(interaction.user.id, interaction.guild.id, usuario.id)
    await interaction.response.send_message(f"✅ {usuario.mention} recebeu VIP!", ephemeral=True)

@bot.tree.command(name="vipremover", description="💎 Remove VIP de um membro")
async def cmd_viprem(interaction, usuario: discord.Member):
    members = get_vip_members(interaction.user.id, interaction.guild.id)
    if usuario.id not in members:
        await interaction.response.send_message("❌ Não está na sua lista.", ephemeral=True); return
    base_id = config.get("vip_role_base_id")
    base = interaction.guild.get_role(base_id) if base_id else None
    if base:
        try: await usuario.remove_roles(base, reason=f"VIP removido por {interaction.user}")
        except Exception: pass
    remove_vip_member(interaction.user.id, interaction.guild.id, usuario.id)
    await interaction.response.send_message(f"✅ {usuario.mention} removido.", ephemeral=True)

@bot.tree.command(name="mutar", description="🔇 Muta membro")
@app_commands.default_permissions(manage_messages=True)
async def cmd_mute(interaction, usuario: discord.Member, minutos: int = 10, *, motivo: str = "Sem motivo"):
    try:
        await usuario.timeout(datetime.timedelta(minutes=minutos), reason=motivo)
        add_punishment(usuario.id, interaction.guild.id, "timeout", motivo,
                       (datetime.datetime.now()+datetime.timedelta(minutes=minutos)).isoformat(),
                       interaction.user.id)
        log_staff_action(interaction.user.id, interaction.guild.id, "mute", usuario.id, motivo)
        await send_log_card(interaction.channel, "🔇 Usuário Mutado", user=usuario,
            fields=[("⏱️ Duração", f"{minutos} min"),("📄 Motivo", motivo),("👮 Staff", interaction.user.mention)],
            accent=c_danger())
        await interaction.response.send_message(f"✅ {usuario.mention} mutado por {minutos}min.", ephemeral=True)
    except Exception as e:
        await interaction.response.send_message(f"❌ {e}", ephemeral=True)

@bot.tree.command(name="castigar", description="⚡ Aplica castigo (warn)")
@app_commands.default_permissions(manage_messages=True)
async def cmd_punish(interaction, usuario: discord.Member, *, motivo: str = "Sem motivo"):
    try: add_user_warning(usuario.id, interaction.guild.id, motivo, interaction.user.id)
    except Exception: pass
    log_staff_action(interaction.user.id, interaction.guild.id, "warn", usuario.id, motivo)
    count = 0
    try: count = count_user_warnings(usuario.id, interaction.guild.id, days=30)
    except Exception: pass
    await send_log_card(interaction.channel, "⚡ Castigo Aplicado", user=usuario,
        fields=[("📄 Motivo", motivo),("⚠️ Avisos (30d)", f"{count}"),("👮 Staff", interaction.user.mention)],
        accent=c_danger())
    await interaction.response.send_message(f"✅ Aviso para {usuario.mention}.", ephemeral=True)

@bot.tree.command(name="punicoes", description="📋 Ver punições")
@app_commands.default_permissions(manage_messages=True)
async def cmd_punicoes(interaction, usuario: discord.Member):
    puns = get_active_punishments(usuario.id, interaction.guild.id)
    warns = count_user_warnings(usuario.id, interaction.guild.id, days=30)
    if not puns and warns == 0:
        await interaction.response.send_message(f"✅ {usuario.mention} sem punições ativas.", ephemeral=True); return
    lines = [f"### 📋 Punições — {usuario.mention}\n", f"**Avisos (30d):** `{warns}`\n"]
    for p in puns:
        lines.append(f"• **{p['type']}** — {p['reason']}")
    await interaction.response.send_message("\n".join(lines), ephemeral=True)

@bot.tree.command(name="relatorio", description="📊 Relatório de staff")
async def cmd_rel(interaction, usuario: discord.Member = None):
    u = usuario or interaction.user
    if not interaction.guild: return
    secs = get_staff_call_seconds(u.id, interaction.guild.id, days=30)
    msgs = get_staff_message_count(u.id, interaction.guild.id, days=30)
    actions = get_staff_actions(u.id, interaction.guild.id, days=30)
    await interaction.response.send_message(
        f"### 📊 {u.display_name} (30d)\n"
        f"> **Horas em Call:** `{secs/3600:.1f}h`\n"
        f"> **Mensagens:** `{msgs}`\n"
        f"> **Ações Staff:** `{actions}`", ephemeral=True)

@bot.tree.command(name="sincronizar", description="✨ Sincroniza painéis")
@app_commands.default_permissions(administrator=True)
async def cmd_sync(interaction):
    await interaction.response.defer(ephemeral=True)
    try: await refresh_all_panels()
    except Exception: pass
    await interaction.followup.send("✅ Painéis atualizados!", ephemeral=True)

# ===================== TASKS =====================
@tasks.loop(seconds=60)
async def task_voice_keepalive():
    if not FFMPEG_AVAILABLE: return
    g = get_guild()
    if not g: return
    vc = g.voice_client
    if not vc or not vc.is_connected(): return
    if not vc.is_playing() and not vc.is_paused(): await _play_silence(vc)

@tasks.loop(minutes=1)
async def task_voice(): await update_voice_name_impl()

@tasks.loop(seconds=5)
async def task_activity():
    if not config.get("activity_rotate_enabled"): return
    await update_status()

@tasks.loop(minutes=3)
async def task_refresh_panels():
    try: await refresh_all_panels()
    except Exception: pass

@tasks.loop(minutes=2)
async def task_voice_watchdog():
    g = get_guild()
    if not g: return
    cid = config.get("voice_channel_id")
    if not cid: return
    ch = g.get_channel(cid)
    if not ch or not isinstance(ch, discord.VoiceChannel): return
    vc = g.voice_client
    if vc and vc.is_connected(): return
    try:
        if not vc: await ch.connect(timeout=15.0, reconnect=True)
        else: await vc.move_to(ch)
        await update_voice_mute(); await _play_silence(g.voice_client)
    except Exception: pass

@tasks.loop(minutes=10)
async def task_auto_emoji():
    if not config.get("auto_emoji_channels", True): return
    g = get_guild()
    if not g: return
    try: await sync_all_channels_emoji(g)
    except Exception: pass

# ===================== EVENTOS =====================
@bot.event
async def on_ready():
    logger.info(f"{bemoji()} {bname()} conectado como {bot.user}")
    try: init_db()
    except Exception as e: logger.error(f"DB: {e}")
    if not config.get("guild_id") and bot.guilds:
        config["guild_id"] = bot.guilds[0].id; save_config(config)
    try: await bot.tree.sync()
    except Exception as e: logger.error(f"sync: {e}")
    await apply_avatar_if_needed()
    await bot_join_voice()
    await update_status(force=True)
    for t in (task_voice, task_activity, task_refresh_panels, task_voice_watchdog,
              task_reload_config, task_voice_keepalive, task_auto_emoji):
        if not t.is_running(): t.start()
    try: await refresh_all_panels()
    except Exception: pass
    if config.get("auto_emoji_channels", True):
        try:
            g = get_guild()
            if g: await sync_all_channels_emoji(g)
        except Exception: pass

@bot.event
async def on_message(message):
    if message.author.bot: return
    if not message.guild: return
    ab_cid = config.get("antibot_channel_id")
    if ab_cid and message.channel.id == ab_cid:
        await _handle_antibot(message); return
    # Filtros
    if config.get("filters_enabled", True):
        try:
            blocked = await _process_filters(message)
            if blocked: return
        except Exception as e: logger.debug(f"filter: {e}")
    # Níveis
    if config.get("levels_enabled", True):
        try: await _process_levels(message)
        except Exception: pass
    await bot.process_commands(message)

async def _handle_antibot(message):
    guild = message.guild; member = message.author
    try: await message.delete()
    except Exception: pass
    deleted = 0
    if config.get("antibot_delete_messages", True):
        try: deleted = await _delete_all_user_messages(guild, member.id)
        except Exception: pass
    banned = False
    if config.get("antibot_punish_ban", True):
        try:
            await guild.ban(member, reason="AntiBot", delete_message_seconds=0); banned = True
        except Exception: pass
    try: add_antibot_punishment(member.id, guild.id, "Canal protegido", banned=banned, deleted_count=deleted)
    except Exception: pass
    log_id = config.get("antibot_log_channel_id")
    if log_id:
        log_ch = guild.get_channel(log_id)
        if log_ch:
            await send_log_card(log_ch, "🚫 AntiBot — Punição", user=member,
                fields=[("🪤 Canal", message.channel.mention),("🗑️ Apagadas", f"{deleted}"),
                        ("🔨 Banido", "Sim" if banned else "Não")], accent=c_danger())

@bot.event
async def on_member_join(member):
    if member.bot: return
    g = member.guild
    auto_role_id = config.get("auto_role_id")
    if auto_role_id:
        role = g.get_role(auto_role_id)
        if role:
            try: await member.add_roles(role, reason="Auto-cargo")
            except Exception: pass
    try: await send_welcome_message(member)
    except Exception: pass
    mention_ch = config.get("welcome_mention_channel_id")
    if mention_ch:
        ch = g.get_channel(mention_ch)
        if ch:
            try:
                text = config.get("welcome_mention_message") or "Bem-vindo {user}!"
                text = text.replace("{user}", member.mention).replace("{brand}", bname()).replace("{emoji}", bemoji()).replace("{members}", str(g.member_count))
                sent = await ch.send(text)
                await asyncio.create_task(_delete_message_after(sent, config.get("welcome_mention_delete_seconds", 5)))
            except Exception: pass
    if config.get("verification_enabled", True):
        for rid in config.get("verification_unverified_role_ids", []):
            r = g.get_role(rid)
            if r:
                try: await member.add_roles(r)
                except Exception: pass
        ch_id = config.get("verification_channel_id")
        if ch_id:
            try:
                temp = await _create_temp_verification_channel(g, member)
                if temp:
                    await send_captcha_challenge(member, temp)
                    _schedule_verification_timeout(g, member)
            except Exception: pass
        schedule_verification_kick(g, member)
    await update_voice_name_impl(); await update_status(force=True)

@bot.event
async def on_member_remove(member):
    if member.bot: return
    try: await send_leave_message(member)
    except Exception: pass
    cancel_verification_kick(member.guild.id, member.id)
    cancel_verification_timeout(member.guild.id, member.id)
    await _delete_temp_channel(member.guild, member.id, delay=0)
    async def _cleanup():
        try:
            deleted = await _delete_all_user_messages(member.guild, member.id)
            log_id = config.get("moderation_logs_channel_id")
            if log_id:
                log_ch = member.guild.get_channel(log_id)
                if log_ch:
                    fields = [("👥 Total Membros", f"{member.guild.member_count}"),
                              ("🗑️ Msgs Apagadas", f"{deleted}")]
                    if member.joined_at:
                        delta = datetime.datetime.now(datetime.timezone.utc) - member.joined_at
                        fields.insert(0, ("⏳ Tempo", f"{delta.days} dias"))
                    await send_log_card(log_ch, "🧹 Limpeza Pós-Saída", user=member,
                                        fields=fields, accent=c_danger())
        except Exception: pass
    asyncio.create_task(_cleanup())
    _temp_verification_channels.pop(member.id, None)
    await update_voice_name_impl(); await update_status(force=True)

@bot.event
async def on_voice_state_update(member, before, after):
    if member.bot: return
    if before.channel is None and after.channel is not None:
        try: await send_voice_log(member, after.channel, "join")
        except Exception: pass
        staff_roles = set(config.get("staff_role_ids") or [])
        if any(r.id in staff_roles for r in member.roles):
            try: start_staff_call(member.id, member.guild.id, after.channel.id)
            except Exception: pass
    elif before.channel is not None and after.channel is None:
        try: await send_voice_log(member, before.channel, "leave")
        except Exception: pass
        staff_roles = set(config.get("staff_role_ids") or [])
        if any(r.id in staff_roles for r in member.roles):
            try: end_staff_call(member.id, member.guild.id)
            except Exception: pass

@bot.event
async def on_guild_join(guild):
    config["guild_id"] = guild.id; save_config(config)
    if config.get("auto_emoji_channels", True):
        try: await sync_all_channels_emoji(guild)
        except Exception: pass

@bot.event
async def on_guild_channel_create(channel):
    try:
        await asyncio.sleep(1.5)
        await auto_emoji_channel(channel)
    except Exception: pass

@bot.event
async def on_guild_channel_update(before, after):
    try:
        if before.name == after.name: return
        if not config.get("auto_emoji_channels", True): return
        await auto_emoji_channel(after)
    except Exception: pass

@bot.event
async def on_message_staff_count(message):
    if message.author.bot or not message.guild: return
    staff_roles = set(config.get("staff_role_ids") or [])
    if not any(r.id in staff_roles for r in message.author.roles): return
    try: increment_staff_messages(message.author.id, message.guild.id)
    except Exception: pass

# ===================== RUN =====================
if __name__ == "__main__":
    bot.run(TOKEN)
