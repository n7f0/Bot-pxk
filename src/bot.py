import discord
from discord import app_commands, ui
from discord.ext import commands, tasks
import json, os, datetime, random, logging, aiohttp, asyncio, re, shutil, time
from database import *

# ===================== TOKEN =====================
TOKEN = os.getenv("DISCORD_TOKEN")
if not TOKEN:
    raise ValueError("DISCORD_TOKEN não definido.")

CONFIG_FILE = "/app/data/config.json"
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

logging.getLogger("discord.voice_state").setLevel(logging.CRITICAL)
logging.getLogger("discord.voice_client").setLevel(logging.CRITICAL)
logging.getLogger("discord.player").setLevel(logging.WARNING)
logging.getLogger("discord.gateway").setLevel(logging.WARNING)

FFMPEG_AVAILABLE = shutil.which("ffmpeg") is not None
if not FFMPEG_AVAILABLE:
    logger.warning("⚠️ ffmpeg não encontrado. O keepalive de voz ficará desativado.")

# ===================== EMOJIS PERSONALIZADOS =====================
EMOJI = {
    "nitro_boo":   "<a:912822415908827136:924037624467980329>",
    "minecraft":   "<:g_minecraft25:926135884762472478>",
    "insta":       "<:insta:916911739185004605>",
    "verificado":  "<a:verificado_rosa:926137751483584552>",
    "tdj_1":       "<a:tdj_1:925370141997428816>",
    "tdj_2":       "<a:tdj_2:925370171462418452>",
    "tdj_3":       "<a:tdj_3:925370195130867772>",
    "tdj_4":       "<a:tdj_4:925370224868462663>",
    "tdj_5":       "<a:tdj_5:925370243348586496>",
    "tdj_6":       "<a:tdj_6:925370266345963561>",
    "tdj_7":       "<a:tdj_7:925370296259719168>",
    "tdj_8":       "<a:tdj_8:925370322264391701>",
    "tdj_9":       "<a:tdj_9:925370350051684393>",
    "seta":        "<a:seta:924046181879918652>",
    "nitroboo":    "<a:nitroboo:964501440838107166>",
    "hellokitty":  "<:HelloKitty:942496467539603466>",
}

def _parse_emoji(raw: str):
    if not raw: return None
    m = re.match(r"<(a?):([^:]+):(\d+)>", raw)
    if not m:
        return raw if raw.strip() else None
    animated, name, eid = m.group(1) == "a", m.group(2), int(m.group(3))
    try:
        return discord.PartialEmoji(name=name, id=eid, animated=animated)
    except Exception:
        return raw

def E(key: str):
    return _parse_emoji(EMOJI.get(key, ""))

# ===================== AUTO-EMOJI POR NOME DE CANAL =====================
CHANNEL_EMOJI_RULES = {
    ("bemvindo", "bem-vindo", "boasvindas", "boas-vindas", "welcome", "entrada"): "✨",
    ("saiu", "saida", "saída", "leave", "adeus", "despedida"): "🔒",
    ("regras", "regra", "rules", "rule", "diretrizes"): "📜",
    ("aviso", "avisos", "anuncio", "anúncio", "anuncios", "announcement", "announcements"): "📢",
    ("chat", "geral", "general", "batepapo", "bate-papo", "conversa"): "💬",
    ("ticket", "tickets", "suporte", "support", "atendimento", "help-desk"): "🎫",
    ("sugestao", "sugestão", "sugestoes", "sugestões", "suggestion", "suggestions"): "💡",
    ("feedback", "avaliacao", "avaliação", "avaliacoes", "avaliações", "review", "reviews"): "⭐",
    ("bot", "bots", "comando", "comandos", "commands", "cmd"): "🤖",
    ("musica", "música", "music", "som", "spotify"): "🎵",
    ("call", "voz", "voice", "vocal", "voice-chat", "voicechat", "chamada"): "🔊",
    ("foto", "fotos", "midia", "mídia", "media", "imagem", "imagens", "galeria", "gallery"): "📸",
    ("membro", "membros", "members", "membro-novo"): "👥",
    ("verificacao", "verificação", "verify", "verificar", "captcha"): "✅",
    ("log", "logs", "registro", "registros", "auditoria"): "📋",
    ("nitro", "boost", "impulsionar", "boosters"): "🚀",
    ("parceria", "parcerias", "partner", "partners", "divulgacao", "divulgação"): "🤝",
    ("level", "nivel", "nível", "rank", "ranking", "xp", "levels"): "🏆",
    ("jogo", "jogos", "game", "games", "gaming", "gamer"): "🎮",
    ("evento", "eventos", "event", "events", "sorteio", "sorteios", "giveaway"): "🎉",
    ("meme", "memes", "humor", "piada", "piadas", "zoeira"): "😂",
    ("arte", "artes", "art", "desenho", "desenhos", "ilustracao", "ilustração"): "🎨",
    ("filme", "filmes", "movie", "movies", "serie", "series", "série", "séries", "cinema"): "🎬",
    ("anime", "animes", "manga", "mangá", "otaku"): "🌸",
    ("presente", "presentes", "gift", "gifts", "doacao", "doação"): "🎁",
    ("dica", "dicas", "tips", "tutorial", "tutoriais", "ajuda", "help", "faq"): "📚",
    ("duvida", "dúvida", "duvidas", "dúvidas", "pergunta", "perguntas"): "❓",
    ("compra", "compras", "purchase", "shop", "loja", "lojinha", "venda", "vendas"): "🛒",
    ("status", "info", "informacao", "informação", "informacoes", "informações"): "ℹ️",
    ("confissao", "confissão", "confissoes", "confissões", "desabafo", "desabafos"): "💭",
    ("amizade", "amizades", "amigos", "friend", "friends", "amigo"): "💖",
    ("roleplay", "rp", "rpg", "role-play"): "🎭",
    ("stream", "streams", "live", "lives", "twitch"): "📺",
    ("enquete", "enquetes", "poll", "polls", "votacao", "votação", "votacao"): "📊",
    ("comunidade", "community", "comunidade"): "🌐",
    ("apresentacao", "apresentação", "apresentacoes", "apresentações", "intro", "introducao", "introdução", "apresente-se"): "👋",
    ("cargo", "cargos", "role", "roles", "reaction-role"): "👑",
    ("premio", "prêmio", "premios", "prêmios", "recompensa", "recompensas", "reward"): "🏅",
    ("aniversario", "aniversário", "aniversarios", "aniversários", "birthday", "niver"): "🎂",
    ("namoro", "casal", "casais", "love", "amor", "shipp"): "💕",
    ("minecraft", "mc", "servidor-mc"): "⛏️",
    ("amongus", "among-us", "impostor"): "🚀",
    ("valorant", "val"): "🎯",
    ("lol", "league", "leagueoflegends", "league-of-legends"): "⚔️",
    ("fortnite", "fn"): "🏗️",
    ("gta", "gtarp", "fivem", "five-m"): "🚗",
}

EMOJI_SEPARATOR = "・"

_EMOJI_PREFIX_RE = re.compile(
    r'^([\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2190-\u21FF\u2000-\u3300\uFE0F]+)\s*[・•|·\-_]\s*(.+)$'
)

def _split_emoji_prefix(name: str):
    m = _EMOJI_PREFIX_RE.match(name)
    if m:
        return m.group(1), m.group(2).strip()
    return None, name.strip()

def _normalize_name(name: str) -> str:
    n = name.lower()
    n = re.sub(r'[・•·|_\-]+', '', n)
    n = re.sub(r'\s+', '', n)
    return n

def _find_emoji_for_name(name: str):
    norm_joined = _normalize_name(name)
    if not norm_joined:
        return None
    for keywords, emoji in CHANNEL_EMOJI_RULES.items():
        for kw in keywords:
            k_norm = _normalize_name(kw)
            if k_norm and k_norm in norm_joined:
                return emoji
    return None

async def auto_emoji_channel(channel) -> bool:
    if not config.get("auto_emoji_channels", True):
        return False
    if not isinstance(channel, (discord.TextChannel, discord.VoiceChannel,
                                discord.CategoryChannel, discord.ForumChannel)):
        return False
    if channel.name.startswith("verificar-") or channel.name.startswith("ticket-"):
        return False
    current_emoji, base_name = _split_emoji_prefix(channel.name)
    if not base_name:
        return False
    emoji = _find_emoji_for_name(base_name) or current_emoji
    if not emoji:
        return False
    new_name = f"{emoji}{EMOJI_SEPARATOR}{base_name}"
    if new_name == channel.name:
        return False
    if len(new_name) > 100:
        return False
    try:
        await channel.edit(name=new_name, reason="Auto emoji por nome do canal")
        logger.debug(f"Auto-emoji: {channel.name} → {new_name}")
        return True
    except discord.Forbidden:
        return False
    except Exception as e:
        logger.debug(f"auto_emoji {channel.name}: {e}")
        return False

async def sync_all_channels_emoji(guild) -> int:
    total = 0
    for ch in list(guild.channels):
        try:
            if await auto_emoji_channel(ch):
                total += 1
                await asyncio.sleep(0.7)
        except Exception as e:
            logger.debug(f"sync channel {getattr(ch,'name','?')}: {e}")
    return total

# ===================== CONFIG PADRÃO =====================
DEFAULT_CONFIG = {
    "brand_name": "𝚙𝚡𝚔",
    "brand_emoji": "🖤",
    "brand_footer": "🖤 𝚙𝚡𝚔 • Sistema Oficial",
    "brand_color_primary": 0x3D1A5C,
    "brand_color_secondary": 0x5B2A8E,
    "brand_color_success": 0x00FF88,
    "brand_color_danger": 0xFF3366,
    "avatar_url": "",
    "_last_avatar_url": "",
    "banner_painel_url": "",
    "banner_ticket_url": "",
    "banner_welcome_url": "",
    "guild_id": None,

    "auto_emoji_channels": True,
    "auto_emoji_ignore_prefixes": ["verificar-", "ticket-"],

    "verification_method": "math",
    "verification_difficulty": 1,
    "verification_kick_minutes": 0,
    "verified_role_ids": [],
    "verification_unverified_role_ids": [],
    "verification_channel_id": None,
    "verification_panel_channel_id": None,
    "verification_panel_message_id": None,
    "verification_log_channel_id": None,
    "verification_temp_category_id": None,
    "verification_temp_delete_seconds": 5,

    "welcome_channel_id": None,
    "welcome_message": "Seja muito bem-vindo(a) ao servidor! Esperamos que você se divirta bastante. 💜",
    "welcome_image_url": "",
    "leave_channel_id": None,
    "leave_message": "Sentiremos sua falta. Volte quando quiser! 💜",

    "voice_join_log_channel_id": None,
    "voice_leave_log_channel_id": None,

    "voice_channel_id": None,
    "voice_mute": True,
    "bot_status": "online",

    "activity_rotate_enabled": False,
    "activity_rotate_seconds": 30,
    "activity_type": "watching",
    "activity_messages": [],

    "admin_role_ids": [],

    "addcargo_allowed_role_ids": [],
    "addcargo_panel_channel_id": None,
    "addcargo_panel_message_id": None,

    "painel_channel_id": None,
    "painel_message_id": None,

    "ticket_category_doubt_id": None,
    "ticket_category_purchase_id": None,
    "ticket_logs_channel_id": None,
    "ticket_panel_channel_id": None,
    "ticket_panel_message_id": None,
    "ticket_support_role_ids": [],

    "ticket_panel_title": "🎫 Central de Tickets — {brand}",
    "ticket_panel_description": (
        "### 💬 Precisa de ajuda ou quer comprar algo?\n"
        "Escolha o tipo de atendimento no **menu abaixo** para abrir um ticket privado com nossa equipe.\n\n"
        "**❓ Dúvidas** — suporte geral, ajuda, perguntas\n"
        "**🛒 Compras** — produtos, serviços e pagamentos\n\n"
        "-# Nossa equipe responderá o mais rápido possível 🖤"
    ),
    "ticket_panel_select_placeholder": "🎫 Selecione o tipo de ticket para abrir...",
    "ticket_doubt_label": "Dúvidas",
    "ticket_doubt_desc": "Suporte geral, ajuda, perguntas",
    "ticket_doubt_emoji": "❓",
    "ticket_purchase_label": "Compras",
    "ticket_purchase_desc": "Produtos, serviços e pagamentos",
    "ticket_purchase_emoji": "🛒",

    # ===== FEEDBACK =====
    "feedback_channel_id": None,
    "feedback_panel_channel_id": None,
    "feedback_panel_message_id": None,
    "feedback_panel_title": "⭐ Avaliações & Feedback — {brand}",
    "feedback_panel_description": (
        "### 💜 Sua opinião é muito importante!\n"
        "Avalie sua experiência no servidor de **1 a 5 estrelas** clicando no botão abaixo.\n\n"
        "**O que você pode avaliar:**\n"
        "> ⭐ Atendimento da equipe\n"
        "> 🎫 Suporte nos tickets\n"
        "> 🖤 Experiência geral no servidor\n\n"
        "-# Cada avaliação ajuda a melhorar a comunidade 🚀"
    ),

    # ===== SUGESTÕES =====
    "suggestions_channel_id": None,
    "suggestions_panel_channel_id": None,
    "suggestions_panel_message_id": None,

    "moderation_logs_channel_id": None,

    "antibot_channel_id": None,
    "antibot_panel_message_id": None,
    "antibot_banner_url": "",
    "antibot_title": "• Não envie mensagem nesse canal!",
    "antibot_description": (
        "Sistema criado para prevenir bots de divulgação e outros SelfBots.\n"
        "Quem enviar mensagem aqui será punido imediatamente."
    ),
    "antibot_punish_ban": True,
    "antibot_delete_messages": True,
    "antibot_log_channel_id": None,
}

def load_config():
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    data = {}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}
    for k, v in DEFAULT_CONFIG.items():
        if k not in data:
            data[k] = v
    save_config(data)
    return data

def save_config(data):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

config = load_config()

# ===================== HOT-RELOAD =====================
_cfg_mtime = os.path.getmtime(CONFIG_FILE) if os.path.exists(CONFIG_FILE) else 0

@tasks.loop(seconds=5)
async def task_reload_config():
    global _cfg_mtime
    try: m = os.path.getmtime(CONFIG_FILE)
    except OSError: return
    if m == _cfg_mtime: return
    _cfg_mtime = m
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f: data = json.load(f)
    except Exception: return
    for k, v in DEFAULT_CONFIG.items(): data.setdefault(k, v)
    config.clear(); config.update(data)
    try:
        await update_status(force=True)
        await update_voice_name_impl()
        await refresh_all_panels()
    except Exception as e:
        logger.debug(f"reload apply: {e}")

# ===================== HELPERS =====================
def bname():  return config.get("brand_name") or "Bot"
def bemoji(): return config.get("brand_emoji") or "🖤"
def bfooter(): return config.get("brand_footer") or "Sistema Oficial"
def color_primary():   return config.get("brand_color_primary", 0x3D1A5C)
def color_secondary(): return config.get("brand_color_secondary", 0x5B2A8E)
def color_success():   return config.get("brand_color_success", 0x00FF88)
def color_danger():    return config.get("brand_color_danger", 0xFF3366)
def avatar_url():      return config.get("avatar_url") or None
def banner_painel():   return config.get("banner_painel_url") or None
def banner_ticket():   return config.get("banner_ticket_url") or None
def banner_welcome():  return config.get("welcome_image_url") or config.get("banner_welcome_url") or None

def _fmt_text(t: str) -> str:
    if not t: return ""
    guild = get_guild()
    members = guild.member_count if guild else 0
    return (str(t).replace("{brand}", bname())
             .replace("{emoji}", bemoji())
             .replace("{members}", str(members)))

# ===================== LOG DE MODERAÇÃO CENTRAL =====================
async def log_admin_action(interaction: discord.Interaction, action: str, detail: str = ""):
    guild = interaction.guild
    if not guild: return
    try:
        log_moderation(action, interaction.user.id, 0, detail[:500])
    except Exception:
        pass
    cid = config.get("moderation_logs_channel_id")
    if not cid: return
    ch = guild.get_channel(cid)
    if not ch: return
    try:
        await ch.send(
            f"🛡️ **Log de Painel** — `{action}`\n"
            f"**Autor:** {interaction.user.mention} (`{interaction.user.id}`)\n"
            f"**Canal:** {interaction.channel.mention if interaction.channel else '—'}\n"
            f"**Detalhe:** {detail or '—'}\n"
            f"**Horário:** <t:{int(datetime.datetime.now().timestamp())}:f>"
        )
    except Exception as e:
        logger.debug(f"log_admin_action: {e}")

# ===================== BOT =====================
intents = discord.Intents.default()
intents.members = True
intents.voice_states = True
intents.message_content = True
intents.guilds = True
intents.messages = True

bot = commands.Bot(command_prefix="!", intents=intents)

# ===================== UTIL =====================
def get_guild():
    gid = config.get("guild_id")
    return bot.get_guild(gid) if gid else None

def get_voice_channel():
    guild = get_guild()
    if guild:
        cid = config.get("voice_channel_id")
        return guild.get_channel(cid) if cid else None
    return None

def sanitize_channel_name(name: str) -> str:
    name = name.strip().lower()
    name = re.sub(r"\s+", "-", name)
    name = re.sub(r"[^a-z0-9\-_áàâãäéèêëíìîïóòôõöúùûüçñ]", "", name)
    name = re.sub(r"-+", "-", name).strip("-")
    return (name or "ticket")[:100]

async def update_voice_name_impl():
    guild = get_guild()
    if not guild: return
    channel = get_voice_channel()
    if not channel or not isinstance(channel, discord.VoiceChannel): return
    new_name = f"👥・{guild.member_count} membros"
    if channel.name != new_name:
        try: await channel.edit(name=new_name)
        except Exception: pass

# ---------- ATIVIDADE ROTATIVA ----------
_last_activity_time = 0.0
_activity_index = 0
_last_activity_signature = None

_ACTIVITY_TYPES = {
    "watching": discord.ActivityType.watching,
    "playing": discord.ActivityType.playing,
    "listening": discord.ActivityType.listening,
    "competing": discord.ActivityType.competing,
}

def _current_activity_text():
    global _last_activity_time, _activity_index
    guild = get_guild()
    if config.get("activity_rotate_enabled"):
        msgs = [m for m in (config.get("activity_messages") or []) if str(m).strip()]
        if msgs:
            now = time.time()
            try:
                interval = max(10, int(config.get("activity_rotate_seconds", 30)))
            except Exception:
                interval = 30
            if _last_activity_time == 0:
                _last_activity_time = now
            if now - _last_activity_time >= interval:
                _last_activity_time = now
                _activity_index = (_activity_index + 1) % len(msgs)
            if _activity_index >= len(msgs):
                _activity_index = 0
            return _fmt_text(msgs[_activity_index])
    if guild:
        return f"{bemoji()} {guild.member_count} membros em {bname()}"
    return f"{bemoji()} {bname()}"

async def update_status(force: bool = False):
    global _last_activity_signature
    status_map = {"online": discord.Status.online, "idle": discord.Status.idle,
                  "dnd": discord.Status.dnd, "invisible": discord.Status.invisible}
    status = status_map.get(config.get("bot_status", "online"), discord.Status.online)
    text = _current_activity_text()
    atype = _ACTIVITY_TYPES.get(config.get("activity_type", "watching"),
                                discord.ActivityType.watching)
    sig = (status.value, atype.value, text)
    if not force and sig == _last_activity_signature:
        return
    _last_activity_signature = sig
    try:
        await bot.change_presence(status=status, activity=discord.Activity(type=atype, name=text))
    except Exception as e:
        logger.debug(f"update_status: {e}")

async def update_voice_mute():
    guild = get_guild()
    if not guild: return
    vc = guild.voice_client
    if not vc or not vc.is_connected(): return
    try: await guild.me.edit(mute=config.get("voice_mute", True))
    except Exception: pass

def text_channel_options(max_items=25):
    guild = get_guild()
    opts = []
    if guild:
        for c in guild.text_channels:
            try:
                if c.permissions_for(guild.me).send_messages:
                    opts.append(discord.SelectOption(label=f"#{c.name}"[:100], value=str(c.id)))
            except Exception: continue
    return opts[:max_items] or [discord.SelectOption(label="Nenhum canal disponível", value="none")]

def cleanup_channel_options(max_items=25):
    guild = get_guild()
    opts = []
    if guild:
        for c in guild.text_channels:
            try:
                perms = c.permissions_for(guild.me)
                if perms.manage_messages and perms.read_message_history:
                    opts.append(discord.SelectOption(
                        label=f"💬 #{c.name}"[:100], value=str(c.id),
   