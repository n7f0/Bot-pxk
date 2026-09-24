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

    "verified_role_ids": [],
    "verification_channel_id": None,
    "verification_panel_channel_id": None,
    "verification_panel_message_id": None,

    "age_verification_enabled": False,
    "age_verified_role_ids": [],
    "age_underage_role_ids": [],
    "age_unverified_role_ids": [],
    "age_native_verification_role_ids": [],
    "age_kick_underage": True,
    "age_verification_channel_id": None,
    "age_panel_channel_id": None,
    "age_panel_message_id": None,

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
    "reminders": []
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
    _migrate_ids(data)
    save_config(data)
    return data

def _migrate_ids(data):
    pairs = [
        ("verified_role_id", "verified_role_ids"),
        ("age_verified_role_id", "age_verified_role_ids"),
        ("age_underage_role_id", "age_underage_role_ids"),
        ("age_unverified_role_id", "age_unverified_role_ids"),
        ("age_native_verification_role_id", "age_native_verification_role_ids"),
    ]
    for old, new in pairs:
        if old in data and data[old] and not data.get(new):
            data[new] = [data[old]]
        data.pop(old, None)

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
    except Exception as e: logger.error(f"Erro mute: {e}")

def calcular_idade(data_nasc):
    try:
        nasc = datetime.datetime.strptime(data_nasc, "%d/%m/%Y")
        hoje = datetime.datetime.now()
        return hoje.year - nasc.year - ((hoje.month, hoje.day) < (nasc.month, nasc.day))
    except ValueError:
        return None

def role_options(include_none=False, max_items=25):
    opts = []
    if include_none:
        opts.append(discord.SelectOption(label="Nenhum", value="none"))
    guild = get_guild()
    if guild:
        for r in guild.roles:
            if r.name != "@everyone" and not r.managed:
                opts.append(discord.SelectOption(label=r.name[:100], value=str(r.id)))
    return opts[:max_items] or [discord.SelectOption(label="Nenhum cargo", value="none")]

def text_channel_options(max_items=25):
    guild = get_guild()
    opts = []
    if guild:
        for c in guild.text_channels:
            try:
                if c.permissions_for(guild.me).send_messages:
                    opts.append(discord.SelectOption(label=f"#{c.name}"[:100], value=str(c.id)))
            except Exception: continue
    return opts[:max_items] or [discord.SelectOption(label="Nenhum canal", value="none")]

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

# ===================== CARDS PREMIUM DE MEMBRO / VOZ =====================
async def _fetch_banner_url(user_id: int):
    """Tenta obter o banner do usuário."""
    try:
        user = await bot.fetch_user(user_id)
        if user and user.banner:
            return user.banner.url
    except Exception:
        pass
    return None

def _build_member_card(
    member: discord.Member,
    title: str,
    subtitle: str,
    action: str,          # "join", "leave", "vjoin", "vleave"
    accent: int,
    banner_url: str = None,
    extra_lines: list = None,
    voice_channel: discord.abc.GuildChannel = None,
    old_voice_channel: discord.abc.GuildChannel = None,
):
    """Constrói o LayoutView V2 premium para eventos de membro/voz."""
    now_ts = int(datetime.datetime.now().timestamp())

    # Avatar grande como imagem principal
    avatar = member.display_avatar.with_size(512).url

    comps = [
        ui.TextDisplay(f"# {title}"),
        ui.Section(
            ui.TextDisplay(
                f"### {member.display_name}\n"
                f"-# {member.mention}"
            ),
            accessory=ui.Thumbnail(media=avatar),
        ),
    ]

    # Banner (se existir) — mostra foto detalhada
    if banner_url:
        comps.append(ui.MediaGallery(ui.MediaGalleryItem(media=banner_url)))

    comps.append(ui.Separator(spacing=discord.SeparatorSpacing.small))

    # Informações detalhadas
    info = []
    info.append(f"**👤 Usuário:** {member.mention}")
    info.append(f"**🏷️ Nome:** `{member.name}`")
    info.append(f"**🆔 ID:** `{member.id}`")
    info.append(f"**📅 Conta criada:** <t:{int(member.created_at.timestamp())}:R>")

    if action == "join":
        info.append(f"**👥 Membro nº:** `{member.guild.member_count}`")
    elif action == "leave":
        if member.joined_at:
            delta = datetime.datetime.now(datetime.timezone.utc) - member.joined_at
            dias = delta.days
            info.append(f"**📥 Entrou em:** <t:{int(member.joined_at.timestamp())}:R>")
            info.append(f"**⏳ Tempo no servidor:** `{dias} dias`")
        info.append(f"**👥 Restam:** `{member.guild.member_count} membros`")
    elif action == "vjoin":
        info.append(f"**🔊 Canal:** {voice_channel.mention if voice_channel else '—'}")
        info.append(f"**👥 Pessoas no canal:** `{len(voice_channel.members) if voice_channel else 0}`")
    elif action == "vleave":
        info.append(f"**🔊 Canal:** {voice_channel.mention if voice_channel else '—'}")
        info.append(f"**📤 Saiu às:** <t:{now_ts}:T>")

    if extra_lines:
        info.extend(extra_lines)

    comps.append(ui.TextDisplay("\n".join(info)))

    comps.append(ui.Separator(spacing=discord.SeparatorSpacing.small))
    comps.append(ui.TextDisplay(subtitle))
    comps.append(ui.TextDisplay(f"-# {bfooter()} • <t:{now_ts}:f>"))

    layout = ui.LayoutView(timeout=None)
    layout.add_item(ui.Container(*comps, accent_color=accent))
    return layout

# ===================== ENVIO DE LOGS DE MEMBRO / VOZ =====================
async def send_welcome_message(member: discord.Member):
    cid = config.get("welcome_channel_id")
    if not cid: return
    ch = member.guild.get_channel(cid)
    if not ch: return

    banner_url = banner_welcome() or await _fetch_banner_url(member.id)
    subtitle = config.get("welcome_message") or "Bem-vindo(a)!"

    card = _build_member_card(
        member,
        title=f"{bemoji()} Bem-vindo(a) à {bname()}!",
        subtitle=f"> {subtitle}",
        action="join",
        accent=color_success(),
        banner_url=banner_url,
    )
    try:
        await ch.send(view=card)
    except Exception as e:
        logger.error(f"Erro welcome: {e}")

async def send_leave_message(member: discord.Member):
    cid = config.get("leave_channel_id")
    if not cid: return
    ch = member.guild.get_channel(cid)
    if not ch: return

    banner_url = await _fetch_banner_url(member.id)
    subtitle = config.get("leave_message") or "Até logo! 💜"

    card = _build_member_card(
        member,
        title=f"{bemoji()} Até logo, {member.display_name}!",
        subtitle=f"> {subtitle}",
        action="leave",
        accent=color_danger(),
        banner_url=banner_url,
    )
    try:
        await ch.send(view=card)
    except Exception as e:
        logger.error(f"Erro leave: {e}")

async def send_voice_log(member: discord.Member, channel: discord.abc.GuildChannel, action: str):
    """
    action: "join" | "leave"
    """
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
    card = _build_member_card(
        member,
        title=title,
        subtitle=subtitle,
        action=act,
        accent=accent,
        banner_url=banner_url,
        voice_channel=channel,
    )
    try:
        await log_ch.send(view=card)
    except Exception as e:
        logger.error(f"Erro voice log: {e}")

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

    select = ui.Select(
        placeholder="🖤 Escolha uma categoria para configurar...",
        options=[
            discord.SelectOption(label="Identidade Visual", value="identity", emoji="🎨",
                                 description="Nome, emoji, cores e banners"),
            discord.SelectOption(label="Verificação Captcha", value="captcha", emoji="✅",
                                 description="Cargos e canais de verificação"),
            discord.SelectOption(label="Verificação +18", value="age18", emoji="🔞",
                                 description="Sistema de idade com cargos múltiplos"),
            discord.SelectOption(label="Boas-vindas & Saída", value="welcome", emoji="💌",
                                 description="Mensagens de entrada e saída"),
            discord.SelectOption(label="Logs de Voz", value="voicelogs", emoji="🎙️",
                                 description="Canais de entrada/saída da call"),
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
            discord.SelectOption(label="Eventos", value="events", emoji="📅",
                                 description="Agendar mensagens automáticas"),
            discord.SelectOption(label="Lembretes", value="reminder", emoji="⏰",
                                 description="Criar lembretes pessoais"),
            discord.SelectOption(label="Limpeza de Chat", value="chat_cleanup", emoji="🧹",
                                 description="Apagar TODAS as mensagens de um canal"),
            discord.SelectOption(label="Ver Configuração Atual", value="show_config", emoji="📋",
                                 description="Visualizar tudo que está configurado"),
        ],
        custom_id="pxk_main_menu",
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
        "captcha":      lambda: interaction.response.send_message(view=captcha_view(), ephemeral=True),
        "age18":        lambda: interaction.response.send_message(view=age_view(), ephemeral=True),
        "welcome":      lambda: interaction.response.send_message(view=welcome_view(), ephemeral=True),
        "voicelogs":    lambda: interaction.response.send_message(view=voicelogs_view(), ephemeral=True),
        "voice":        lambda: interaction.response.send_message(view=voice_view(), ephemeral=True),
        "admin":        lambda: interaction.response.send_message(view=admin_view(), ephemeral=True),
        "painel_fixo":  lambda: interaction.response.send_message(view=painel_fixo_view(), ephemeral=True),
        "tickets":      lambda: interaction.response.send_message(view=tickets_view(), ephemeral=True),
        "feedback":     lambda: interaction.response.send_message(view=feedback_view(), ephemeral=True),
        "suggestions":  lambda: interaction.response.send_message(view=suggestions_view(), ephemeral=True),
        "events":       lambda: interaction.response.send_modal(EventModal()),
        "reminder":     lambda: interaction.response.send_modal(ReminderModal()),
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

def captcha_view():
    return premium_submenu(
        "✅ Verificação Captcha",
        "Configure os **cargos entregues** após o captcha e os **canais** onde o sistema funciona.",
        [
            {"title": "👑 Cargos Entregues", "rows": [[
                _btn("Selecionar Cargos (múltiplos)", "cap_roles", P, "👥"),
            ]]},
            {"title": "📢 Canais", "rows": [[
                _btn("Canal de Verificação", "cap_ch",  P, "✅"),
                _btn("Canal do Painel",      "cap_pch", P, "📌"),
            ]]},
        ],
        accent=color_secondary(),
    )

def age_view():
    return premium_submenu(
        "🔞 Verificação +18",
        "Sistema completo de verificação de idade com **cargos múltiplos** para cada categoria.",
        [
            {"title": "⚙️ Sistema", "rows": [[
                _btn("Ativar / Desativar", "age_toggle", P, "🔁"),
                _btn("Expulsar Menores",   "age_kick",   D, "🚪"),
            ]]},
            {"title": "👑 Cargos por Categoria", "rows": [
                [
                    _btn("+18 (Maiores)",      "age_adult",  SU, "✅"),
                    _btn("-18 (Menores)",      "age_under",  P,  "🔻"),
                ],
                [
                    _btn("Não Verificado",     "age_unver",  P, "⏳"),
                    _btn("Verificação Nativa", "age_native", P, "🛡️"),
                ],
            ]},
            {"title": "📢 Canais", "rows": [[
                _btn("Canal de Verificação", "age_ch",  S, "✅"),
                _btn("Canal do Painel",      "age_pch", S, "📌"),
            ]]},
        ],
        accent=color_secondary(),
    )

# ---------- 💌 BOAS-VINDAS & SAÍDA ----------
def welcome_view():
    return premium_submenu(
        "💌 Boas-vindas & Saída",
        "Configure as mensagens premium de **entrada** e **saída** do servidor.\n"
        "-# Os cards mostram avatar, banner, ID, idade da conta e muito mais.",
        [
            {"title": "🎉 Entrada no Servidor", "rows": [
                [
                    _btn("Canal de Boas-vindas", "wel_ch",  P, "📢"),
                    _btn("Mensagem de Entrada",  "wel_msg", P, "✏️"),
                ],
                [
                    _btn("Banner de Entrada",    "wel_img", S, "🖼️"),
                    _btn("Testar Entrada",       "wel_test", SU, "🧪"),
                ],
            ]},
            {"title": "👋 Saída do Servidor", "rows": [
                [
                    _btn("Canal de Saída",       "lev_ch",  P, "📢"),
                    _btn("Mensagem de Saída",    "lev_msg", P, "✏️"),
                ],
                [
                    _btn("Testar Saída",         "lev_test", SU, "🧪"),
                ],
            ]},
            {"title": "🎯 Personalização", "rows": [[
                _btn("Personalizar por Usuário", "wel_user", S, "👤"),
            ]]},
        ],
        accent=color_primary(),
    )

# ---------- 🎙️ LOGS DE VOZ ----------
def voicelogs_view():
    return premium_submenu(
        "🎙️ Logs de Voz",
        "Escolha canais separados para registrar **quem entra** e **quem sai** das calls.\n"
        "-# Cada log mostra avatar, banner, ID, canal e horário.",
        [
            {"title": "🔊 Entrada na Call", "rows": [[
                _btn("Canal de Log — Entrou", "vl_join_ch", P, "🔊"),
                _btn("Testar Entrada",        "vl_join_test", SU, "🧪"),
            ]]},
            {"title": "🔇 Saída da Call", "rows": [[
                _btn("Canal de Log — Saiu",   "vl_leave_ch",  P, "🔇"),
                _btn("Testar Saída",          "vl_leave_test", SU, "🧪"),
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
                _btn("Mute na Call",   "v_mute",   P, "🔇"),
                _btn("Status do Bot",  "v_status", P, "🎭"),
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

# ---------- 🧹 LIMPEZA DE CHAT ----------
async def on_cleanup_select(interaction: discord.Interaction):
    val = interaction.data["values"][0]
    if val == "none":
        await interaction.response.send_message("❌ Nenhum canal disponível.", ephemeral=True)
        return

    channel = interaction.guild.get_channel(int(val))
    if not channel or not isinstance(channel, discord.TextChannel):
        await interaction.response.send_message("❌ Canal inválido.", ephemeral=True)
        return

    me = interaction.guild.me
    perms = channel.permissions_for(me)
    if not perms.manage_messages or not perms.read_message_history:
        await interaction.response.send_message(
            f"❌ Preciso de **Gerenciar Mensagens** e **Ler Histórico** em {channel.mention}.",
            ephemeral=True
        )
        return

    await interaction.response.defer(ephemeral=True)
    total, erro = await perform_chat_cleanup(channel, interaction.guild)

    log_id = config.get("moderation_logs_channel_id")
    if log_id:
        log_ch = interaction.guild.get_channel(log_id)
        if log_ch:
            try:
                await log_ch.send(
                    f"🧹 **Limpeza de Chat** — {channel.mention}\n"
                    f"• Executado por: {interaction.user.mention}\n"
                    f"• Mensagens apagadas: **{total}**"
                )
            except Exception:
                pass

    if erro:
        await interaction.followup.send(
            f"⚠️ Limpeza concluída com avisos.\n• Canal: {channel.mention}\n• Apagadas: **{total}**\n• Erro: `{erro}`",
            ephemeral=True
        )
    else:
        await interaction.followup.send(
            f"✅ **Limpeza concluída!**\n• Canal: {channel.mention}\n• Mensagens apagadas: **{total}**",
            ephemeral=True
        )

def chat_cleanup_view():
    layout = ui.LayoutView(timeout=300)
    channel_select = ui.Select(
        placeholder="🧹 Escolha o canal para apagar TUDO...",
        options=text_channel_options(),
        custom_id="cleanup_channel_select",
    )
    channel_select.callback = on_cleanup_select

    layout.add_item(ui.Container(
        ui.TextDisplay("# 🧹 Limpeza de Chat"),
        ui.Section(
            ui.TextDisplay(
                "Apaga **TODAS** as mensagens de um canal, **independente da idade**.\n"
                "-# ⚠️ Esta ação é irreversível. O bot precisa de `Gerenciar Mensagens`."
            ),
            accessory=ui.Thumbnail(media=_thumb()),
        ),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.TextDisplay("### 📂 Selecione o canal"),
        ui.ActionRow(channel_select),
        ui.Separator(spacing=discord.SeparatorSpacing.small),
        ui.ActionRow(_btn("Voltar ao Menu", "back_main", D, "↩️")),
        accent_color=color_danger(),
    ))
    return layout

def show_config_view():
    layout = ui.LayoutView(timeout=300)

    def role_list(key):
        ids = config.get(key, [])
        if not ids: return "—"
        return ", ".join(f"<@&{r}>" for r in ids)

    def ch(key):
        cid = config.get(key)
        return f"<#{cid}>" if cid else "—"

    lines = [
        f"### 🏷️ Marca",
        f"**Nome:** {bname()} {bemoji()}",
        f"**Guild ID:** `{config.get('guild_id')}`",
        f"**Admin Roles:** {role_list('admin_role_ids')}",
        "",
        f"### ✅ Captcha",
        f"**Cargos:** {role_list('verified_role_ids')}",
        f"**Canal Verif:** {ch('verification_channel_id')}",
        f"**Canal Painel:** {ch('verification_panel_channel_id')}",
        "",
        f"### 🔞 +18",
        f"**Ativo:** `{config.get('age_verification_enabled')}`  |  **Kick menores:** `{config.get('age_kick_underage')}`",
        f"**Maiores:** {role_list('age_verified_role_ids')}",
        f"**Menores:** {role_list('age_underage_role_ids')}",
        f"**Não Verif:** {role_list('age_unverified_role_ids')}",
        f"**Verif. Nativa:** {role_list('age_native_verification_role_ids')}",
        f"**Canal Verif:** {ch('age_verification_channel_id')}",
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
        placeholder=f"Selecione cargos (múltiplos)",
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

def single_channel_view(key, title):
    layout = ui.LayoutView(timeout=180)
    opts = text_channel_options()
    sel = ui.Select(placeholder=title, options=opts)
    async def cb(interaction):
        val = sel.values[0]
        if val == "none":
            await interaction.response.send_message("❌ Nenhum canal.", ephemeral=True); return
        config[key] = int(val); save_config(config)
        await interaction.response.send_message(f"✅ **{title}:** <#{val}>", ephemeral=True)
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
    sel = ui.Select(placeholder=title, options=opts)
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
    sel = ui.Select(placeholder=title, options=opts)
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
    sel = ui.Select(placeholder="Escolha o status de presença", options=[
        discord.SelectOption(label="Online",        value="online",    emoji="🟢"),
        discord.SelectOption(label="Ausente",       value="idle",      emoji="🟡"),
        discord.SelectOption(label="Não perturbar", value="dnd",       emoji="🔴"),
        discord.SelectOption(label="Invisível",     value="invisible", emoji="⚫"),
    ])
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

# ===================== HANDLER GLOBAL =====================
@bot.event
async def on_interaction(interaction: discord.Interaction):
    if interaction.type != discord.InteractionType.component:
        return
    cid = interaction.data.get("custom_id", "")
    if not cid:
        return
    if cid in ("pxk_main_menu", "cleanup_channel_select"):
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

        # ---------- CAPTCHA ----------
        elif cid == "cap_roles":
            await interaction.response.send_message(view=multi_role_view("verified_role_ids", "Cargos de Verificação", config.get("verified_role_ids", [])), ephemeral=True)
        elif cid == "cap_ch":
            await interaction.response.send_message(view=single_channel_view("verification_channel_id", "Canal de Verificação"), ephemeral=True)
        elif cid == "cap_pch":
            await interaction.response.send_message(view=single_channel_view("verification_panel_channel_id", "Canal do Painel"), ephemeral=True)

        # ---------- +18 ----------
        elif cid == "age_toggle":
            config["age_verification_enabled"] = not config.get("age_verification_enabled", False)
            save_config(config)
            await interaction.response.send_message(f"✅ Sistema +18 {'ativado' if config['age_verification_enabled'] else 'desativado'}.", ephemeral=True)
        elif cid == "age_kick":
            config["age_kick_underage"] = not config.get("age_kick_underage", True)
            save_config(config)
            await interaction.response.send_message(f"✅ Expulsão de menores {'ativada' if config['age_kick_underage'] else 'desativada'}.", ephemeral=True)
        elif cid == "age_adult":
            await interaction.response.send_message(view=multi_role_view("age_verified_role_ids", "Cargos +18 (Maiores)", config.get("age_verified_role_ids", [])), ephemeral=True)
        elif cid == "age_under":
            await interaction.response.send_message(view=multi_role_view("age_underage_role_ids", "Cargos -18 (Menores)", config.get("age_underage_role_ids", [])), ephemeral=True)
        elif cid == "age_unver":
            await interaction.response.send_message(view=multi_role_view("age_unverified_role_ids", "Cargos Não Verificado", config.get("age_unverified_role_ids", [])), ephemeral=True)
        elif cid == "age_native":
            await interaction.response.send_message(view=multi_role_view("age_native_verification_role_ids", "Cargos Verificação Nativa", config.get("age_native_verification_role_ids", [])), ephemeral=True)
        elif cid == "age_ch":
            await interaction.response.send_message(view=single_channel_view("age_verification_channel_id", "Canal de Verificação +18"), ephemeral=True)
        elif cid == "age_pch":
            await interaction.response.send_message(view=single_channel_view("age_panel_channel_id", "Canal do Painel de Idade"), ephemeral=True)

        # ---------- BOAS-VINDAS & SAÍDA ----------
        elif cid == "wel_ch":
            await interaction.response.send_message(view=single_channel_view("welcome_channel_id", "Canal de Boas-vindas"), ephemeral=True)
        elif cid == "wel_msg":
            await interaction.response.send_modal(WelcomeDefaultMessageModal())
        elif cid == "wel_img":
            await interaction.response.send_modal(URLModal("welcome_image_url", "URL da Imagem de Boas-vindas"))
        elif cid == "wel_user":
            await interaction.response.send_message(view=WelcomeUserSelectView(), ephemeral=True)
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
            await interaction.response.send_message(view=single_channel_view("voice_join_log_channel_id", "Canal de Log — Entrou"), ephemeral=True)
        elif cid == "vl_leave_ch":
            await interaction.response.send_message(view=single_channel_view("voice_leave_log_channel_id", "Canal de Log — Saiu"), ephemeral=True)
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
        elif cid == "captcha_verify":
            await interaction.response.send_modal(CaptchaModal.from_button(interaction))
        elif cid == "age_panel_verify":
            if not config.get("age_verification_enabled", False):
                await interaction.response.send_message("❌ Sistema desativado.", ephemeral=True); return
            await interaction.response.send_modal(AgeVerificationModal(interaction.user.id))
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

# ===================== LIMPEZA DE CHAT — CORE =====================
async def perform_chat_cleanup(channel: discord.TextChannel, guild: discord.Guild):
    total = 0
    erro = None
    cutoff = discord.utils.utcnow() - datetime.timedelta(days=13)

    # Fase 1: bulk delete < 14 dias
    try:
        while True:
            try:
                deleted = await channel.purge(limit=100, after=cutoff, bulk=True)
            except discord.HTTPException as e:
                logger.warning(f"Bulk delete falhou: {e}")
                break
            if not deleted:
                break
            total += len(deleted)
            await asyncio.sleep(1.0)
    except Exception as e:
        logger.error(f"Erro fase 1: {e}", exc_info=True)

    # Fase 2: delete individual para antigas
    erros_consecutivos = 0
    try:
        async for msg in channel.history(limit=None, before=cutoff, oldest_first=False):
            try:
                await msg.delete()
                total += 1
                erros_consecutivos = 0
                await asyncio.sleep(1.2)
            except discord.NotFound:
                continue
            except discord.Forbidden as e:
                erro = f"Forbidden: {e}"
                break
            except discord.HTTPException as e:
                erros_consecutivos += 1
                logger.warning(f"Erro delete: {e}")
                if erros_consecutivos >= 5:
                    erro = f"muitos erros: {e}"
                    break
                await asyncio.sleep(2.5)
    except Exception as e:
        logger.error(f"Erro fase 2: {e}", exc_info=True)
        erro = str(e)

    return total, erro

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
            await interaction.response.send_message("✅ URL removida.", ephemeral=True); return
        if not (val.startswith("http://") or val.startswith("https://")):
            await interaction.response.send_message("❌ URL inválida.", ephemeral=True); return
        config[self.key] = val; save_config(config)
        await interaction.response.send_message("✅ URL salva!", ephemeral=True)

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

class EventModal(ui.Modal, title="📅 Agendar Evento"):
    mensagem = ui.TextInput(label="Mensagem", style=discord.TextStyle.paragraph, required=True)
    canal_id = ui.TextInput(label="ID do Canal", required=True)
    data = ui.TextInput(label="Data (AAAA-MM-DD)", required=True)
    hora = ui.TextInput(label="Hora (HH:MM)", required=True)
    async def on_submit(self, interaction):
        try:
            channel_id = int(self.canal_id.value)
            dt = datetime.datetime.strptime(f"{self.data.value} {self.hora.value}", "%Y-%m-%d %H:%M")
        except Exception:
            await interaction.response.send_message("❌ Formato inválido.", ephemeral=True); return
        if dt < datetime.datetime.now():
            await interaction.response.send_message("❌ Data no futuro.", ephemeral=True); return
        add_scheduled_event("once", channel_id, self.mensagem.value, dt.isoformat())
        await interaction.response.send_message(f"✅ Evento agendado para {dt.strftime('%d/%m/%Y %H:%M')}.", ephemeral=True)

class ReminderModal(ui.Modal, title="⏰ Lembrete"):
    msg = ui.TextInput(label="Mensagem", style=discord.TextStyle.paragraph, required=True)
    data = ui.TextInput(label="Data (AAAA-MM-DD)", required=True)
    hora = ui.TextInput(label="Hora (HH:MM)", required=True)
    async def on_submit(self, interaction):
        try:
            dt = datetime.datetime.strptime(f"{self.data.value} {self.hora.value}", "%Y-%m-%d %H:%M")
        except Exception:
            await interaction.response.send_message("❌ Formato inválido.", ephemeral=True); return
        if dt < datetime.datetime.now():
            await interaction.response.send_message("❌ Data futura.", ephemeral=True); return
        config["reminders"].append({"user_id": interaction.user.id, "message": self.msg.value, "datetime_iso": dt.isoformat()})
        save_config(config)
        await interaction.response.send_message(f"✅ Lembrete para {dt.strftime('%d/%m/%Y %H:%M')}", ephemeral=True)

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

class AgeVerificationModal(ui.Modal, title="🔞 Verificação de Idade"):
    def __init__(self, user_id):
        super().__init__()
        self.user_id = user_id
        self.nascimento = ui.TextInput(label="Data de nascimento", placeholder="DD/MM/AAAA", required=True, min_length=10, max_length=10)
        self.add_item(self.nascimento)
    async def on_submit(self, interaction):
        guild = interaction.guild
        member = guild.get_member(self.user_id)
        if not member:
            await interaction.response.send_message("❌ Usuário não encontrado.", ephemeral=True); return
        idade = calcular_idade(self.nascimento.value)
        if idade is None:
            await interaction.response.send_message("❌ Data inválida. Use DD/MM/AAAA.", ephemeral=True); return

        adult = config.get("age_verified_role_ids", [])
        under = config.get("age_underage_role_ids", [])
        unver = config.get("age_unverified_role_ids", [])
        kick = config.get("age_kick_underage", True)

        async def add_roles(ids):
            for rid in ids:
                r = guild.get_role(rid)
                if r and r not in member.roles:
                    try: await member.add_roles(r)
                    except Exception: pass
        async def rm_roles(ids):
            for rid in ids:
                r = guild.get_role(rid)
                if r and r in member.roles:
                    try: await member.remove_roles(r)
                    except Exception: pass

        if idade >= 18:
            await add_roles(adult)
            await rm_roles(unver + under)
            await interaction.response.send_message("✅ **Verificado!** Bem-vindo(a)! 🖤", ephemeral=True)
        else:
            if kick:
                try:
                    await guild.kick(member, reason=f"Menor ({idade})")
                    await interaction.response.send_message("❌ Expulso por idade.", ephemeral=True)
                except discord.Forbidden:
                    await add_roles(under); await rm_roles(unver + adult)
                    await interaction.response.send_message("⚠️ Não foi possível expulsar. Cargo restrito aplicado.", ephemeral=True)
            else:
                await add_roles(under); await rm_roles(unver + adult)
                await interaction.response.send_message(f"🔞 **Menor de idade ({idade} anos).** Cargo restrito aplicado.", ephemeral=True)

class CaptchaModal(ui.Modal, title="🔐 Verificação Captcha"):
    def __init__(self, answer, guild_id, user_id, channel_id):
        super().__init__()
        self.answer = answer
        self.guild_id = guild_id
        self.user_id = user_id
        self.channel_id = channel_id
        self.resposta = ui.TextInput(label="Resultado", required=True)
        self.add_item(self.resposta)
    @classmethod
    def from_button(cls, interaction):
        return cls(answer="0", guild_id=interaction.guild.id, user_id=interaction.user.id, channel_id=interaction.channel.id)
    async def on_submit(self, interaction):
        guild = bot.get_guild(self.guild_id)
        if not guild:
            await interaction.response.send_message("❌ Servidor não encontrado.", ephemeral=True); return
        member = guild.get_member(self.user_id)
        for rid in config.get("verified_role_ids", []):
            r = guild.get_role(rid)
            if r and member and r not in member.roles:
                try: await member.add_roles(r)
                except Exception: pass
        if config.get("age_verification_enabled", False):
            ch = guild.get_channel(self.channel_id)
            if ch and member:
                await iniciar_verificacao_idade(member, ch)
                await interaction.response.send_message("✅ Captcha resolvido! Agora verifique sua idade.", ephemeral=True)
        else:
            await interaction.response.send_message("✅ Verificação concluída!", ephemeral=True)

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
class WelcomeUserSelectView(ui.View):
    def __init__(self):
        super().__init__(timeout=60)
        self.add_item(WelcomeUserSelect())

class WelcomeUserSelect(ui.Select):
    def __init__(self):
        guild = get_guild()
        opts = []
        if guild:
            for m in guild.members:
                if not m.bot:
                    opts.append(discord.SelectOption(label=m.display_name[:100], value=str(m.id), description=f"@{m.name}"))
        if not opts: opts = [discord.SelectOption(label="Nenhum", value="none")]
        super().__init__(placeholder="Selecione um usuário", options=opts[:25])
    async def callback(self, interaction):
        val = self.values[0]
        if val == "none":
            await interaction.response.send_message("❌ Nenhum usuário.", ephemeral=True); return
        await interaction.response.send_modal(WelcomeUserMessageModal(int(val)))

class WelcomeUserMessageModal(ui.Modal, title="Mensagem Personalizada"):
    def __init__(self, user_id):
        super().__init__()
        self.user_id = user_id
        self.msg = ui.TextInput(label="Mensagem", style=discord.TextStyle.paragraph, required=True)
        self.add_item(self.msg)
        self.img = ui.TextInput(label="URL da imagem (opcional)", required=False)
        self.add_item(self.img)
    async def on_submit(self, interaction):
        set_welcome_message(self.user_id, self.msg.value, self.img.value.strip() or None)
        await interaction.response.send_message("✅ Personalizado!", ephemeral=True)

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

    e = discord.Embed(
        title=f"{bemoji()} Ticket de {nome} — {bname()}",
        description=f"**Olá {interaction.user.mention}!** Bem-vindo(a) ao atendimento. 💜\n\nDescreva seu pedido abaixo.",
        color=color_primary()
    )
    if banner_ticket(): e.set_image(url=banner_ticket())
    e.set_footer(text=f"{bemoji()} Equipe {bname()}")
    await channel.send(embed=e)
    if mentions:
        await channel.send(f"📢 {', '.join(mentions)} — novo ticket de {interaction.user.mention}.")

    view = ui.View(timeout=None)
    view.add_item(ui.Button(label="⭐ Avaliar", style=discord.ButtonStyle.primary, custom_id="rate_ticket"))
    view.add_item(ui.Button(label="🔒 Fechar", style=discord.ButtonStyle.danger, custom_id="close_ticket"))
    view.add_item(ui.Button(label="👤 Adicionar", style=discord.ButtonStyle.secondary, custom_id="add_member"))
    await channel.send("🔧 **Ações:**", view=view)

    await interaction.response.send_message(f"✅ Ticket criado em {channel.mention}!", ephemeral=True)

async def handle_captcha_start(interaction):
    num1, num2 = random.randint(1, 10), random.randint(1, 10)
    answer = num1 + num2
    e = discord.Embed(
        title=f"🔐 Verificação para {interaction.user.display_name}",
        description=f"Resolva: **{num1} + {num2} = ?**\n\nClique abaixo para responder.",
        color=color_secondary()
    )
    view = ui.View(timeout=300)
    view.add_item(CaptchaButton(answer, interaction.guild.id, interaction.channel.id))
    await interaction.channel.send(embed=e, view=view)
    await interaction.response.send_message("✅ Desafio enviado!", ephemeral=True)

class CaptchaButton(ui.Button):
    def __init__(self, answer, guild_id, channel_id):
        super().__init__(label="✅ Verificar", style=discord.ButtonStyle.success)
        self.answer = answer
        self.guild_id = guild_id
        self.channel_id = channel_id
    async def callback(self, interaction):
        await interaction.response.send_modal(CaptchaModal(self.answer, self.guild_id, interaction.user.id, self.channel_id))

# ===================== VERIFICAÇÃO +18 =====================
async def iniciar_verificacao_idade(member, channel):
    if any(r.id in config.get("age_verified_role_ids", []) for r in member.roles):
        return
    e = discord.Embed(
        title=f"🔞 Verificação de Idade — {bname()}",
        description=f"Olá {member.mention}! Confirme que tem **18 anos ou mais** clicando abaixo.",
        color=color_secondary()
    )
    view = ui.View(timeout=300)
    view.add_item(AgeVerifyButton(member.id))
    try: await channel.send(embed=e, view=view)
    except Exception as e: logger.error(f"Erro verif idade: {e}")

class AgeVerifyButton(ui.Button):
    def __init__(self, user_id):
        super().__init__(label="🔞 Verificar Idade", style=discord.ButtonStyle.danger)
        self.user_id = user_id
    async def callback(self, interaction):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("❌ Este botão não é para você.", ephemeral=True); return
        await interaction.response.send_modal(AgeVerificationModal(self.user_id))

class AgePanelView(ui.View):
    def __init__(self):
        super().__init__(timeout=None)
    @ui.button(label="🔞 Verificar Idade", style=discord.ButtonStyle.danger, custom_id="age_panel_verify")
    async def verify(self, interaction, button):
        pass

class VerificationPanelView(ui.View):
    def __init__(self):
        super().__init__(timeout=None)
    @ui.button(label="🔐 Verificar Agora", style=discord.ButtonStyle.success, custom_id="verify_now")
    async def verify(self, interaction, button):
        pass

class TicketPanelView(ui.View):
    def __init__(self):
        super().__init__(timeout=None)
    @ui.button(label="❓ Dúvidas", style=discord.ButtonStyle.primary, custom_id="ticket_open_doubt")
    async def d(self, interaction, button): pass
    @ui.button(label="🛒 Compras", style=discord.ButtonStyle.success, custom_id="ticket_open_purchase")
    async def c(self, interaction, button): pass

class SuggestionButtonView(ui.View):
    def __init__(self):
        super().__init__(timeout=None)
    @ui.button(label="💡 Enviar Sugestão", style=discord.ButtonStyle.primary, custom_id="suggest_btn")
    async def s(self, interaction, button): pass

# ===================== COMANDOS =====================
@bot.tree.command(name="painelpxkadmin", description="🖤 Painel administrativo do servidor 𝚙𝚡𝚔")
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

@bot.tree.command(name="painelticket", description="🎫 Envia o painel de tickets")
@app_commands.default_permissions(administrator=True)
async def cmd_pt(interaction):
    cid = config.get("ticket_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Configure em Tickets > Canal do Painel.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Canal inválido.", ephemeral=True); return
    e = discord.Embed(
        title=f"🎫 Central de Tickets — {bname()}",
        description=f"Clique no botão correspondente:\n\n❓ **Dúvidas**\n🛒 **Compras**",
        color=color_primary()
    )
    if banner_ticket(): e.set_image(url=banner_ticket())
    await ch.send(embed=e, view=TicketPanelView())
    await interaction.response.send_message(f"✅ Enviado em {ch.mention}", ephemeral=True)

@bot.tree.command(name="painelsugestoes", description="💡 Envia o painel de sugestões")
@app_commands.default_permissions(administrator=True)
async def cmd_ps(interaction):
    cid = config.get("suggestions_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Configure em Sugestões > Canal do Painel.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Canal inválido.", ephemeral=True); return
    e = discord.Embed(title=f"💡 Sugestões — {bname()}", description="Clique abaixo para enviar sua ideia!", color=color_primary())
    msg = await ch.send(embed=e, view=SuggestionButtonView())
    config["suggestions_panel_message_id"] = msg.id; save_config(config)
    await interaction.response.send_message(f"✅ Enviado em {ch.mention}", ephemeral=True)

@bot.tree.command(name="painelverificacao", description="✅ Envia o painel de verificação")
@app_commands.default_permissions(administrator=True)
async def cmd_pv(interaction):
    cid = config.get("verification_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Configure em Verificação > Canal do Painel.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Canal inválido.", ephemeral=True); return
    e = discord.Embed(
        title=f"✅ Verificação — {bname()}",
        description="Clique em **🔐 Verificar Agora** para iniciar.",
        color=color_secondary()
    )
    msg = await ch.send(embed=e, view=VerificationPanelView())
    config["verification_panel_message_id"] = msg.id; save_config(config)
    await interaction.response.send_message(f"✅ Enviado em {ch.mention}", ephemeral=True)

@bot.tree.command(name="painelidade", description="🔞 Envia o painel de idade")
@app_commands.default_permissions(administrator=True)
async def cmd_pi(interaction):
    cid = config.get("age_panel_channel_id")
    if not cid:
        await interaction.response.send_message("❌ Configure em +18 > Canal do Painel.", ephemeral=True); return
    ch = interaction.guild.get_channel(cid)
    if not ch:
        await interaction.response.send_message("❌ Canal inválido.", ephemeral=True); return
    e = discord.Embed(
        title=f"🔞 Verificação de Idade — {bname()}",
        description="Clique abaixo e informe sua data de nascimento.",
        color=color_secondary()
    )
    msg = await ch.send(embed=e, view=AgePanelView())
    config["age_panel_message_id"] = msg.id; save_config(config)
    await interaction.response.send_message(f"✅ Enviado em {ch.mention}", ephemeral=True)

@bot.tree.command(name="reverificar", description="🔄 Força reverificação +18")
@app_commands.default_permissions(administrator=True)
async def cmd_rev(interaction, membro: discord.Member):
    for key in ("age_verified_role_ids", "age_underage_role_ids"):
        for rid in config.get(key, []):
            r = interaction.guild.get_role(rid)
            if r and r in membro.roles:
                try: await membro.remove_roles(r)
                except Exception: pass
    for rid in config.get("age_unverified_role_ids", []):
        r = interaction.guild.get_role(rid)
        if r:
            try: await membro.add_roles(r)
            except Exception: pass
    ch_id = config.get("age_verification_channel_id")
    if ch_id:
        ch = interaction.guild.get_channel(ch_id)
        if ch: await iniciar_verificacao_idade(membro, ch)
    await interaction.response.send_message(f"✅ {membro.mention} colocado para reverificar.", ephemeral=True)

@bot.tree.command(name="limparchat", description="🧹 Apaga TODAS as mensagens de um canal")
@app_commands.default_permissions(administrator=True)
@app_commands.describe(canal="Canal que será totalmente limpo")
async def cmd_limpar(interaction: discord.Interaction, canal: discord.TextChannel):
    perms = canal.permissions_for(interaction.guild.me)
    if not perms.manage_messages or not perms.read_message_history:
        await interaction.response.send_message(f"❌ Sem permissão em {canal.mention}.", ephemeral=True); return
    await interaction.response.defer(ephemeral=True)
    total, erro = await perform_chat_cleanup(canal, interaction.guild)
    if erro:
        await interaction.followup.send(f"⚠️ Erro após **{total}** mensagens: `{erro}`", ephemeral=True)
    else:
        await interaction.followup.send(f"✅ **{total}** mensagens apagadas de {canal.mention}!", ephemeral=True)

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

@bot.tree.command(name="lembrete", description="⏰ Agende um lembrete")
async def cmd_lembrete(interaction, mensagem: str, data: str, hora: str):
    try:
        dt = datetime.datetime.strptime(f"{data} {hora}", "%Y-%m-%d %H:%M")
    except Exception:
        await interaction.response.send_message("❌ Formato inválido.", ephemeral=True); return
    if dt < datetime.datetime.now():
        await interaction.response.send_message("❌ Data futura.", ephemeral=True); return
    config["reminders"].append({"user_id": interaction.user.id, "message": mensagem, "datetime_iso": dt.isoformat()})
    save_config(config)
    await interaction.response.send_message(f"✅ Lembrete para {dt.strftime('%d/%m/%Y %H:%M')}", ephemeral=True)

# ===================== TASKS =====================
@tasks.loop(minutes=1)
async def task_voice(): await update_voice_name_impl()

@tasks.loop(seconds=30)
async def task_reminders():
    now = datetime.datetime.now()
    rems = config.get("reminders", [])
    to_rm = []
    for i, r in enumerate(rems):
        try:
            if datetime.datetime.fromisoformat(r["datetime_iso"]) <= now:
                u = bot.get_user(r["user_id"])
                if u:
                    try: await u.send(f"⏰ **Lembrete {bname()}**: {r['message']}")
                    except Exception: pass
                to_rm.append(i)
        except Exception: to_rm.append(i)
    if to_rm:
        for i in reversed(to_rm): del rems[i]
        save_config(config)

@tasks.loop(seconds=60)
async def task_events():
    now = datetime.datetime.now()
    try: events = get_active_events()
    except Exception: return
    for ev in events:
        try: dt = datetime.datetime.fromisoformat(ev["schedule_time"])
        except Exception: continue
        if dt <= now:
            ch = bot.get_channel(ev["channel_id"])
            if ch:
                try: await ch.send(ev["message"])
                except Exception: pass
            if ev["event_type"] == "once":
                try: deactivate_event(ev["id"])
                except Exception: pass

@tasks.loop(minutes=5)
async def task_status(): await update_status()

# ===================== AUX =====================
async def bot_join_voice():
    guild = get_guild()
    if not guild: return
    cid = config.get("voice_channel_id")
    if not cid: return
    ch = guild.get_channel(cid)
    if not ch or not isinstance(ch, discord.VoiceChannel): return
    try:
        if not guild.voice_client: await ch.connect()
        else: await guild.voice_client.move_to(ch)
        await update_voice_name_impl()
        await update_voice_mute()
    except Exception as e: logger.error(f"Voz: {e}")

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
    for t in (task_voice, task_reminders, task_events, task_status):
        if not t.is_running(): t.start()

@bot.event
async def on_member_join(member):
    if member.bot: return
    guild = member.guild

    # ---- Card premium de boas-vindas ----
    try:
        await send_welcome_message(member)
    except Exception as e:
        logger.error(f"Erro send_welcome: {e}")

    # ---- Sistema de idade (inalterado) ----
    if config.get("age_verification_enabled", False):
        if any(r.id in config.get("age_verified_role_ids", []) for r in member.roles):
            return
        if config.get("age_native_verification_role_ids"):
            for rid in config["age_native_verification_role_ids"]:
                r = guild.get_role(rid)
                if r and r in member.roles:
                    for rid2 in config.get("age_verified_role_ids", []):
                        r2 = guild.get_role(rid2)
                        if r2:
                            try: await member.add_roles(r2)
                            except Exception: pass
                    return
        for rid in config.get("age_unverified_role_ids", []):
            r = guild.get_role(rid)
            if r:
                try: await member.add_roles(r)
                except Exception: pass
        ch_id = config.get("age_verification_channel_id")
        if ch_id:
            ch = guild.get_channel(ch_id)
            if ch:
                n1, n2 = random.randint(1, 10), random.randint(1, 10)
                e = discord.Embed(
                    title=f"🔐 Verificação para {member.display_name}",
                    description=f"Resolva: **{n1} + {n2} = ?**",
                    color=color_secondary()
                )
                v = ui.View(timeout=300)
                v.add_item(CaptchaButton(n1 + n2, guild.id, ch.id))
                try: await ch.send(embed=e, view=v)
                except Exception: pass
    elif config.get("verification_channel_id"):
        ch = guild.get_channel(config["verification_channel_id"])
        if ch:
            n1, n2 = random.randint(1, 10), random.randint(1, 10)
            e = discord.Embed(
                title=f"🔐 Verificação para {member.display_name}",
                description=f"Resolva: **{n1} + {n2} = ?**",
                color=color_secondary()
            )
            v = ui.View(timeout=300)
            v.add_item(CaptchaButton(n1 + n2, guild.id, ch.id))
            try: await ch.send(embed=e, view=v)
            except Exception: pass

    await update_voice_name_impl()
    await update_status()

@bot.event
async def on_member_remove(member):
    if member.bot: return
    # ---- Card premium de saída ----
    try:
        await send_leave_message(member)
    except Exception as e:
        logger.error(f"Erro send_leave: {e}")
    await update_voice_name_impl()
    await update_status()

@bot.event
async def on_voice_state_update(member, before, after):
    if member.bot: return

    # Entrou em call (não estava em nenhuma, agora está)
    if before.channel is None and after.channel is not None:
        try:
            await send_voice_log(member, after.channel, "join")
        except Exception as e:
            logger.error(f"Erro voice join: {e}")
    # Saiu de call (estava em uma, agora não está em nenhuma)
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