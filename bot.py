import discord
from discord import app_commands, ui
from discord.ext import commands, tasks
import json, os, datetime, random, logging, aiohttp, asyncio
from database import *

# ===================== TOKEN =====================
TOKEN = os.getenv("DISCORD_TOKEN")
if not TOKEN:
    raise ValueError("DISCORD_TOKEN não definido.")

CONFIG_FILE = "/app/data/config.json"
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
logging.getLogger("discord.voice_state").setLevel(logging.WARNING)

# ===================== CONFIG PADRÃO =====================
DEFAULT_CONFIG = {
    "brand_name": "𝚙𝚡𝚔",
    "brand_emoji": "🖤",
    "brand_footer": "🖤 𝚙𝚡𝚔 • Sistema Oficial",
    "brand_color_primary": 0x8A2BE2,
    "brand_color_secondary": 0xB026FF,
    "brand_color_success": 0x00FF88,
    "brand_color_danger": 0xFF3366,
    "avatar_url": "",
    "_last_avatar_url": "",
    "banner_painel_url": "",
    "banner_ticket_url": "",
    "banner_welcome_url": "",
    "guild_id": None,

    "verification_method": "math",
    "verification_difficulty": 1,
    "verification_kick_minutes": 0,
    "verified_role_ids": [],
    "verification_unverified_role_ids": [],
    "verification_channel_id": None,
    "verification_panel_channel_id": None,
    "verification_panel_message_id": None,
    "verification_log_channel_id": None,

    "welcome_channel_id": None,
    "welcome_message": "Bem-vindo(a) ao servidor!",
    "welcome_image_url": "",
    "leave_channel_id": None,
    "leave_message": "Até logo! Sentiremos sua falta. 💜",

    "voice_join_log_channel_id": None,
    "voice_leave_log_channel_id": None,

    "voice_channel_id": None,
    "voice_mute": True,
    "bot_status": "online",

    "admin_role_ids": [],

    "painel_channel_id": None,
    "painel_message_id": None,

    "ticket_category_doubt_id": None,
    "ticket_category_purchase_id": None,
    "ticket_logs_channel_id": None,
    "ticket_panel_channel_id": None,
    "ticket_panel_message_id": None,
    "ticket_support_role_ids": [],

    "feedback_channel_id": None,
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

# ===================== HELPERS DE IDENTIDADE =====================
def bname():  return config.get("brand_name") or "Bot"
def bemoji(): return config.get("brand_emoji") or "🖤"
def bfooter(): return config.get("brand_footer") or "Sistema Oficial"
def color_primary():   return config.get("brand_color_primary", 0x8A2BE2)
def color_secondary(): return config.get("brand_color_secondary", 0xB026FF)
def color_success():   return config.get("brand_color_success", 0x00FF88)
def color_danger():    return config.get("brand_color_danger", 0xFF3366)
def avatar_url():      return config.get("avatar_url") or None
def banner_painel():   return config.get("banner_painel_url") or None
def banner_ticket():   return config.get("banner_ticket_url") or None
def banner_welcome():  return config.get("welcome_image_url") or config.get("banner_welcome_url") or None

# ===================== BOT =====================
intents = discord.Intents.default()
intents.members = True
intents.voice_states = True
intents.message_content = True
intents.guilds = True
intents.messages = True

bot = commands.Bot(command_prefix="!", intents=intents)

# ===================== UTILITÁRIOS =====================
def get_guild():
    gid = config.get("guild_id")
    return bot.get_guild(gid) if gid else None

def get_voice_channel():
    guild = get_guild()
    if guild:
        cid = config.get("voice_channel_id")
        return guild.get_channel(cid) if cid else None
    return None

async def update_voice_name_impl():
    guild = get_guild()
    if not guild: return
    channel = get_voice_channel()
    if not channel or not isinstance(channel, discord.VoiceChannel): return
    new_name = f"👥 {guild.member_count} membros"
    if channel.name != new_name:
        try: await channel.edit(name=new_name)
        except Exception: pass

async def update_status():
    guild = get_guild()
    if not guild: return
    status_map = {"online": discord.Status.online, "idle": discord.Status.idle,
                  "dnd": discord.Status.dnd, "invisible": discord.Status.invisible}
    status = status_map.get(config.get("bot_status", "online"), discord.Status.online)
    try:
        await bot.change_presence(status=status, activity=discord.Activity(
            type=discord.ActivityType.watching,
            name=f"{bemoji()} {guild.member_count} membros em {bname()}"
        ))
    except Exception: pass

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

def voice_channel_options():
    guild = get_guild()
    opts = []
    if guild:
        for c in guild.voice_channels:
            opts.append(discord.SelectOption(label=c.name[:100], value=str(c.id)))
    return opts[:25] or [discord.SelectOption(label="Nenhum canal de voz", value="none")]

def category_options():
    guild = get_guild()
    opts = []
    if guild:
        for c in guild.categories:
            opts.append(discord.SelectOption(label=c.name[:100], value=str(c.id)))
    return opts[:25] or [discord.SelectOption(label="Nenhuma categoria", value="none")]

# ===================== COMPONENTS V2 — HELPERS =====================
P  = discord.ButtonStyle.primary
S  = discord.ButtonStyle.secondary
SU = discord.ButtonStyle.success
D  = discord.ButtonStyle.danger

def _btn(label, cid, style=P, emoji=None):
    return ui.Button(label=label, style=style, custom_id=cid, emoji=emoji)

def _thumb():
    return avatar_url() or "https://cdn.discordapp.com/embed/avatars/0.png"

def _safe_media_gallery(media_url):
    if not media_url:
        return None
    MG  = getattr(ui, "MediaGallery", None) or getattr(discord, "MediaGallery", None)
    MGI = getattr(ui, "MediaGalleryItem", None) or getattr(discord, "MediaGalleryItem", None)
    if not MG or not MGI:
        return None
    try:
        return MG(MGI(media=media_url))
    except Exception:
        return None

def _safe_select(placeholder, options, custom_id=None,
                  min_values=1, max_values=1):
    if not options:
        options = [discord.SelectOption(label="Nenhuma opção", value="none")]
    options = options[:25]
    n = len(options)
    safe_max = max(1, min(max_values, n))
    safe_min = max(0, min(min_values, safe_max))
    kwargs = dict(
        placeholder=placeholder,
        options=options,
        min_values=safe_min,
        max_values=safe_max,
    )
    if custom_id:
        kwargs["custom_id"] = custom_id
    return ui.Select(**kwargs)

def premium_submenu(title, description, sections, accent=None):
    layout = ui.LayoutView(timeout=300)
    comps = [
        ui.TextDisplay(f"# {title}"),
        ui.Section(
            ui.TextDisplay(description),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
    ]
    for sec in sections:
        comps.append(ui.Separator(spacing=discord.SeparatorSpacing.small))
        comps.append(ui.TextDisplay(f"### {sec['title']}"))
        for row in sec["rows"]:
            comps.append(ui.ActionRow(*row))
    comps.append(ui.Separator(spacing=discord.SeparatorSpacing.large))
    comps.append(ui.ActionRow(_btn("Voltar ao Menu", "back_main", D, "↩️")))
    layout.add_item(ui.Container(*comps, accent_color=accent or color_primary()))
    return layout

# ===================== BARRA DE PROGRESSO =====================
def _progress_bar(current, total, length=22):
    if total <= 0:
        return f"`[{'█' * length}]` **100%**"
    current = max(0, min(current, total))
    pct = int(current / total * 100)
    filled = int(length * current / total)
    empty = length - filled
    return f"`[{'█' * filled}{'░' * empty}]` **{pct}%**"

def _fmt_elapsed(start_time):
    elapsed = (datetime.datetime.now() - start_time).total_seconds()
    m = int(elapsed // 60)
    s = int(elapsed % 60)
    return f"{m:02d}:{s:02d}"

def _build_cleanup_progress_view(channels_done, total_channels, current_channel,
                                  current_deleted, start_time, phase=""):
    overall_bar = _progress_bar(channels_done, total_channels)
    status = "✅ Concluído" if channels_done >= total_channels else "🔄 Em andamento..."

    lines = [
        f"### 📊 Progresso Geral",
        f"{overall_bar}",
        f"**Canais concluídos:** `{channels_done}/{total_channels}`",
        f"**Status:** {status}",
        f"**Tempo decorrido:** `{_fmt_elapsed(start_time)}`",
    ]
    if current_channel is not None:
        lines.append("")
        lines.append(f"### 📂 Canal Atual ({channels_done + 1}/{total_channels})")
        lines.append(f"**{current_channel.mention}**")
        lines.append(f"**Mensagens apagadas:** `{current_deleted}`")
        if phase:
            lines.append(f"**Fase:** {phase}")

    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(
        ui.TextDisplay("# 🧹 Limpeza de Chat"),
        ui.TextDisplay("\n".join(lines)),
        accent_color=color_danger(),
    ))
    return layout

def _build_cleanup_final_view(summary):
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(
        ui.TextDisplay("# ✅ Limpeza Concluída"),
        ui.TextDisplay(summary),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(_btn("Voltar ao Menu", "back_main", D, "↩️")),
        accent_color=color_success(),
    ))
    return layout

# ===================== CARD DE MEMBRO / VOZ =====================
async def _fetch_banner_url(user_id: int):
    try:
        user = await bot.fetch_user(user_id)
        if user and user.banner:
            return user.banner.url
    except Exception:
        pass
    return None

def _build_member_card(member, title, subtitle, action, accent,
                        banner_url=None, voice_channel=None):
    now_ts = int(datetime.datetime.now().timestamp())
    avatar = member.display_avatar.with_size(512).url

    comps = [
        ui.TextDisplay(f"# {title}"),
        ui.Section(
            ui.TextDisplay(f"### {member.display_name}\n-# {member.mention}"),
            accessory=ui.Thumbnail(media=avatar),
        ),
    ]
    if banner_url:
        mg = _safe_media_gallery(banner_url)
        if mg is not None:
            comps.append(mg)

    comps.append(ui.Separator(spacing=discord.SeparatorSpacing.small))

    info = [
        f"**👤 Usuário:** {member.mention}",
        f"**🏷️ Nome:** `{member.name}`",
        f"**🆔 ID:** `{member.id}`",
        f"**📅 Conta criada:** <t:{int(member.created_at.timestamp())}:R>",
    ]
    if action == "join":
        info.append(f"**👥 Membro nº:** `{member.guild.member_count}`")
    elif action == "leave":
        if member.joined_at:
            delta = datetime.datetime.now(datetime.timezone.utc) - member.joined_at
            info.append(f"**📥 Entrou em:** <t:{int(member.joined_at.timestamp())}:R>")
            info.append(f"**⏳ Tempo no servidor:** `{delta.days} dias`")
        info.append(f"**👥 Restam:** `{member.guild.member_count} membros`")
    elif action == "vjoin":
        info.append(f"**🔊 Canal:** {voice_channel.mention if voice_channel else '—'}")
        info.append(f"**👥 No canal:** `{len(voice_channel.members) if voice_channel else 0}`")
    elif action == "vleave":
        info.append(f"**🔊 Canal:** {voice_channel.mention if voice_channel else '—'}")
        info.append(f"**📤 Saiu às:** <t:{now_ts}:T>")

    comps.append(ui.TextDisplay("\n".join(info)))
    comps.append(ui.Separator(spacing=discord.SeparatorSpacing.small))
    comps.append(ui.TextDisplay(subtitle))
    comps.append(ui.TextDisplay(f"-# {bfooter()} • <t:{now_ts}:f>"))

    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=accent))
    return layout

async def send_welcome_message(member):
    cid = config.get("welcome_channel_id")
    if not cid: return
    ch = member.guild.get_channel(cid)
    if not ch: return
    banner_url = banner_welcome() or await _fetch_banner_url(member.id)
    subtitle = config.get("welcome_message") or "Bem-vindo(a)!"
    card = _build_member_card(member, f"{bemoji()} Bem-vindo(a) à {bname()}!",
                              f"> {subtitle}", "join", color_success(), banner_url)
    try: await ch.send(view=card)
    except Exception as e: logger.error(f"Erro welcome: {e}")

async def send_leave_message(member):
    cid = config.get("leave_channel_id")
    if not cid: return
    ch = member.guild.get_channel(cid)
    if not ch: return
    banner_url = await _fetch_banner_url(member.id)
    subtitle = config.get("leave_message") or "Até logo! 💜"
    card = _build_member_card(member, f"{bemoji()} Até logo, {member.display_name}!",
                              f"> {subtitle}", "leave", color_danger(), banner_url)
    try: await ch.send(view=card)
    except Exception as e: logger.error(f"Erro leave: {e}")

async def send_voice_log(member, channel, action):
    if action == "join":
        cid = config.get("voice_join_log_channel_id")
        title = f"🔊 {member.display_name} entrou na call"
        subtitle = f"> Entrou em **{channel.name}**"
        accent = color_success()
        act = "vjoin"
    else:
        cid = config.get("voice_leave_log_channel_id")
        title = f"🔇 {member.display_name} saiu da call"
        subtitle = f"> Saiu de **{channel.name}**"
        accent = color_danger()
        act = "vleave"
    if not cid: return
    log_ch = member.guild.get_channel(cid)
    if not log_ch: return
    banner_url = await _fetch_banner_url(member.id)
    card = _build_member_card(member, title, subtitle, act, accent, banner_url, channel)
    try: await log_ch.send(view=card)
    except Exception as e: logger.error(f"Erro voice log: {e}")

# ===================== PERMISSÕES ADMIN-ONLY =====================
async def make_channel_admin_only(channel: discord.TextChannel):
    guild = channel.guild
    try:
        await channel.set_permissions(guild.default_role, view_channel=False, reason="Logs admin-only")
        for rid in config.get("admin_role_ids", []):
            role = guild.get_role(rid)
            if role:
                try:
                    await channel.set_permissions(role, view_channel=True, read_message_history=True,
                                                  reason="Logs admin-only")
                except Exception: pass
    except Exception as e:
        logger.warning(f"Não foi possível restringir {channel.name}: {e}")

# ===================== ANTI-BOT — PAINEL =====================
def antibot_panel_view():
    count = get_antibot_count()

    comps = []
    banner = config.get("antibot_banner_url")
    if banner:
        mg = _safe_media_gallery(banner)
        if mg is not None:
            comps.append(mg)
        else:
            comps.append(ui.Section(ui.TextDisplay(""), accessory=ui.Thumbnail(media=banner)))

    title_txt = config.get("antibot_title") or "• Não envie mensagem nesse canal!"
    desc_txt  = config.get("antibot_description") or (
        "Sistema criado para prevenir bots de divulgação e outros SelfBots.\n"
        "Quem enviar mensagem aqui será punido imediatamente."
    )

    comps.append(ui.TextDisplay(f"# {title_txt}"))
    comps.append(ui.TextDisplay(f"> {desc_txt.replace(chr(10), chr(10) + '> ')}"))
    comps.append(ui.Separator(spacing=discord.SeparatorSpacing.small))

    counter_btn = ui.Button(
        label=f"Punidos: {count}",
        style=S,
        disabled=True,
        custom_id="antibot_counter_display",
    )
    comps.append(ui.ActionRow(counter_btn))

    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=color_danger()))
    return layout

async def refresh_antibot_panel():
    cid = config.get("antibot_channel_id")
    mid = config.get("antibot_panel_message_id")
    if not cid or not mid: return
    guild = get_guild()
    if not guild: return
    ch = guild.get_channel(cid)
    if not ch: return
    try:
        msg = await ch.fetch_message(mid)
        await msg.edit(view=antibot_panel_view())
    except Exception as e:
        logger.debug(f"Refresh antibot panel: {e}")

# ===================== ANTI-BOT — PUNIÇÃO =====================
async def _delete_all_user_messages(guild, user_id, limit_per_channel=300):
    deleted = 0
    for channel in guild.text_channels:
        try:
            perms = channel.permissions_for(guild.me)
            if not perms.manage_messages or not perms.read_message_history:
                continue
            async for msg in channel.history(limit=limit_per_channel):
                if msg.author.id == user_id:
                    try:
                        await msg.delete()
                        deleted += 1
                        await asyncio.sleep(0.35)
                    except discord.NotFound:
                        continue
                    except discord.HTTPException:
                        await asyncio.sleep(1.5)
        except Exception:
            continue
    return deleted

async def handle_antibot_punish(message: discord.Message):
    guild = message.guild
    member = message.author
    logger.info(f"🚫 AntiBot: {member} ({member.id}) em #{message.channel.name}")

    try:
        await message.delete()
    except Exception:
        pass

    deleted_count = 0
    if config.get("antibot_delete_messages", True):
        try:
            deleted_count = await _delete_all_user_messages(guild, member.id)
        except Exception as e:
            logger.error(f"Erro apagando mensagens: {e}")

    banned = False
    if config.get("antibot_punish_ban", True):
        try:
            await guild.ban(member, reason="AntiBot: mensagem em canal protegido", delete_message_seconds=0)
            banned = True
        except discord.Forbidden:
            logger.warning(f"Sem permissão para banir {member}")
        except Exception as e:
            logger.error(f"Erro ban: {e}")

    try:
        add_antibot_punishment(member.id, guild.id, "Mensagem em canal protegido",
                                banned=banned, deleted_count=deleted_count)
    except Exception as e:
        logger.error(f"Erro registrando punição: {e}")

    await refresh_antibot_panel()

    log_id = config.get("antibot_log_channel_id")
    if log_id:
        log_ch = guild.get_channel(log_id)
        if log_ch:
            try:
                await log_ch.send(
                    f"🚫 **AntiBot** — punição aplicada\n"
                    f"**Usuário:** {member} (`{member.id}`)\n"
                    f"**Canal:** {message.channel.mention}\n"
                    f"**Mensagens apagadas:** `{deleted_count}`\n"
                    f"**Banido:** `{'Sim' if banned else 'Não'}`"
                )
            except Exception: pass

# ===================== PAINEL PRINCIPAL =====================
def painel_layout():
    layout = ui.LayoutView(timeout=None)

    header = [
        ui.TextDisplay(f"# {bemoji()} {bname()} — Central de Controle"),
        ui.Section(
            ui.TextDisplay(
                "### ✨ Painel Administrativo Premium\n"
                "Gerencie **todo o seu servidor** em um só lugar.\n"
                "-# Selecione uma categoria no menu abaixo para começar."
            ),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
    ]
    layout.add_item(ui.Container(*header, accent_color=color_primary()))

    select = _safe_select(
        placeholder="🖤 Escolha uma categoria para configurar...",
        options=[
            discord.SelectOption(label="Identidade Visual", value="identity", emoji="🎨",
                                 description="Nome, emoji, cores e banners"),
            discord.SelectOption(label="Anti-Bot", value="antibot", emoji="🚫",
                                 description="Canal protegido e punições automáticas"),
            discord.SelectOption(label="Verificação Captcha", value="captcha", emoji="✅",
                                 description="Sistema de verificação avançado"),
            discord.SelectOption(label="Boas-vindas & Saída", value="welcome", emoji="💌",
                                 description="Mensagens de entrada e saída"),
            discord.SelectOption(label="Logs de Voz", value="voicelogs", emoji="🎙️",
                                 description="Canais de entrada/saída da call (admin-only)"),
            discord.SelectOption(label="Voz & Status", value="voice", emoji="🔊",
                                 description="Canal 24h, mute e presença"),
            discord.SelectOption(label="Cargos de Admin", value="admin", emoji="👑",
                                 description="Quem pode usar este painel"),
            discord.SelectOption(label="Painel Fixo", value="painel_fixo", emoji="📌",
                                 description="Canal onde o painel fica fixado"),
            discord.SelectOption(label="Tickets", value="tickets", emoji="🎫",
                                 description="Categorias, suporte e logs"),
            discord.SelectOption(label="Avaliações", value="feedback", emoji="⭐",
                                 description="Canal de feedback dos tickets"),
            discord.SelectOption(label="Sugestões", value="suggestions", emoji="💡",
                                 description="Painel e canal de sugestões"),
            discord.SelectOption(label="Limpeza de Chat", value="chat_cleanup", emoji="🧹",
                                 description="Apagar mensagens de vários canais"),
            discord.SelectOption(label="Ver Configuração Atual", value="show_config", emoji="📋",
                                 description="Visualizar tudo que está configurado"),
        ],
        custom_id="pxk_main_menu",
        min_values=1, max_values=1,
    )
    select.callback = main_menu_callback

    layout.add_item(ui.Container(
        ui.TextDisplay("## 🗂️ Categorias Disponíveis"),
        ui.TextDisplay("-# Cada categoria abre um submenu com botões organizados por função."),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(select),
        accent_color=color_secondary(),
    ))
    return layout

async def main_menu_callback(interaction: discord.Interaction):
    v = interaction.data["values"][0]
    routes = {
        "identity":     lambda: interaction.response.send_message(view=identity_view(), ephemeral=True),
        "antibot":      lambda: interaction.response.send_message(view=antibot_view(), ephemeral=True),
        "captcha":      lambda: interaction.response.send_message(view=captcha_view(), ephemeral=True),
        "welcome":      lambda: interaction.response.send_message(view=welcome_view(), ephemeral=True),
        "voicelogs":    lambda: interaction.response.send_message(view=voicelogs_view(), ephemeral=True),
        "voice":        lambda: interaction.response.send_message(view=voice_view(), ephemeral=True),
        "admin":        lambda: interaction.response.send_message(view=admin_view(), ephemeral=True),
        "painel_fixo":  lambda: interaction.response.send_message(view=painel_fixo_view(), ephemeral=True),
        "tickets":      lambda: interaction.response.send_message(view=tickets_view(), ephemeral=True),
        "feedback":     lambda: interaction.response.send_message(view=feedback_view(), ephemeral=True),
        "suggestions":  lambda: interaction.response.send_message(view=suggestions_view(), ephemeral=True),
        "chat_cleanup": lambda: interaction.response.send_message(view=chat_cleanup_view(), ephemeral=True),
        "show_config":  lambda: interaction.response.send_message(view=show_config_view(), ephemeral=True),
    }
    fn = routes.get(v)
    if fn: await fn()

# ===================== SUBMENUS =====================
def identity_view():
    return premium_submenu(
        "🎨 Identidade Visual",
        "Personalize o nome, emoji, cores e imagens que aparecem em **todo o bot**.",
        [
            {"title": "🏷️ Marca", "rows": [[
                _btn("Nome",   "id_name",   P, "✏️"),
                _btn("Emoji",  "id_emoji",  P, "✨"),
                _btn("Rodapé", "id_footer", P, "📝"),
            ]]},
            {"title": "🎨 Paleta de Cores", "rows": [[
                _btn("Primária",   "id_c1", P,  "🟣"),
                _btn("Secundária", "id_c2", P,  "💜"),
                _btn("Sucesso",    "id_c3", SU, "🟢"),
                _btn("Perigo",     "id_c4", D,  "🔴"),
            ]]},
            {"title": "🖼️ Imagens & Banners", "rows": [
                [
                    _btn("Avatar",             "id_avatar", S, "👤"),
                    _btn("Banner Painel",      "id_bp",     S, "🎴"),
                ],
                [
                    _btn("Banner Ticket",      "id_bt",     S, "🎫"),
                    _btn("Banner Boas-vindas", "id_bw",     S, "💌"),
                ],
            ]},
            {"title": "⚙️ Ações", "rows": [[
                _btn("Aplicar Avatar", "id_apply",   SU, "✅"),
                _btn("Pré-visualizar", "id_preview", S,  "👁️"),
            ]]},
        ],
        accent=color_primary(),
    )

def antibot_view():
    ban_on = config.get("antibot_punish_ban", True)
    del_on = config.get("antibot_delete_messages", True)
    ch_set = "✅" if config.get("antibot_channel_id") else "❌"
    log_set = "✅" if config.get("antibot_log_channel_id") else "❌"
    total = get_antibot_count()

    return premium_submenu(
        "🚫 Anti-Bot",
        "Configure o canal protegido onde **qualquer mensagem** resulta em banimento e deleção total.\n\n"
        f"**Canal protegido:** {ch_set}\n"
        f"**Canal de log:** {log_set}\n"
        f"**Banir:** `{'Ativo' if ban_on else 'Desativado'}`  |  "
        f"**Apagar msgs:** `{'Ativo' if del_on else 'Desativado'}`\n"
        f"**Total punidos:** `{total}`",
        [
            {"title": "📢 Canal Protegido", "rows": [
                [_btn("Definir Canal Anti-Bot", "ab_ch", P, "🚫")],
                [_btn("Canal de Log",           "ab_log", P, "📝")],
            ]},
            {"title": "🖼️ Aparência do Painel", "rows": [
                [
                    _btn("Banner do Painel", "ab_banner", P, "🖼️"),
                    _btn("Título",           "ab_title",  P, "✏️"),
                ],
                [_btn("Descrição", "ab_desc", P, "📝")],
            ]},
            {"title": "⚙️ Ações de Punição", "rows": [
                [
                    _btn(f"Banir: {'ON' if ban_on else 'OFF'}", "ab_toggle_ban", SU if ban_on else D, "🔨"),
                    _btn(f"Apagar Msgs: {'ON' if del_on else 'OFF'}", "ab_toggle_del", SU if del_on else D, "🧹"),
                ],
            ]},
            {"title": "🎛️ Painel", "rows": [
                [_btn("Postar Painel Aqui", "ab_post", SU, "📤")],
                [_btn("Preview do Painel",  "ab_preview", S, "👁️")],
            ]},
        ],
        accent=color_danger(),
    )

def captcha_view():
    method = config.get("verification_method", "math")
    diff   = config.get("verification_difficulty", 1)
    kick   = config.get("verification_kick_minutes", 0)
    method_label = "🧮 Matemática" if method == "math" else "🔘 Botão"
    diff_labels = {1: "Fácil", 2: "Médio", 3: "Difícil"}
    kick_label = "Desativado" if not kick else f"{kick} min"

    return premium_submenu(
        "✅ Verificação Captcha",
        f"Sistema avançado com método, dificuldade e expulsão automática.\n\n"
        f"**Método atual:** `{method_label}`\n"
        f"**Dificuldade:** `{diff_labels.get(diff, 'Fácil')}`\n"
        f"**Kick automático:** `{kick_label}`",
        [
            {"title": "👑 Cargos", "rows": [
                [_btn("Cargos Entregues (verificados)", "cap_roles", P, "✅")],
                [_btn("Cargos Não Verificado", "cap_unver", P, "⏳")],
            ]},
            {"title": "⚙️ Método & Dificuldade", "rows": [
                [
                    _btn("Mudar Método",      "cap_method", P, "🔀"),
                    _btn("Mudar Dificuldade", "cap_diff",   P, "🎚️"),
                ],
            ]},
            {"title": "⏰ Expulsão Automática", "rows": [
                [_btn("Configurar Tempo", "cap_kick", D, "⏰")],
            ]},
            {"title": "📢 Canais", "rows": [
                [
                    _btn("Canal de Verificação", "cap_ch",   P, "✅"),
                    _btn("Canal do Painel",      "cap_pch",  P, "📌"),
                ],
                [_btn("Canal de Log", "cap_log", P, "📝")],
            ]},
        ],
        accent=color_secondary(),
    )

def welcome_view():
    return premium_submenu(
        "💌 Boas-vindas & Saída",
        "Configure as mensagens premium de **entrada** e **saída** do servidor.",
        [
            {"title": "🎉 Entrada no Servidor", "rows": [
                [
                    _btn("Canal de Boas-vindas", "wel_ch",  P, "📢"),
                    _btn("Mensagem de Entrada",  "wel_msg", P, "✏️"),
                ],
                [
                    _btn("Banner de Entrada", "wel_img", S, "🖼️"),
                    _btn("Testar Entrada",    "wel_test", SU, "🧪"),
                ],
            ]},
            {"title": "👋 Saída do Servidor", "rows": [
                [
                    _btn("Canal de Saída",    "lev_ch",  P, "📢"),
                    _btn("Mensagem de Saída", "lev_msg", P, "✏️"),
                ],
                [_btn("Testar Saída", "lev_test", SU, "🧪")],
            ]},
        ],
        accent=color_primary(),
    )

def voicelogs_view():
    return premium_submenu(
        "🎙️ Logs de Voz",
        "Escolha canais separados para registrar **quem entra** e **quem sai** das calls.\n"
        "-# 🔒 Os canais serão automaticamente restritos a **admins**.",
        [
            {"title": "🔊 Entrada na Call", "rows": [[
                _btn("Canal de Log — Entrou", "vl_join_ch",   P, "🔊"),
                _btn("Testar Entrada",        "vl_join_test", SU, "🧪"),
            ]]},
            {"title": "🔇 Saída da Call", "rows": [[
                _btn("Canal de Log — Saiu", "vl_leave_ch",   P, "🔇"),
                _btn("Testar Saída",        "vl_leave_test", SU, "🧪"),
            ]]},
        ],
        accent=color_secondary(),
    )

def voice_view():
    return premium_submenu(
        "🔊 Voz & Status",
        "Configure o canal de voz 24h, mute automático e status de presença do bot.",
        [
            {"title": "🎙️ Voz 24h", "rows": [[
                _btn("Canal de Voz 24h", "v_ch", P, "🔊"),
            ]]},
            {"title": "🎭 Presença", "rows": [[
                _btn("Mute na Call",  "v_mute",   P, "🔇"),
                _btn("Status do Bot", "v_status", P, "🎭"),
            ]]},
        ],
        accent=color_primary(),
    )

def admin_view():
    return premium_submenu(
        "👑 Cargos de Admin",
        "Defina **quais cargos** podem usar este painel.\n-# Administradores do servidor já têm acesso por padrão.",
        [
            {"title": "🔐 Permissões", "rows": [[
                _btn("Selecionar Cargos (múltiplos)", "adm_roles", P, "👥"),
            ]]},
        ],
        accent=color_primary(),
    )

def painel_fixo_view():
    return premium_submenu(
        "📌 Painel Fixo",
        "Escolha o canal onde o **painel administrativo** ficará fixado.",
        [
            {"title": "📢 Canal", "rows": [[
                _btn("Definir Canal do Painel", "pf_ch", P, "📌"),
            ]]},
        ],
        accent=color_primary(),
    )

def tickets_view():
    return premium_submenu(
        "🎫 Sistema de Tickets",
        "Configure categorias, cargos de suporte e canais de log.",
        [
            {"title": "📂 Categorias", "rows": [[
                _btn("Dúvidas", "tk_cat_d", P, "❓"),
                _btn("Compras", "tk_cat_p", P, "🛒"),
            ]]},
            {"title": "👥 Suporte & Logs", "rows": [[
                _btn("Cargos de Suporte (múltiplos)", "tk_sup",  P, "👥"),
                _btn("Logs de Tickets",               "tk_logs", P, "📝"),
            ]]},
            {"title": "📢 Canais", "rows": [[
                _btn("Painel de Tickets", "tk_panel", P, "🎫"),
                _btn("Logs de Moderação", "tk_mod",   P, "🛡️"),
            ]]},
        ],
        accent=color_primary(),
    )

def feedback_view():
    return premium_submenu(
        "⭐ Avaliações",
        "Canal onde as **avaliações dos tickets** serão enviadas.",
        [
            {"title": "📢 Canal", "rows": [[
                _btn("Canal de Feedback", "fb_ch", P, "⭐"),
            ]]},
        ],
        accent=color_primary(),
    )

def suggestions_view():
    return premium_submenu(
        "💡 Sugestões",
        "Configure o painel e o canal onde as **sugestões dos membros** são enviadas.",
        [
            {"title": "📢 Canais", "rows": [[
                _btn("Canal do Painel",    "sg_pch", P, "🎛️"),
                _btn("Canal de Sugestões", "sg_ch",  P, "💡"),
            ]]},
        ],
        accent=color_primary(),
    )

# ===================== LIMPEZA MULTI-SELECT =====================
_cleanup_selection = {}

async def _on_cleanup_select(interaction: discord.Interaction):
    sel = interaction.data.get("values", [])
    _cleanup_selection[interaction.user.id] = [int(v) for v in sel if v != "none"]
    ids = _cleanup_selection[interaction.user.id]
    if not ids:
        await interaction.response.send_message("❌ Nenhum canal selecionado.", ephemeral=True)
        return
    mentions = "\n".join(f"• <#{c}>" for c in ids)
    await interaction.response.send_message(
        f"✅ **{len(ids)} canal(is)** selecionado(s):\n{mentions}\n\n"
        f"-# Clique em **🧹 Iniciar Limpeza** para começar.",
        ephemeral=True
    )

def chat_cleanup_view():
    layout = ui.LayoutView(timeout=600)
    opts = text_channel_options()
    n = len([o for o in opts if o.value != "none"])
    max_vals = max(1, min(25, n))

    channel_select = _safe_select(
        placeholder="🧹 Selecione um ou mais canais para limpar...",
        options=opts,
        custom_id="cleanup_multi_select",
        min_values=1,
        max_values=max_vals,
    )
    channel_select.callback = _on_cleanup_select

    start_btn = ui.Button(label="Iniciar Limpeza", style=D, emoji="🧹", custom_id="cleanup_start")
    async def on_start(interaction: discord.Interaction):
        await run_multi_cleanup(interaction)
    start_btn.callback = on_start

    back_btn = _btn("Voltar ao Menu", "back_main", S, "↩️")

    layout.add_item(ui.Container(
        ui.TextDisplay("# 🧹 Limpeza de Chat"),
        ui.Section(
            ui.TextDisplay(
                "**Selecione vários canais** no menu abaixo e clique em **🧹 Iniciar Limpeza**.\n"
                "Uma **barra de progresso detalhada** mostrará o andamento em tempo real.\n"
                "-# ⚠️ Ação irreversível. O bot precisa de `Gerenciar Mensagens` em cada canal."
            ),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.TextDisplay("### 📂 Canais (selecione um ou mais)"),
        ui.ActionRow(channel_select),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(start_btn, back_btn),
        accent_color=color_danger(),
    ))
    return layout

async def _purge_channel(channel, guild, on_progress):
    total = 0
    erro = None
    cutoff = discord.utils.utcnow() - datetime.timedelta(days=13)

    try:
        while True:
            try:
                deleted = await channel.purge(limit=100, after=cutoff, bulk=True)
            except discord.HTTPException as e:
                logger.warning(f"Bulk falhou em {channel.name}: {e}")
                break
            if not deleted:
                break
            total += len(deleted)
            await on_progress(total, "🟢 Bulk delete")
            await asyncio.sleep(0.9)
    except Exception as e:
        logger.error(f"Erro fase 1 {channel.name}: {e}")

    erros_consec = 0
    try:
        async for msg in channel.history(limit=None, before=cutoff, oldest_first=False):
            try:
                await msg.delete()
                total += 1
                erros_consec = 0
                await on_progress(total, "🟡 Delete individual (antigas)")
                await asyncio.sleep(1.1)
            except discord.NotFound:
                continue
            except discord.Forbidden as e:
                erro = f"Forbidden: {e}"
                break
            except discord.HTTPException as e:
                erros_consec += 1
                if erros_consec >= 5:
                    erro = f"muitos erros: {e}"
                    break
                await asyncio.sleep(2.0)
    except Exception as e:
        logger.error(f"Erro fase 2 {channel.name}: {e}")
        erro = str(e)

    return total, erro

async def run_multi_cleanup(interaction: discord.Interaction):
    user_id = interaction.user.id
    ids = _cleanup_selection.get(user_id, [])
    if not ids:
        await interaction.response.send_message("❌ Nenhum canal selecionado. Use o menu antes.", ephemeral=True)
        return

    channels = []
    for cid in ids:
        ch = interaction.guild.get_channel(cid)
        if not ch or not isinstance(ch, discord.TextChannel):
            continue
        perms = ch.permissions_for(interaction.guild.me)
        if perms.manage_messages and perms.read_message_history:
            channels.append(ch)

    if not channels:
        await interaction.response.send_message(
            "❌ Nenhum canal válido para limpar (verifique permissões `Gerenciar Mensagens` + `Ler Histórico`).",
            ephemeral=True
        )
        return

    await interaction.response.defer(ephemeral=True)

    start_time = datetime.datetime.now()
    total_deleted = 0
    results = []

    init_view = _build_cleanup_progress_view(0, len(channels), None, 0, start_time)
    progress_msg = await interaction.edit_original_response(view=init_view)

    for idx, ch in enumerate(channels, start=1):
        last_update = {"t": datetime.datetime.now()}

        async def on_progress(deleted_so_far, phase):
            now = datetime.datetime.now()
            if (now - last_update["t"]).total_seconds() < 1.8:
                return
            last_update["t"] = now
            view = _build_cleanup_progress_view(
                idx - 1, len(channels), ch, deleted_so_far, start_time, phase
            )
            try:
                await progress_msg.edit(view=view)
            except Exception:
                pass

        ch_deleted, _err = await _purge_channel(ch, interaction.guild, on_progress)
        total_deleted += ch_deleted
        results.append((ch, ch_deleted))

        view = _build_cleanup_progress_view(idx, len(channels), None, 0, start_time)
        try:
            await progress_msg.edit(view=view)
        except Exception:
            pass

    elapsed = (datetime.datetime.now() - start_time).total_seconds()
    m, s = int(elapsed // 60), int(elapsed % 60)

    lines = [
        f"### ✅ Resumo",
        f"**Tempo total:** `{m:02d}m {s:02d}s`",
        f"**Canais limpos:** `{len(results)}`",
        f"**Total apagado:** `{total_deleted}` mensagens",
        "",
        "### 📋 Por canal",
    ]
    for ch, cnt in results:
        lines.append(f"• {ch.mention} — `{cnt}` mensagens")

    summary = "\n".join(lines)
    try:
        await progress_msg.edit(view=_build_cleanup_final_view(summary))
    except Exception:
        pass

    log_id = config.get("moderation_logs_channel_id")
    if log_id:
        log_ch = interaction.guild.get_channel(log_id)
        if log_ch:
            try:
                await log_ch.send(
                    f"🧹 **Limpeza Múltipla** por {interaction.user.mention}\n"
                    f"**Canais:** {len(results)} | **Total:** `{total_deleted}`\n" +
                    "\n".join(f"• {ch.mention} — `{cnt}`" for ch, cnt in results)
                )
            except Exception:
                pass

    _cleanup_selection.pop(user_id, None)

def show_config_view():
    layout = ui.LayoutView(timeout=300)
    def role_list(key):
        ids = config.get(key, [])
        if not ids: return "—"
        return ", ".join(f"<@&{r}>" for r in ids)
    def ch(key):
        cid = config.get(key)
        return f"<#{cid}>" if cid else "—"

    method_labels = {"math": "🧮 Matemática", "button": "🔘 Botão"}
    diff_labels = {1: "Fácil", 2: "Médio", 3: "Difícil"}
    kick = config.get("verification_kick_minutes", 0)

    lines = [
        f"### 🏷️ Marca",
        f"**Nome:** {bname()} {bemoji()}",
        f"**Guild ID:** `{config.get('guild_id')}`",
        f"**Admin Roles:** {role_list('admin_role_ids')}",
        "",
        f"### 🚫 Anti-Bot",
        f"**Canal:** {ch('antibot_channel_id')}",
        f"**Log:** {ch('antibot_log_channel_id')}",
        f"**Banir:** `{config.get('antibot_punish_ban')}`  |  **Apagar msgs:** `{config.get('antibot_delete_messages')}`",
        f"**Total punidos:** `{get_antibot_count()}`",
        "",
        f"### ✅ Captcha",
        f"**Método:** `{method_labels.get(config.get('verification_method','math'),'—')}`",
        f"**Dificuldade:** `{diff_labels.get(config.get('verification_difficulty',1),'—')}`",
        f"**Kick auto:** `{'Desativado' if not kick else f'{kick} min'}`",
        f"**Cargos Verificados:** {role_list('verified_role_ids')}",
        f"**Cargos Não Verificado:** {role_list('verification_unverified_role_ids')}",
        f"**Canal Verif:** {ch('verification_channel_id')}",
        f"**Canal Painel:** {ch('verification_panel_channel_id')}",
        f"**Canal Log:** {ch('verification_log_channel_id')}",
        "",
        f"### 💌 Boas-vindas & Saída",
        f"**Entrada:** {ch('welcome_channel_id')}",
        f"**Saída:** {ch('leave_channel_id')}",
        "",
        f"### 🎙️ Logs de Voz",
        f"**Entrou na Call:** {ch('voice_join_log_channel_id')}",
        f"**Saiu da Call:** {ch('voice_leave_log_channel_id')}",
        "",
        f"### 🔊 Voz & Status",
        f"**Canal 24h:** {ch('voice_channel_id')}",
        f"**Mute:** `{config.get('voice_mute')}`  |  **Status:** `{config.get('bot_status')}`",
        "",
        f"### 🎫 Tickets",
        f"**Suporte:** {role_list('ticket_support_role_ids')}",
        f"**Painel:** {ch('ticket_panel_channel_id')}",
        f"**Logs:** {ch('ticket_logs_channel_id')}",
        f"**Cat Dúvidas:** {ch('ticket_category_doubt_id')}",
        f"**Cat Compras:** {ch('ticket_category_purchase_id')}",
        "",
        f"### 💬 Comunidade",
        f"**Feedback:** {ch('feedback_channel_id')}",
        f"**Sugestões Painel:** {ch('suggestions_panel_channel_id')}",
        f"**Sugestões Canal:** {ch('suggestions_channel_id')}",
        f"**Logs Moderação:** {ch('moderation_logs_channel_id')}",
    ]

    layout.add_item(ui.Container(
        ui.TextDisplay("# 📋 Configuração Atual"),
        ui.Section(
            ui.TextDisplay("Tudo que está configurado no bot **agora mesmo**."),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.TextDisplay("\n".join(lines)),
        ui.Separator(spacing=discord.SeparatorSpacing.large),
        ui.ActionRow(_btn("Voltar ao Menu", "back_main", D, "↩️")),
        accent_color=color_primary(),
    ))
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
    role_select = ui.RoleSelect(
        placeholder="Selecione cargos (múltiplos)",
        min_values=0, max_values=25,
        default_values=selected if selected else None,
    )
    async def on_role_select(interaction: discord.Interaction):
        ids = [int(r.id) for r in role_select.values]
        config[key] = ids
        save_config(config)
        if ids:
            await interaction.response.send_message(
                f"✅ **{title}:** {len(ids)} cargo(s).\n" + "\n".join(f"• <@&{i}>" for i in ids),
                ephemeral=True
            )
        else:
            await interaction.response.send_message(f"✅ **{title}:** nenhum cargo definido.", ephemeral=True)
    role_select.callback = on_role_select
    layout.add_item(ui.Container(
        ui.TextDisplay(f"# 👑 {title}"),
        ui.Section(
            ui.TextDisplay("Selecione **um ou mais cargos**. Depois de escolher, feche esta mensagem."),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(role_select),
        accent_color=color_primary(),
    ))
    return layout

def single_channel_view(key, title, admin_only=False):
    layout = ui.LayoutView(timeout=180)
    opts = text_channel_options()
    sel = _safe_select(placeholder=title, options=opts, min_values=1, max_values=1)
    async def cb(interaction):
        val = sel.values[0]
        if val == "none":
            await interaction.response.send_message("❌ Nenhum canal.", ephemeral=True); return
        config[key] = int(val); save_config(config)
        ch = interaction.guild.get_channel(int(val))
        msg = f"✅ **{title}:** <#{val}>"
        if admin_only and ch:
            await make_channel_admin_only(ch)
            msg += "\n🔒 Canal restrito a **admins**."
        await interaction.response.send_message(msg, ephemeral=True)
    sel.callback = cb
    layout.add_item(ui.Container(
        ui.TextDisplay(f"# 📌 {title}"),
        ui.Section(
            ui.TextDisplay("Escolha o canal desejado no menu abaixo."),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel),
        accent_color=color_primary(),
    ))
    return layout

def single_voice_view(key, title):
    layout = ui.LayoutView(timeout=180)
    opts = voice_channel_options()
    sel = _safe_select(placeholder=title, options=opts, min_values=1, max_values=1)
    async def cb(interaction):
        val = sel.values[0]
        if val == "none":
            await interaction.response.send_message("❌ Nenhum canal.", ephemeral=True); return
        config[key] = int(val); save_config(config)
        guild = interaction.guild
        channel = guild.get_channel(int(val))
        if channel and isinstance(channel, discord.VoiceChannel):
            try:
                if not guild.voice_client: await channel.connect()
                else: await guild.voice_client.move_to(channel)
                await update_voice_name_impl()
                await update_voice_mute()
            except Exception: pass
        await interaction.response.send_message(f"✅ **{title}:** {channel.name if channel else val}", ephemeral=True)
    sel.callback = cb
    layout.add_item(ui.Container(
        ui.TextDisplay(f"# 🔊 {title}"),
        ui.Section(
            ui.TextDisplay("Escolha o canal de voz desejado no menu abaixo."),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel),
        accent_color=color_primary(),
    ))
    return layout

def single_category_view(key, title):
    layout = ui.LayoutView(timeout=180)
    opts = category_options()
    sel = _safe_select(placeholder=title, options=opts, min_values=1, max_values=1)
    async def cb(interaction):
        val = sel.values[0]
        if val == "none":
            await interaction.response.send_message("❌ Nenhuma categoria.", ephemeral=True); return
        config[key] = int(val); save_config(config)
        await interaction.response.send_message(f"✅ **{title}** definida.", ephemeral=True)
    sel.callback = cb
    layout.add_item(ui.Container(
        ui.TextDisplay(f"# 📂 {title}"),
        ui.Section(
            ui.TextDisplay("Escolha a categoria no menu abaixo."),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel),
        accent_color=color_primary(),
    ))
    return layout

def status_view():
    layout = ui.LayoutView(timeout=180)
    sel = _safe_select(
        placeholder="Escolha o status de presença",
        options=[
            discord.SelectOption(label="Online",        value="online",    emoji="🟢"),
            discord.SelectOption(label="Ausente",       value="idle",      emoji="🟡"),
            discord.SelectOption(label="Não perturbar", value="dnd",       emoji="🔴"),
            discord.SelectOption(label="Invisível",     value="invisible", emoji="⚫"),
        ],
        min_values=1, max_values=1,
    )
    async def cb(interaction):
        config["bot_status"] = sel.values[0]; save_config(config)
        await update_status()
        await interaction.response.send_message(f"✅ Status: **{sel.values[0]}**", ephemeral=True)
    sel.callback = cb
    layout.add_item(ui.Container(
        ui.TextDisplay("# 🎭 Status do Bot"),
        ui.Section(
            ui.TextDisplay("Escolha como o bot aparecerá na lista de membros."),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel),
        accent_color=color_primary(),
    ))
    return layout

def verification_method_view():
    layout = ui.LayoutView(timeout=180)
    sel = _safe_select(
        placeholder="Escolha o método de verificação",
        options=[
            discord.SelectOption(label="🧮 Matemática", value="math", description="Resolver conta para verificar"),
            discord.SelectOption(label="🔘 Botão",      value="button", description="Apenas clicar em verificar"),
        ],
        min_values=1, max_values=1,
    )
    async def cb(interaction):
        config["verification_method"] = sel.values[0]; save_config(config)
        await interaction.response.send_message(f"✅ Método: **{sel.values[0]}**", ephemeral=True)
    sel.callback = cb
    layout.add_item(ui.Container(
        ui.TextDisplay("# 🔀 Método de Verificação"),
        ui.Section(
            ui.TextDisplay("Escolha como os usuários irão se verificar."),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel),
        accent_color=color_secondary(),
    ))
    return layout

def verification_diff_view():
    layout = ui.LayoutView(timeout=180)
    sel = _safe_select(
        placeholder="Escolha a dificuldade da matemática",
        options=[
            discord.SelectOption(label="Fácil",   value="1", description="Números de 1 a 10"),
            discord.SelectOption(label="Médio",   value="2", description="Números de 10 a 50 + multiplicação"),
            discord.SelectOption(label="Difícil", value="3", description="Números de 100 a 500"),
        ],
        min_values=1, max_values=1,
    )
    async def cb(interaction):
        config["verification_difficulty"] = int(sel.values[0]); save_config(config)
        await interaction.response.send_message(f"✅ Dificuldade atualizada!", ephemeral=True)
    sel.callback = cb
    layout.add_item(ui.Container(
        ui.TextDisplay("# 🎚️ Dificuldade"),
        ui.Section(
            ui.TextDisplay("Escolha a dificuldade do desafio de matemática."),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(sel),
        accent_color=color_secondary(),
    ))
    return layout

# ===================== ✨ PAINÉIS PÚBLICOS V2 =====================

def verification_panel_layout():
    """Painel público de verificação — V2."""
    comps = [
        ui.TextDisplay(f"# ✅ Verificação — {bname()}"),
        ui.Section(
            ui.TextDisplay(
                "### 🔐 Sistema de Verificação\n"
                f"Olá! Para ter acesso completo ao **{bname()}**, você precisa se verificar.\n\n"
                "**Como funciona:**\n"
                "> • Clique no botão **✅ Verificar Agora**\n"
                "> • Resolva o desafio que aparecer\n"
                "> • Pronto! Você receberá os cargos automaticamente 🖤"
            ),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
    ]

    banner = banner_welcome() or banner_painel()
    if banner:
        mg = _safe_media_gallery(banner)
        if mg is not None:
            comps.append(mg)

    comps.append(ui.ActionRow(
        _btn("Verificar Agora", "verify_now", SU, "🔐")
    ))
    comps.append(ui.TextDisplay(f"-# {bfooter()}"))

    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=color_secondary()))
    return layout


def ticket_panel_layout():
    """Painel público de tickets — V2."""
    comps = [
        ui.TextDisplay(f"# 🎫 Central de Tickets — {bname()}"),
        ui.Section(
            ui.TextDisplay(
                "### 💬 Precisa de ajuda ou quer comprar algo?\n"
                "Selecione uma opção abaixo para abrir um **ticket privado** com nossa equipe.\n\n"
                "**❓ Dúvidas** — suporte geral, ajuda, perguntas\n"
                "**🛒 Compras** — produtos, serviços e pagamentos\n\n"
                "-# Nossa equipe responderá o mais rápido possível 🖤"
            ),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
    ]

    banner = banner_ticket()
    if banner:
        mg = _safe_media_gallery(banner)
        if mg is not None:
            comps.append(mg)

    comps.append(ui.ActionRow(
        _btn("Abrir Ticket — Dúvidas", "ticket_open_doubt", P, "❓"),
        _btn("Abrir Ticket — Compras", "ticket_open_purchase", SU, "🛒"),
    ))
    comps.append(ui.TextDisplay(f"-# {bfooter()}"))

    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=color_primary()))
    return layout


def suggestion_panel_layout():
    """Painel público de sugestões — V2."""
    comps = [
        ui.TextDisplay(f"# 💡 Sugestões — {bname()}"),
        ui.Section(
            ui.TextDisplay(
                "### 🗳️ Sua voz importa!\n"
                "Tem uma ideia para melhorar o servidor? Compartilhe com a gente!\n\n"
                "**Como funciona:**\n"
                "> • Clique em **💡 Enviar Sugestão**\n"
                "> • Descreva sua ideia no modal\n"
                "> • A comunidade vota com 👍 ou 👎"
            ),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(
            _btn("Enviar Sugestão", "suggest_btn", P, "💡")
        ),
        ui.TextDisplay(f"-# {bfooter()}"),
    ]

    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=color_primary()))
    return layout


def ticket_actions_layout():
    """Painel de ações exibido dentro de um ticket — V2."""
    comps = [
        ui.TextDisplay("### 🔧 Ações do Ticket"),
        ui.TextDisplay(
            "-# Use os botões abaixo para gerenciar este atendimento."
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(
            _btn("Avaliar",   "rate_ticket",  P,  "⭐"),
            _btn("Fechar",    "close_ticket", D,  "🔒"),
            _btn("Adicionar", "add_member",   S,  "👤"),
        ),
    ]
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=color_primary()))
    return layout


# ===================== HANDLER GLOBAL =====================
@bot.event
async def on_interaction(interaction: discord.Interaction):
    if interaction.type != discord.InteractionType.component:
        return
    cid = interaction.data.get("custom_id", "")
    if not cid:
        return
    if cid in ("pxk_main_menu", "cleanup_multi_select", "cleanup_start",
               "antibot_counter_display"):
        return

    try:
        # ---------- IDENTIDADE ----------
        if cid == "id_name":
            await interaction.response.send_modal(BrandNameModal())
        elif cid == "id_emoji":
            await interaction.response.send_modal(BrandEmojiModal())
        elif cid == "id_footer":
            await interaction.response.send_modal(BrandFooterModal())
        elif cid == "id_c1":
            await interaction.response.send_modal(ColorModal("brand_color_primary", "Cor Primária"))
        elif cid == "id_c2":
            await interaction.response.send_modal(ColorModal("brand_color_secondary", "Cor Secundária"))
        elif cid == "id_c3":
            await interaction.response.send_modal(ColorModal("brand_color_success", "Cor de Sucesso"))
        elif cid == "id_c4":
            await interaction.response.send_modal(ColorModal("brand_color_danger", "Cor de Perigo"))
        elif cid == "id_avatar":
            await interaction.response.send_modal(URLModal("avatar_url", "URL do Avatar"))
        elif cid == "id_bp":
            await interaction.response.send_modal(URLModal("banner_painel_url", "URL do Banner do Painel"))
        elif cid == "id_bt":
            await interaction.response.send_modal(URLModal("banner_ticket_url", "URL do Banner de Tickets"))
        elif cid == "id_bw":
            await interaction.response.send_modal(URLModal("banner_welcome_url", "URL do Banner de Boas-vindas"))
        elif cid == "id_apply":
            await interaction.response.defer(ephemeral=True)
            ok = await apply_avatar_if_needed(force=True)
            await interaction.followup.send("✅ Avatar aplicado!" if ok else "❌ Falha ao aplicar avatar.", ephemeral=True)
        elif cid == "id_preview":
            await interaction.response.send_message(view=painel_layout(), ephemeral=True)

        # ---------- ANTI-BOT ----------
        elif cid == "ab_ch":
            await interaction.response.send_message(view=single_channel_view("antibot_channel_id", "Canal Anti-Bot"), ephemeral=True)
        elif cid == "ab_log":
            await interaction.response.send_message(view=single_channel_view("antibot_log_channel_id", "Canal de Log AntiBot", admin_only=True), ephemeral=True)
        elif cid == "ab_banner":
            await interaction.response.send_modal(URLModal("antibot_banner_url", "URL do Banner AntiBot"))
        elif cid == "ab_title":
            await interaction.response.send_modal(AntibotTitleModal())
        elif cid == "ab_desc":
            await interaction.response.send_modal(AntibotDescModal())
        elif cid == "ab_toggle_ban":
            config["antibot_punish_ban"] = not config.get("antibot_punish_ban", True)
            save_config(config)
            await interaction.response.send_message(
                f"✅ Banimento **{'ativado' if config['antibot_punish_ban'] else 'desativado'}**.",
                ephemeral=True
            )
        elif cid == "ab_toggle_del":
            config["antibot_delete_messages"] = not config.get("antibot_delete_messages", True)
            save_config(config)
            await interaction.response.send_message(
                f"✅ Apagar mensagens **{'ativado' if config['antibot_delete_messages'] else 'desativado'}**.",
                ephemeral=True
            )
        elif cid == "ab_post":
            await post_antibot_panel(interaction)
        elif cid == "ab_preview":
            await interaction.response.send_message(view=antibot_panel_view(), ephemeral=True)

        # ---------- CAPTCHA ----------
        elif cid == "cap_roles":
            await interaction.response.send_message(view=multi_role_view("verified_role_ids", "Cargos Entregues (verificados)", config.get("verified_role_ids", [])), ephemeral=True)
        elif cid == "cap_unver":
            await interaction.response.send_message(view=multi_role_view("verification_unverified_role_ids", "Cargos Não Verificado", config.get("verification_unverified_role_ids", [])), ephemeral=True)
        elif cid == "cap_method":
            await interaction.response.send_message(view=verification_method_view(), ephemeral=True)
        elif cid == "cap_diff":
            await interaction.response.send_message(view=verification_diff_view(), ephemeral=True)
        elif cid == "cap_kick":
            await interaction.response.send_modal(KickTimeModal())
        elif cid == "cap_ch":
            await interaction.response.send_message(view=single_channel_view("verification_channel_id", "Canal de Verificação"), ephemeral=True)
        elif cid == "cap_pch":
            await interaction.response.send_message(view=single_channel_view("verification_panel_channel_id", "Canal do Painel"), ephemeral=True)
        elif cid == "cap_log":
            await interaction.response.send_message(view=single_channel_view("verification_log_channel_id", "Canal de Log", admin_only=True), ephemeral=True)

        # ---------- BOAS-VINDAS & SAÍDA ----------
        elif cid == "wel_ch":
            await interaction.response.send_message(view=single_channel_view("welcome_channel_id", "Canal de Boas-vindas"), ephemeral=True)
        elif cid == "wel_msg":
            await interaction.response.send_modal(WelcomeDefaultMessageModal())
        elif cid == "wel_img":
            await interaction.response.send_modal(URLModal("welcome_image_url", "URL da Imagem de Boas-vindas"))
        elif cid == "wel_test":
            await interaction.response.defer(ephemeral=True)
            await send_welcome_message(interaction.user)
            await interaction.followup.send("✅ Teste de boas-vindas enviado!", ephemeral=True)
        elif cid == "lev_ch":
            await interaction.response.send_message(view=single_channel_view("leave_channel_id", "Canal de Saída"), ephemeral=True)
        elif cid == "lev_msg":
            await interaction.response.send_modal(LeaveMessageModal())
        elif cid == "lev_test":
            await interaction.response.defer(ephemeral=True)
            await send_leave_message(interaction.user)
            await interaction.followup.send("✅ Teste de saída enviado!", ephemeral=True)

        # ---------- LOGS DE VOZ ----------
        elif cid == "vl_join_ch":
            await interaction.response.send_message(view=single_channel_view("voice_join_log_channel_id", "Canal de Log — Entrou", admin_only=True), ephemeral=True)
        elif cid == "vl_leave_ch":
            await interaction.response.send_message(view=single_channel_view("voice_leave_log_channel_id", "Canal de Log — Saiu", admin_only=True), ephemeral=True)
        elif cid == "vl_join_test":
            await interaction.response.defer(ephemeral=True)
            vc = interaction.guild.voice_client
            fake_channel = vc.channel if vc and vc.channel else (interaction.guild.voice_channels[0] if interaction.guild.voice_channels else None)
            if fake_channel:
                await send_voice_log(interaction.user, fake_channel, "join")
                await interaction.followup.send("✅ Teste de log de entrada enviado!", ephemeral=True)
            else:
                await interaction.followup.send("❌ Nenhum canal de voz disponível.", ephemeral=True)
        elif cid == "vl_leave_test":
            await interaction.response.defer(ephemeral=True)
            vc = interaction.guild.voice_client
            fake_channel = vc.channel if vc and vc.channel else (interaction.guild.voice_channels[0] if interaction.guild.voice_channels else None)
            if fake_channel:
                await send_voice_log(interaction.user, fake_channel, "leave")
                await interaction.followup.send("✅ Teste de log de saída enviado!", ephemeral=True)
            else:
                await interaction.followup.send("❌ Nenhum canal de voz disponível.", ephemeral=True)

        # ---------- VOZ ----------
        elif cid == "v_mute":
            config["voice_mute"] = not config.get("voice_mute", True)
            save_config(config)
            await update_voice_mute()
            await interaction.response.send_message(f"✅ Mute {'ativado' if config['voice_mute'] else 'desativado'}.", ephemeral=True)
        elif cid == "v_status":
            await interaction.response.send_message(view=status_view(), ephemeral=True)
        elif cid == "v_ch":
            await interaction.response.send_message(view=single_voice_view("voice_channel_id", "Canal de Voz 24h"), ephemeral=True)

        # ---------- ADMIN ----------
        elif cid == "adm_roles":
            await interaction.response.send_message(view=multi_role_view("admin_role_ids", "Cargos de Admin", config.get("admin_role_ids", [])), ephemeral=True)

        # ---------- PAINEL FIXO ----------
        elif cid == "pf_ch":
            await interaction.response.send_message(view=single_channel_view("painel_channel_id", "Canal do Painel Principal"), ephemeral=True)

        # ---------- TICKETS ----------
        elif cid == "tk_cat_d":
            await interaction.response.send_message(view=single_category_view("ticket_category_doubt_id", "Categoria Dúvidas"), ephemeral=True)
        elif cid == "tk_cat_p":
            await interaction.response.send_message(view=single_category_view("ticket_category_purchase_id", "Categoria Compras"), ephemeral=True)
        elif cid == "tk_sup":
            await interaction.response.send_message(view=multi_role_view("ticket_support_role_ids", "Cargos de Suporte", config.get("ticket_support_role_ids", [])), ephemeral=True)
        elif cid == "tk_logs":
            await interaction.response.send_message(view=single_channel_view("ticket_logs_channel_id", "Logs de Tickets"), ephemeral=True)
        elif cid == "tk_panel":
            await interaction.response.send_message(view=single_channel_view("ticket_panel_channel_id", "Canal do Painel de Tickets"), ephemeral=True)
        elif cid == "tk_mod":
            await interaction.response.send_message(view=single_channel_view("moderation_logs_channel_id", "Logs de Moderação"), ephemeral=True)

        # ---------- FEEDBACK ----------
        elif cid == "fb_ch":
            await interaction.response.send_message(view=single_channel_view("feedback_channel_id", "Canal de Feedback"), ephemeral=True)

        # ---------- SUGESTÕES ----------
        elif cid == "sg_pch":
            await interaction.response.send_message(view=single_channel_view("suggestions_panel_channel_id", "Canal do Painel de Sugestões"), ephemeral=True)
        elif cid == "sg_ch":
            await interaction.response.send_message(view=single_channel_view("suggestions_channel_id", "Canal de Sugestões"), ephemeral=True)

        # ---------- VOLTAR ----------
        elif cid == "back_main":
            await interaction.response.edit_message(view=painel_layout())

        # ---------- BOTÕES DE AÇÃO ----------
        elif cid == "ticket_open_doubt":
            await handle_ticket_open(interaction, "doubt", "Dúvidas")
        elif cid == "ticket_open_purchase":
            await handle_ticket_open(interaction, "purchase", "Compras")
        elif cid == "suggest_btn":
            await interaction.response.send_modal(SuggestionModal())
        elif cid == "verify_now":
            await handle_captcha_start(interaction)
        elif cid == "captcha_solve":
            await interaction.response.send_modal(CaptchaModal.from_button(interaction))
        elif cid == "captcha_button_verify":
            await handle_button_verify(interaction)
        elif cid == "rate_ticket":
            await interaction.response.send_modal(TicketRatingModal(interaction.channel.name))
        elif cid == "close_ticket":
            await interaction.response.send_message("⚠️ Fechar este ticket?", view=ConfirmCloseView(interaction.channel.id), ephemeral=True)
        elif cid == "add_member":
            await interaction.response.send_message(view=AddMemberView(), ephemeral=True)

    except discord.errors.NotFound:
        pass
    except discord.errors.InteractionResponded:
        pass
    except Exception as e:
        logger.error(f"Erro interaction {cid}: {e}", exc_info=True)

# ===================== ANTI-BOT — POST PANEL =====================
async def post_antibot_panel(interaction: discord.Interaction):
    cid = config.get("antibot_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Defina o **Canal Anti-Bot** primeiro.", ephemeral=True)
        return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Canal inválido.", ephemeral=True)
        return
    try:
        msg = await ch.send(view=antibot_panel_view())
    except Exception as e:
        await interaction.response.send_message(f"❌ Erro: `{e}`", ephemeral=True)
        return
    config["antibot_panel_message_id"] = msg.id
    save_config(config)
    await interaction.response.send_message(f"✅ Painel AntiBot enviado em {ch.mention}!", ephemeral=True)

# ===================== MODAIS =====================
class BrandNameModal(ui.Modal, title="✏️ Nome da Marca"):
    v = ui.TextInput(label="Nome da marca", required=True, max_length=50)
    async def on_submit(self, interaction):
        config["brand_name"] = self.v.value.strip(); save_config(config)
        await update_status()
        await interaction.response.send_message(f"✅ Marca: **{config['brand_name']}**", ephemeral=True)

class BrandEmojiModal(ui.Modal, title="✨ Emoji da Marca"):
    v = ui.TextInput(label="Emoji", required=True, max_length=10)
    async def on_submit(self, interaction):
        config["brand_emoji"] = self.v.value.strip(); save_config(config)
        await update_status()
        await interaction.response.send_message(f"✅ Emoji: {config['brand_emoji']}", ephemeral=True)

class BrandFooterModal(ui.Modal, title="📝 Rodapé Padrão"):
    v = ui.TextInput(label="Texto do rodapé", required=True, max_length=120)
    async def on_submit(self, interaction):
        config["brand_footer"] = self.v.value.strip(); save_config(config)
        await interaction.response.send_message("✅ Rodapé atualizado!", ephemeral=True)

class ColorModal(ui.Modal):
    def __init__(self, key, label):
        super().__init__(title=f"🎨 {label}")
        self.key = key
        self.v = ui.TextInput(label="HEX (ex: 8A2BE2)", required=True, min_length=6, max_length=7)
        self.add_item(self.v)
    async def on_submit(self, interaction):
        raw = self.v.value.strip().replace("#", "")
        try: val = int(raw, 16)
        except ValueError:
            await interaction.response.send_message("❌ HEX inválido.", ephemeral=True); return
        config[self.key] = val; save_config(config)
        await interaction.response.send_message(f"✅ Cor: `#{raw.upper()}`", ephemeral=True)

class URLModal(ui.Modal):
    def __init__(self, key, label):
        super().__init__(title=f"🖼️ {label}")
        self.key = key
        self.v = ui.TextInput(label="URL (ou 'limpar')", required=True)
        self.add_item(self.v)
    async def on_submit(self, interaction):
        val = self.v.value.strip()
        if val.lower() in ("limpar", "clear", "none", "remover"):
            config[self.key] = ""; save_config(config)
            await refresh_antibot_panel()
            await interaction.response.send_message("✅ URL removida.", ephemeral=True); return
        if not (val.startswith("http://") or val.startswith("https://")):
            await interaction.response.send_message("❌ URL inválida.", ephemeral=True); return
        config[self.key] = val; save_config(config)
        await refresh_antibot_panel()
        await interaction.response.send_message("✅ URL salva!", ephemeral=True)

class AntibotTitleModal(ui.Modal, title="✏️ Título do Painel AntiBot"):
    v = ui.TextInput(
        label="Título",
        default="• Não envie mensagem nesse canal!",
        required=True, max_length=200
    )
    async def on_submit(self, interaction):
        config["antibot_title"] = self.v.value.strip()
        save_config(config)
        await refresh_antibot_panel()
        await interaction.response.send_message("✅ Título atualizado!", ephemeral=True)

class AntibotDescModal(ui.Modal, title="📝 Descrição do Painel AntiBot"):
    v = ui.TextInput(
        label="Descrição",
        style=discord.TextStyle.paragraph,
        default=(
            "Sistema criado para prevenir bots de divulgação e outros SelfBots.\n"
            "Quem enviar mensagem aqui será punido imediatamente."
        ),
        required=True, max_length=500
    )
    async def on_submit(self, interaction):
        config["antibot_description"] = self.v.value
        save_config(config)
        await refresh_antibot_panel()
        await interaction.response.send_message("✅ Descrição atualizada!", ephemeral=True)

class WelcomeDefaultMessageModal(ui.Modal, title="Mensagem de Boas-vindas"):
    msg = ui.TextInput(label="Nova mensagem", style=discord.TextStyle.paragraph, required=True)
    async def on_submit(self, interaction):
        config["welcome_message"] = self.msg.value; save_config(config)
        await interaction.response.send_message("✅ Mensagem de entrada atualizada!", ephemeral=True)

class LeaveMessageModal(ui.Modal, title="Mensagem de Saída"):
    msg = ui.TextInput(label="Nova mensagem", style=discord.TextStyle.paragraph, required=True)
    async def on_submit(self, interaction):
        config["leave_message"] = self.msg.value; save_config(config)
        await interaction.response.send_message("✅ Mensagem de saída atualizada!", ephemeral=True)

class KickTimeModal(ui.Modal, title="⏰ Tempo para Verificar"):
    def __init__(self):
        super().__init__()
        cur = config.get("verification_kick_minutes", 0)
        self.v = ui.TextInput(
            label="Minutos (0 = desativar)",
            default=str(cur),
            required=True, min_length=1, max_length=4
        )
        self.add_item(self.v)
    async def on_submit(self, interaction):
        try:
            val = int(self.v.value.strip())
            if val < 0: raise ValueError
        except ValueError:
            await interaction.response.send_message("❌ Número inválido.", ephemeral=True); return
        config["verification_kick_minutes"] = val
        save_config(config)
        msg = "✅ Kick automático desativado." if val == 0 else f"✅ Kick em **{val} min**."
        await interaction.response.send_message(msg, ephemeral=True)

class SuggestionModal(ui.Modal, title="💡 Enviar Sugestão"):
    sugestao = ui.TextInput(label="Sua sugestão", style=discord.TextStyle.paragraph, required=True)
    async def on_submit(self, interaction):
        cid = config.get("suggestions_channel_id")
        if not cid:
            await interaction.response.send_message("❌ Canal de sugestões não configurado.", ephemeral=True); return
        channel = interaction.guild.get_channel(cid)
        if not channel:
            await interaction.response.send_message("❌ Canal inválido.", ephemeral=True); return
        e = discord.Embed(title=f"💡 Nova Sugestão — {bname()}", description=self.sugestao.value, color=color_primary())
        e.set_author(name=interaction.user.display_name, icon_url=interaction.user.display_avatar.url)
        e.set_footer(text=f"ID: {interaction.user.id} • {bname()}")
        msg = await channel.send(embed=e)
        await msg.add_reaction("👍"); await msg.add_reaction("👎")
        await interaction.response.send_message("✅ Sugestão enviada!", ephemeral=True)

class TicketRatingModal(ui.Modal, title="⭐ Avaliar Atendimento"):
    def __init__(self, ticket_name):
        super().__init__()
        self.ticket_name = ticket_name
        self.rating = ui.Select(placeholder="Nota", options=[
            discord.SelectOption(label=f"{i} - {['Péssimo','Ruim','Regular','Bom','Excelente'][i-1]}", value=str(i), emoji="⭐")
            for i in range(1, 6)
        ])
        self.add_item(self.rating)
        self.comment = ui.TextInput(label="Comentário (opcional)", style=discord.TextStyle.paragraph, required=False)
        self.add_item(self.comment)
    async def on_submit(self, interaction):
        rating = int(self.rating.values[0])
        comment = self.comment.value or "Sem comentário"
        try: add_ticket_feedback(interaction.channel.id, interaction.user.id, rating, comment)
        except Exception: pass
        fb_id = config.get("feedback_channel_id")
        if fb_id:
            ch = interaction.guild.get_channel(fb_id)
            if ch:
                e = discord.Embed(
                    title=f"⭐ Nova Avaliação — {bname()}",
                    description=f"**Usuário:** {interaction.user.mention}\n**Ticket:** {self.ticket_name}\n**Nota:** {'⭐'*rating} ({rating}/5)\n**Comentário:** {comment}",
                    color=color_primary(), timestamp=datetime.datetime.now()
                )
                try: await ch.send(embed=e)
                except Exception: pass
        await interaction.response.send_message("✅ Obrigado!", ephemeral=True)

# ===================== VIEWS SIMPLES =====================
class ConfirmCloseView(ui.View):
    def __init__(self, channel_id):
        super().__init__(timeout=60)
        self.channel_id = channel_id
    @ui.button(label="✅ Sim, fechar", style=discord.ButtonStyle.danger)
    async def confirm(self, interaction, button):
        ch = interaction.guild.get_channel(self.channel_id)
        if ch:
            log_id = config.get("ticket_logs_channel_id")
            if log_id:
                log_ch = interaction.guild.get_channel(log_id)
                if log_ch:
                    try: await log_ch.send(f"🔒 Ticket `{ch.name}` fechado por {interaction.user.mention}.")
                    except Exception: pass
            try: remove_open_ticket(ch.id)
            except Exception: pass
            try: await ch.delete()
            except Exception: pass
        await interaction.response.send_message("✅ Ticket fechado.", ephemeral=True)

class AddMemberView(ui.View):
    def __init__(self):
        super().__init__(timeout=60)
        guild = get_guild()
        opts = []
        if guild:
            for m in guild.members:
                if not m.bot:
                    opts.append(discord.SelectOption(label=m.display_name[:100], value=str(m.id)))
        if not opts: opts = [discord.SelectOption(label="Nenhum", value="none")]
        sel = ui.Select(placeholder="Escolha um membro", options=opts[:25])
        sel.callback = self.on_select
        self.add_item(sel)
    async def on_select(self, interaction):
        val = interaction.data["values"][0]
        if val == "none":
            await interaction.response.send_message("❌ Nenhum.", ephemeral=True); return
        member = interaction.guild.get_member(int(val))
        if member:
            try:
                await interaction.channel.set_permissions(member, view_channel=True, send_messages=True, read_message_history=True)
                await interaction.response.send_message(f"✅ {member.mention} adicionado.", ephemeral=True)
            except Exception as e:
                await interaction.response.send_message(f"❌ Erro: {e}", ephemeral=True)

# ===================== TICKETS =====================
async def handle_ticket_open(interaction, tipo, nome):
    try:
        count = count_user_tickets_last_hours(interaction.user.id, 8)
    except Exception:
        count = 0
    if count >= 3:
        await interaction.response.send_message("❌ Limite de 3 tickets em 8h.", ephemeral=True); return
    guild = interaction.guild
    cid = config.get(f"ticket_category_{tipo}_id")
    if not cid:
        await interaction.response.send_message("❌ Categoria não configurada.", ephemeral=True); return
    category = guild.get_channel(cid)
    if not category or not isinstance(category, discord.CategoryChannel):
        await interaction.response.send_message("❌ Categoria inválida.", ephemeral=True); return

    overwrites = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        interaction.user: discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True, attach_files=True),
    }
    mentions = []
    for rid in config.get("ticket_support_role_ids", []):
        role = guild.get_role(rid)
        if role:
            overwrites[role] = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True)
            mentions.append(role.mention)

    nome_canal = f"ticket-{tipo}-{interaction.user.name[:20]}".lower().replace(" ", "-")
    try:
        channel = await guild.create_text_channel(name=nome_canal, category=category, overwrites=overwrites,
                                                    reason=f"Ticket {nome} por {interaction.user}")
    except Exception as e:
        await interaction.response.send_message(f"❌ Erro: {e}", ephemeral=True); return

    try: add_open_ticket(interaction.user.id, channel.id)
    except Exception: pass

    # ✅ Boas-vindas V2 do ticket
    welcome_comps = [
        ui.TextDisplay(f"# {bemoji()} Ticket de {nome} — {bname()}"),
        ui.Section(
            ui.TextDisplay(
                f"**Olá {interaction.user.mention}!** Bem-vindo(a) ao atendimento. 💜\n\n"
                "Descreva seu pedido abaixo e nossa equipe responderá em breve.\n"
                "-# Ações disponíveis no painel fixado abaixo."
            ),
            accessory=ui.Thumbnail(media=interaction.user.display_avatar.url),
        ),
    ]
    banner = banner_ticket()
    if banner:
        mg = _safe_media_gallery(banner)
        if mg is not None:
            welcome_comps.append(mg)
    welcome_layout = ui.LayoutView(timeout=None)
    welcome_layout.add_item(ui.Container(*welcome_comps, accent_color=color_primary()))
    await channel.send(view=welcome_layout)

    if mentions:
        await channel.send(f"📢 {', '.join(mentions)} — novo ticket de {interaction.user.mention}.")

    # ✅ Painel de ações V2
    await channel.send(view=ticket_actions_layout())

    await interaction.response.send_message(f"✅ Ticket criado em {channel.mention}!", ephemeral=True)

# ===================== CAPTCHA =====================
_pending_kicks = {}
_math_answers = {}
_button_verification_target = {}

def schedule_verification_kick(guild, member):
    minutes = config.get("verification_kick_minutes", 0)
    if minutes <= 0: return
    key = (guild.id, member.id)
    if key in _pending_kicks:
        _pending_kicks[key].cancel()

    async def _kick_later():
        try:
            await asyncio.sleep(minutes * 60)
            m = guild.get_member(member.id)
            if not m: return
            unver_ids = config.get("verification_unverified_role_ids", [])
            if any(r.id in unver_ids for r in m.roles):
                try:
                    await guild.kick(m, reason="Não completou a verificação a tempo")
                except Exception as e:
                    logger.error(f"Falha ao kickar {m}: {e}")
        except asyncio.CancelledError:
            pass
        finally:
            _pending_kicks.pop(key, None)

    _pending_kicks[key] = asyncio.create_task(_kick_later())

def cancel_verification_kick(guild_id, user_id):
    key = (guild_id, user_id)
    task = _pending_kicks.pop(key, None)
    if task: task.cancel()

def _generate_math_challenge():
    diff = config.get("verification_difficulty", 1)
    if diff == 1:
        a, b = random.randint(1, 10), random.randint(1, 10)
        return f"{a} + {b}", a + b
    elif diff == 2:
        if random.random() < 0.5:
            a, b = random.randint(10, 50), random.randint(10, 50)
            return f"{a} + {b}", a + b
        a, b = random.randint(2, 12), random.randint(2, 12)
        return f"{a} × {b}", a * b
    else:
        if random.random() < 0.5:
            a, b = random.randint(100, 500), random.randint(100, 500)
            return f"{a} + {b}", a + b
        a, b = random.randint(2, 15), random.randint(2, 15)
        return f"{a} × {b}", a * b

async def _log_verification(guild, member, success, extra=""):
    cid = config.get("verification_log_channel_id")
    if not cid: return
    ch = guild.get_channel(cid)
    if not ch: return
    icon = "✅" if success else "❌"
    try:
        await ch.send(f"{icon} **{member}** (`{member.id}`) — {extra or ('verificado' if success else 'falhou')}")
    except Exception: pass

async def send_captcha_challenge(member, channel):
    method = config.get("verification_method", "math")

    # ✅ Desafio em V2
    if method == "button":
        comps = [
            ui.TextDisplay(f"# ✅ Verificação — {bname()}"),
            ui.Section(
                ui.TextDisplay(
                    f"Olá {member.mention}! Clique no botão abaixo para se verificar."
                ),
                accessory=ui.Thumbnail(media=member.display_avatar.url),
            ),
            ui.Separator(spacing=discord.SeparatorSpacing.small),
            ui.ActionRow(_btn("Verificar Agora", "captcha_button_verify", SU, "✅")),
        ]
        layout = ui.LayoutView(timeout=None)
        layout.add_item(ui.Container(*comps, accent_color=color_secondary()))
        _button_verification_target[member.id] = True
        try: await channel.send(content=member.mention, view=layout)
        except Exception as e: logger.error(f"Erro enviando verif botão: {e}")
        return

    question, answer = _generate_math_challenge()
    _math_answers[member.id] = answer

    comps = [
        ui.TextDisplay(f"# 🧮 Verificação — {bname()}"),
        ui.Section(
            ui.TextDisplay(
                f"Olá {member.mention}!\n\n"
                f"Resolva o desafio abaixo clicando em **🔐 Resolver**:\n\n"
                f"# `{question}`"
            ),
            accessory=ui.Thumbnail(media=member.display_avatar.url),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(_btn("Resolver", "captcha_solve", SU, "🔐")),
    ]
    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=color_secondary()))
    try: await channel.send(content=member.mention, view=layout)
    except Exception as e: logger.error(f"Erro enviando verif math: {e}")

async def _grant_verification(guild, member):
    for rid in config.get("verified_role_ids", []):
        r = guild.get_role(rid)
        if r and r not in member.roles:
            try: await member.add_roles(r)
            except Exception: pass
    for rid in config.get("verification_unverified_role_ids", []):
        r = guild.get_role(rid)
        if r and r in member.roles:
            try: await member.remove_roles(r)
            except Exception: pass
    cancel_verification_kick(guild.id, member.id)
    _math_answers.pop(member.id, None)
    _button_verification_target.pop(member.id, None)
    await _log_verification(guild, member, True, "verificado")

async def handle_captcha_start(interaction):
    member = interaction.user
    ch_id = config.get("verification_channel_id")
    ch = interaction.guild.get_channel(ch_id) if ch_id else interaction.channel
    if not ch:
        await interaction.response.send_message("❌ Canal de verificação não configurado.", ephemeral=True); return
    await send_captcha_challenge(member, ch)
    await interaction.response.send_message("✅ Desafio enviado! Verifique o canal.", ephemeral=True)

async def handle_button_verify(interaction):
    member = interaction.user
    await _grant_verification(interaction.guild, member)
    await interaction.response.send_message("✅ **Verificado!** Bem-vindo(a)! 🖤", ephemeral=True)

class CaptchaModal(ui.Modal, title="🧮 Verificação"):
    def __init__(self, guild_id, user_id):
        super().__init__()
        self.guild_id = guild_id
        self.user_id = user_id
        self.resposta = ui.TextInput(label="Resposta", required=True, max_length=10)
        self.add_item(self.resposta)

    @classmethod
    def from_button(cls, interaction):
        return cls(guild_id=interaction.guild.id, user_id=interaction.user.id)

    async def on_submit(self, interaction):
        guild = bot.get_guild(self.guild_id)
        if not guild:
            await interaction.response.send_message("❌ Servidor não encontrado.", ephemeral=True); return
        member = guild.get_member(self.user_id) or interaction.user

        expected = _math_answers.get(self.user_id)
        if expected is None:
            await _grant_verification(guild, member)
            await interaction.response.send_message("✅ Verificado!", ephemeral=True)
            return

        try:
            val = int(self.resposta.value.strip())
        except ValueError:
            await interaction.response.send_message("❌ Digite apenas números.", ephemeral=True); return

        if val == expected:
            await _grant_verification(guild, member)
            await interaction.response.send_message("✅ **Verificado com sucesso!** 🖤", ephemeral=True)
        else:
            await _log_verification(guild, member, False, "errou o desafio")
            await interaction.response.send_message("❌ Resposta incorreta. Tente novamente.", ephemeral=True)
            ch_id = config.get("verification_channel_id")
            ch = guild.get_channel(ch_id)
            if ch:
                await send_captcha_challenge(member, ch)

# ===================== COMANDOS =====================
@bot.tree.command(name="painelpxkadmin", description="🖤 Painel administrativo do servidor")
@app_commands.default_permissions(administrator=True)
async def cmd_painel(interaction: discord.Interaction):
    cid = config.get("painel_channel_id")
    if cid:
        channel = interaction.guild.get_channel(cid)
        if channel and config.get("painel_message_id"):
            try:
                msg = await channel.fetch_message(config["painel_message_id"])
                await msg.edit(view=painel_layout())
                await interaction.response.send_message(f"✅ Painel atualizado em {channel.mention}", ephemeral=True)
                return
            except Exception: pass
    layout = painel_layout()
    msg = await interaction.channel.send(view=layout)
    config["painel_channel_id"] = interaction.channel.id
    config["painel_message_id"] = msg.id
    save_config(config)
    await interaction.response.send_message(f"✅ Painel do **{bname()}** enviado!", ephemeral=True)

@bot.tree.command(name="painelantibot", description="🚫 Envia o painel Anti-Bot no canal configurado")
@app_commands.default_permissions(administrator=True)
async def cmd_antibot(interaction: discord.Interaction):
    cid = config.get("antibot_channel_id")
    if not cid:
        await interaction.response.send_message(
            "❌ Configure o **Canal Anti-Bot** no painel admin (`🚫 Anti-Bot > Definir Canal Anti-Bot`).",
            ephemeral=True
        )
        return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Canal inválido.", ephemeral=True); return
    try:
        msg = await ch.send(view=antibot_panel_view())
    except Exception as e:
        await interaction.response.send_message(f"❌ Erro: `{e}`", ephemeral=True); return
    config["antibot_panel_message_id"] = msg.id
    save_config(config)
    await interaction.response.send_message(f"✅ Painel AntiBot enviado em {ch.mention}!", ephemeral=True)

@bot.tree.command(name="painelticket", description="🎫 Envia o painel de tickets (V2)")
@app_commands.default_permissions(administrator=True)
async def cmd_pt(interaction):
    cid = config.get("ticket_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Configure em Tickets > Canal do Painel.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Canal inválido.", ephemeral=True); return
    msg = await ch.send(view=ticket_panel_layout())
    config["ticket_panel_message_id"] = msg.id
    save_config(config)
    await interaction.response.send_message(f"✅ Painel de tickets enviado em {ch.mention}!", ephemeral=True)

@bot.tree.command(name="painelsugestoes", description="💡 Envia o painel de sugestões (V2)")
@app_commands.default_permissions(administrator=True)
async def cmd_ps(interaction):
    cid = config.get("suggestions_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Configure em Sugestões > Canal do Painel.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Canal inválido.", ephemeral=True); return
    msg = await ch.send(view=suggestion_panel_layout())
    config["suggestions_panel_message_id"] = msg.id
    save_config(config)
    await interaction.response.send_message(f"✅ Painel de sugestões enviado em {ch.mention}!", ephemeral=True)

@bot.tree.command(name="painelverificacao", description="✅ Envia o painel de verificação (V2)")
@app_commands.default_permissions(administrator=True)
async def cmd_pv(interaction):
    cid = config.get("verification_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Configure em Verificação > Canal do Painel.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Canal inválido.", ephemeral=True); return
    msg = await ch.send(view=verification_panel_layout())
    config["verification_panel_message_id"] = msg.id
    save_config(config)
    await interaction.response.send_message(f"✅ Painel de verificação enviado em {ch.mention}!", ephemeral=True)

@bot.tree.command(name="limparchat", description="🧹 Apaga TODAS as mensagens de um canal")
@app_commands.default_permissions(administrator=True)
@app_commands.describe(canal="Canal que será totalmente limpo")
async def cmd_limpar(interaction: discord.Interaction, canal: discord.TextChannel):
    perms = canal.permissions_for(interaction.guild.me)
    if not perms.manage_messages or not perms.read_message_history:
        await interaction.response.send_message(f"❌ Sem permissão em {canal.mention}.", ephemeral=True); return
    await interaction.response.defer(ephemeral=True)
    start_time = datetime.datetime.now()
    init_view = _build_cleanup_progress_view(0, 1, None, 0, start_time)
    progress_msg = await interaction.edit_original_response(view=init_view)

    last_update = {"t": datetime.datetime.now()}
    async def on_progress(d, phase):
        now = datetime.datetime.now()
        if (now - last_update["t"]).total_seconds() < 1.8: return
        last_update["t"] = now
        v = _build_cleanup_progress_view(0, 1, canal, d, start_time, phase)
        try: await progress_msg.edit(view=v)
        except Exception: pass

    total, erro = await _purge_channel(canal, interaction.guild, on_progress)
    elapsed = (datetime.datetime.now() - start_time).total_seconds()
    m, s = int(elapsed // 60), int(elapsed % 60)
    summary = (
        f"### ✅ Resumo\n"
        f"**Tempo:** `{m:02d}m {s:02d}s`\n"
        f"**Apagadas:** `{total}`\n"
        f"**Canal:** {canal.mention}"
        + (f"\n**Erro:** `{erro}`" if erro else "")
    )
    await progress_msg.edit(view=_build_cleanup_final_view(summary))

@bot.tree.command(name="mutar", description="🔇 Muta o bot na call")
async def cmd_mutar(interaction):
    guild = interaction.guild
    vc = guild.voice_client if guild else None
    if not vc or not vc.is_connected():
        await interaction.response.send_message("❌ Bot não está em call.", ephemeral=True); return
    try:
        await guild.me.edit(mute=True)
        config["voice_mute"] = True; save_config(config)
        await interaction.response.send_message("🔇 Mutado.", ephemeral=True)
    except Exception as e:
        await interaction.response.send_message(f"❌ {e}", ephemeral=True)

@bot.tree.command(name="desmutar", description="🔊 Desmuta o bot na call")
async def cmd_desmutar(interaction):
    guild = interaction.guild
    vc = guild.voice_client if guild else None
    if not vc or not vc.is_connected():
        await interaction.response.send_message("❌ Bot não está em call.", ephemeral=True); return
    try:
        await guild.me.edit(mute=False)
        config["voice_mute"] = False; save_config(config)
        await interaction.response.send_message("🔊 Desmutado.", ephemeral=True)
    except Exception as e:
        await interaction.response.send_message(f"❌ {e}", ephemeral=True)

@bot.tree.command(name="status", description="🎭 Altera o status do bot")
async def cmd_status(interaction, modo: str):
    if modo.lower() not in ["online", "idle", "dnd", "invisible"]:
        await interaction.response.send_message("❌ Use: online, idle, dnd, invisible", ephemeral=True); return
    config["bot_status"] = modo.lower(); save_config(config)
    await update_status()
    await interaction.response.send_message(f"✅ Status: **{modo}**", ephemeral=True)

# ===================== TASKS =====================
@tasks.loop(minutes=1)
async def task_voice(): await update_voice_name_impl()

@tasks.loop(minutes=5)
async def task_status(): await update_status()

@tasks.loop(minutes=2)
async def task_voice_watchdog():
    guild = get_guild()
    if not guild: return
    cid = config.get("voice_channel_id")
    if not cid: return
    ch = guild.get_channel(cid)
    if not ch or not isinstance(ch, discord.VoiceChannel): return
    vc = guild.voice_client
    if vc and vc.is_connected():
        return
    try:
        if not vc:
            await ch.connect(timeout=15.0, reconnect=True)
        else:
            await vc.move_to(ch)
        await update_voice_mute()
    except Exception as e:
        logger.debug(f"Voice watchdog: {e}")

@tasks.loop(minutes=2)
async def task_antibot_refresh():
    try:
        await refresh_antibot_panel()
    except Exception as e:
        logger.debug(f"Antibot refresh: {e}")

# ===================== AUX =====================
async def bot_join_voice():
    guild = get_guild()
    if not guild: return
    cid = config.get("voice_channel_id")
    if not cid: return
    ch = guild.get_channel(cid)
    if not ch or not isinstance(ch, discord.VoiceChannel): return
    try:
        if not guild.voice_client:
            await ch.connect(timeout=15.0, reconnect=True)
        else:
            await guild.voice_client.move_to(ch)
        await update_voice_name_impl()
        await update_voice_mute()
    except Exception as e:
        logger.warning(f"Voz: {e}")

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
        config["_last_avatar_url"] = url; save_config(config)
        return True
    except Exception as e:
        logger.warning(f"Avatar: {e}"); return False

# ===================== EVENTOS =====================
@bot.event
async def on_ready():
    logger.info(f"{bemoji()} {bname()} conectado como {bot.user}")
    try: init_db()
    except Exception as e: logger.error(f"DB: {e}")
    if not config.get("guild_id") and bot.guilds:
        config["guild_id"] = bot.guilds[0].id; save_config(config)
    try:
        await bot.tree.sync()
        logger.info("✅ Comandos sincronizados")
    except Exception as e: logger.error(f"Sync: {e}")
    await apply_avatar_if_needed()
    await bot_join_voice()
    await update_status()
    for t in (task_voice, task_status, task_voice_watchdog, task_antibot_refresh):
        if not t.is_running(): t.start()
    try:
        await refresh_antibot_panel()
    except Exception:
        pass

@bot.event
async def on_message(message: discord.Message):
    if message.author.bot: return
    if not message.guild: return

    ab_cid = config.get("antibot_channel_id")
    if ab_cid and message.channel.id == ab_cid:
        await handle_antibot_punish(message)
        return

    await bot.process_commands(message)

@bot.event
async def on_member_join(member):
    if member.bot: return
    guild = member.guild

    try:
        await send_welcome_message(member)
    except Exception as e:
        logger.error(f"Erro send_welcome: {e}")

    for rid in config.get("verification_unverified_role_ids", []):
        r = guild.get_role(rid)
        if r:
            try: await member.add_roles(r)
            except Exception: pass

    ch_id = config.get("verification_channel_id")
    if ch_id:
        ch = guild.get_channel(ch_id)
        if ch:
            try:
                await send_captcha_challenge(member, ch)
            except Exception as e:
                logger.error(f"Erro enviando desafio: {e}")

    schedule_verification_kick(guild, member)
    await update_voice_name_impl()
    await update_status()

@bot.event
async def on_member_remove(member):
    if member.bot: return
    try:
        await send_leave_message(member)
    except Exception as e:
        logger.error(f"Erro send_leave: {e}")
    cancel_verification_kick(member.guild.id, member.id)
    await update_voice_name_impl()
    await update_status()

@bot.event
async def on_voice_state_update(member, before, after):
    if member.bot: return
    if before.channel is None and after.channel is not None:
        try:
            await send_voice_log(member, after.channel, "join")
        except Exception as e:
            logger.error(f"Erro voice join: {e}")
    elif before.channel is not None and after.channel is None:
        try:
            await send_voice_log(member, before.channel, "leave")
        except Exception as e:
            logger.error(f"Erro voice leave: {e}")

@bot.event
async def on_guild_join(guild):
    config["guild_id"] = guild.id; save_config(config)

# ===================== EXECUÇÃO =====================
if __name__ == "__main__":
    bot.run(TOKEN)