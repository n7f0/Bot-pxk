'use strict';

const actions = require('../bateponto/actions');
const service = require('../bateponto/service');
const ui = require('../bateponto/ui');
const visual = require('../bateponto/visual');
const publisher = require('../ranking/publisher');
const settings = require('../database/settings');
const theme = require('../theme');
const { BPV_TEXT, UI_DEFAULTS } = require('../theme/defaults');
const { requirePermission } = require('../permissions');
const { baseEmbed, errorEmbed } = require('../utils/embeds');
const { SEP } = require('../utils/format');
const { row, button, buildModal, updateOrReply, ButtonStyle } = require('../utils/interaction');
const { menuButton, backButton, adminLog } = require('./util');

const ph = (key) => String(BPV_TEXT[key] ?? '').replace(/\n/g, ' / ').slice(0, 100);
const HTTPS = /^https:\/\/\S+$/i;

/** Modais de texto simples: cada campo vazio volta ao padrão. (Discord permite no máximo 5 campos por modal.) */
const MODALS = {
  text: {
    title: 'Painel público · Textos',
    inputs: [
      { key: 'bpv_title', label: 'Título', max: 80 },
      { key: 'bpv_intro', label: 'Texto de introdução', max: 400, long: true },
      { key: 'bpv_rules', label: 'Regras (uma por linha)', max: 900, long: true },
      { key: 'bpv_footer', label: 'Rodapé (vazio = do tema)', max: 100, noPlaceholder: true },
      { key: 'bpv_disabled_text', label: 'Texto quando desativado', max: 200 },
    ],
  },
  labels: {
    title: 'Painel público · Rótulos',
    inputs: [
      { key: 'bpv_l_time', label: 'Rótulo: tempo', max: 40 },
      { key: 'bpv_l_goal', label: 'Rótulo: meta', max: 40 },
      { key: 'bpv_l_channel', label: 'Rótulo: canal', max: 40 },
      { key: 'bpv_l_reward', label: 'Rótulo: recompensa', max: 40 },
      { key: 'bpv_rules_title', label: 'Título das regras', max: 40 },
    ],
  },
  images: {
    title: 'Painel público · Imagens',
    inputs: [
      { key: 'bpv_image', label: 'Banner (link https, vazio = nenhum)', max: 400, url: true, noPlaceholder: true },
      { key: 'bpv_thumb', label: 'Miniatura (link https, vazio = nenhuma)', max: 400, url: true, noPlaceholder: true },
    ],
  },
  active: {
    title: 'Painel individual',
    inputs: [
      { key: 'bpv_t_active', label: 'Título do bate-ponto ativo', max: 80 },
      { key: 'bpv_t_started', label: 'Título ao iniciar', max: 80 },
      { key: 'bpv_active_footer', label: 'Rodapé ({area} {fim})', max: 120 },
      { key: 'bpv_active_labels', label: 'Rótulos: tempo, mensagens, progresso', max: 80, labels3: true },
    ],
  },
  dm: {
    title: 'Mensagens no privado',
    inputs: [
      { key: 'bpv_dm_started', label: 'Ao iniciar ({area} {tempo} {meta} {canal})', max: 300, long: true },
      { key: 'bpv_dm_goal_reached', label: 'Ao atingir a meta ({meta} {tempo})', max: 300, long: true },
      { key: 'bpv_dm_approved', label: 'Aprovado ({area} {pontos} {meta})', max: 300, long: true },
      { key: 'bpv_dm_rejected', label: 'Reprovado ({area} {meta} {mensagens})', max: 300, long: true },
      { key: 'bpv_dm_cancelled', label: 'Cancelado pela administração', max: 300, long: true },
    ],
  },
  results: {
    title: 'Resultados e logs',
    inputs: [
      { key: 'bpv_t_approved', label: 'Título: aprovado', max: 80 },
      { key: 'bpv_t_rejected', label: 'Título: reprovado', max: 80 },
      { key: 'bpv_t_cancelled', label: 'Título: cancelado', max: 80 },
      { key: 'bpv_t_goal', label: 'Título: meta concluída', max: 80 },
      { key: 'bpv_t_log', label: 'Título do log interno', max: 80 },
    ],
  },
};

const toggleLabel = (on) => (on ? 'sim' : 'não');

function render() {
  const cfg = service.getConfig();
  const layout = settings.get('bpv_layout') === 'list' ? 'Lista' : 'Colunas';
  const published = settings.get('bp_panel_channel_id');
  const embed = baseEmbed({
    title: 'Visual · Tema e bate-ponto',
    timestamp: false,
    footer: 'Campo vazio = volta ao padrão',
    description: [
      'Personalize o **tema do bot** e o **painel de bate-ponto** (público e individual).',
      SEP,
      '**Tema global**',
      `Faixa \`${settings.get('ui_color') || UI_DEFAULTS.ui_color}\` · Linha ${theme.sep().slice(0, 12)} · Barra ${theme.bar(1, 2, 6)}`,
      `Hora no rodapé: **${toggleLabel(theme.timestamp())}** · Cores de status: **${toggleLabel(theme.statusColors())}**`,
      SEP,
      '**Painel público**',
      `Layout: **${layout}** · Botão: ${visual.emoji('bpv_btn_start_emoji') || ''} ${visual.text('bpv_btn_start_label')} (${visual.styleName('bpv_btn_start_style')})`,
      `Avisos no privado · início: **${toggleLabel(settings.get('bpv_dm_on_start'))}** · meta: **${toggleLabel(settings.get('bpv_dm_on_goal'))}** · resultado: **${toggleLabel(settings.get('bpv_dm_enabled'))}**`,
      `Publicado: ${published ? `<#${published}>` : '*ainda não publicado*'} · Status: **${cfg.enabled ? 'ativo' : 'desativado'}**`,
      SEP,
      'Variáveis nos textos: `{area}` `{tempo}` `{meta}` `{canal}` `{recompensa}` `{antiflood}`',
      'Emoji `-` oculta o emoji do botão · Rodapé global `-` oculta o rodapé.',
    ].join('\n'),
  });
  return {
    embeds: [embed],
    components: [
      row(
        button('panel:visual:text', 'Textos', { emoji: '📝' }),
        button('panel:visual:labels', 'Rótulos', { emoji: '🏷️' }),
        button('panel:visual:images', 'Imagens', { emoji: '🖼️' }),
        button('panel:visual:buttons', 'Botões', { emoji: '🔘' }),
        button('panel:visual:active', 'Individual', { emoji: '👤' })
      ),
      row(
        button('panel:visual:results', 'Resultados', { emoji: '📌' }),
        button('panel:visual:theme', 'Tema global', { emoji: '🎨', style: ButtonStyle.Primary }),
        button('panel:visual:ts', `Hora: ${toggleLabel(theme.timestamp())}`, { emoji: '🕐' }),
        button('panel:visual:status', `Cores de status: ${toggleLabel(theme.statusColors())}`, { emoji: '🚦' }),
        button('panel:visual:layout', `Layout: ${layout}`, { emoji: '🧩' })
      ),
      row(
        button('panel:visual:preview', 'Pré-visualizar', { emoji: '👁️' }),
        button('panel:visual:previewactive', 'Prévia individual', { emoji: '👤' }),
        button('panel:visual:refresh', 'Atualizar publicado', { emoji: '🔄', style: ButtonStyle.Success }),
        button('panel:visual:reset', 'Restaurar padrão', { emoji: '🧹', style: ButtonStyle.Danger }),
        menuButton()
      ),
      row(
        button('panel:visual:dm', 'Mensagens do privado', { emoji: '📩' }),
        button('panel:visual:dmt:start', `DM início: ${toggleLabel(settings.get('bpv_dm_on_start'))}`, { emoji: '🔔' }),
        button('panel:visual:dmt:goal', `DM meta: ${toggleLabel(settings.get('bpv_dm_on_goal'))}`, { emoji: '🔔' }),
        button('panel:visual:dmt:final', `DM resultado: ${toggleLabel(settings.get('bpv_dm_enabled'))}`, { emoji: '🔔' })
      ),
    ],
  };
}

function modalFor(action) {
  if (MODALS[action]) {
    const m = MODALS[action];
    return buildModal(
      `panel:visual:sub:${action}`,
      m.title,
      m.inputs.map((i) => ({
        id: i.key,
        label: i.label,
        value: settings.get(i.key),
        placeholder: i.noPlaceholder ? undefined : ph(i.key),
        required: false,
        long: i.long,
        max: i.max,
      }))
    );
  }
  if (action === 'buttons') {
    return buildModal('panel:visual:sub:buttons', 'Botões do painel público', [
      { id: 'start_label', label: 'Botão iniciar: texto', value: settings.get('bpv_btn_start_label'), placeholder: BPV_TEXT.bpv_btn_start_label, required: false, max: 40 },
      { id: 'start_emoji', label: 'Botão iniciar: emoji (- = nenhum)', value: settings.get('bpv_btn_start_emoji'), placeholder: BPV_TEXT.bpv_btn_start_emoji, required: false, max: 40 },
      { id: 'view_label', label: 'Botão "meu bate-ponto": texto', value: settings.get('bpv_btn_view_label'), placeholder: BPV_TEXT.bpv_btn_view_label, required: false, max: 40 },
      { id: 'view_emoji', label: 'Botão "meu bate-ponto": emoji', value: settings.get('bpv_btn_view_emoji'), placeholder: BPV_TEXT.bpv_btn_view_emoji, required: false, max: 40 },
      { id: 'styles', label: 'Cores: iniciar, meu (ex.: verde, cinza)', value: `${visual.styleName('bpv_btn_start_style')}, ${visual.styleName('bpv_btn_view_style')}`, required: true, max: 40 },
    ]);
  }
  if (action === 'theme') {
    return buildModal('panel:visual:sub:theme', 'Tema global', [
      { id: 'color', label: 'Cor da faixa lateral (hex)', value: settings.get('ui_color'), placeholder: UI_DEFAULTS.ui_color, required: false, max: 7 },
      { id: 'sep', label: 'Linha fina: caractere e tamanho', value: `${settings.get('ui_sep_char')} ${settings.get('ui_sep_len')}`, placeholder: '─ 24', required: false, max: 12 },
      { id: 'footer', label: 'Rodapé global (- = ocultar)', value: settings.get('ui_footer'), required: false, max: 100 },
      { id: 'bar', label: 'Barra de progresso: cheio e vazio', value: `${settings.get('ui_bar_full')} ${settings.get('ui_bar_empty')}`, placeholder: '▰ ▱', required: false, max: 12 },
    ]);
  }
  return null;
}

const chars = (s) => Array.from(String(s));

/** Aplica o envio de um modal. Retorna { error } ou { log }. */
function applySubmit(which, f) {
  const val = (id) => f.getTextInputValue(id).trim();

  if (MODALS[which]) {
    const updates = {};
    for (const i of MODALS[which].inputs) {
      const v = val(i.key);
      if (v && i.url && !HTTPS.test(v)) return { error: `**${i.label}**: use um link **https** de imagem.` };
      if (v && i.labels3 && v.split(',').filter((x) => x.trim()).length !== 3) return { error: 'Informe **3 rótulos** separados por vírgula (tempo, mensagens, progresso).' };
      updates[i.key] = v || null;
    }
    for (const [k, v] of Object.entries(updates)) settings.set(k, v);
    return { log: `🎨 Visual atualizado: **${MODALS[which].title}**` };
  }

  if (which === 'buttons') {
    const styles = val('styles').split(/[,\s/|]+/).filter(Boolean);
    const s1 = parseStyleOrDefault(styles[0], 'bpv_btn_start_style');
    const s2 = parseStyleOrDefault(styles[1] ?? styles[0], 'bpv_btn_view_style');
    if (!s1 || !s2) return { error: 'Cores válidas: **cinza**, **azul**, **verde** ou **vermelho** (ex.: `verde, cinza`).' };
    for (const [id, label] of [['start_emoji', 'iniciar'], ['view_emoji', 'meu bate-ponto']]) {
      const e = val(id);
      if (e && e !== '-' && !visual.validEmoji(e)) return { error: `Emoji inválido no botão **${label}**. Use um emoji comum ou \`<:nome:id>\`; \`-\` para nenhum.` };
    }
    settings.set('bpv_btn_start_label', val('start_label') || null);
    settings.set('bpv_btn_start_emoji', val('start_emoji') || null);
    settings.set('bpv_btn_view_label', val('view_label') || null);
    settings.set('bpv_btn_view_emoji', val('view_emoji') || null);
    settings.set('bpv_btn_start_style', s1);
    settings.set('bpv_btn_view_style', s2);
    return { log: '🔘 Botões do painel público atualizados.' };
  }

  if (which === 'theme') {
    const color = val('color');
    if (color && theme.parseHex(color) === null) return { error: 'Cor inválida. Use hexadecimal, ex.: `#2b2d31`.' };

    const sepTokens = val('sep').split(/\s+/).filter(Boolean);
    let sepChar = null;
    let sepLen = null;
    if (sepTokens.length) {
      if (chars(sepTokens[0]).length > 2) return { error: 'A linha fina aceita **1 caractere** (ex.: `─`, `━`, `·`) e o tamanho de 4 a 40.' };
      sepChar = sepTokens[0];
      if (sepTokens[1] !== undefined) {
        sepLen = Number(sepTokens[1]);
        if (!Number.isInteger(sepLen) || sepLen < 4 || sepLen > 40) return { error: 'O tamanho da linha deve ser de **4 a 40**.' };
      }
    }

    const barTokens = val('bar').split(/\s+/).filter(Boolean);
    if (barTokens.length && (barTokens.length !== 2 || barTokens.some((t) => chars(t).length > 2))) return { error: 'A barra precisa de **2 caracteres**: cheio e vazio (ex.: `▰ ▱` ou `█ ░`).' };

    const footer = val('footer');
    settings.set('ui_color', color ? `#${color.replace('#', '').toLowerCase()}` : null);
    settings.set('ui_sep_char', sepChar || UI_DEFAULTS.ui_sep_char);
    settings.set('ui_sep_len', sepLen ?? UI_DEFAULTS.ui_sep_len);
    settings.set('ui_footer', footer || null);
    settings.set('ui_bar_full', barTokens[0] || UI_DEFAULTS.ui_bar_full);
    settings.set('ui_bar_empty', barTokens[1] || UI_DEFAULTS.ui_bar_empty);
    return { log: '🎨 Tema global atualizado (cor, linha, rodapé e barra).', theme: true };
  }

  return { error: 'Seção desconhecida.' };
}

function parseStyleOrDefault(input, key) {
  if (input === undefined) return visual.parseStyle(visual.get(key));
  return visual.parseStyle(input);
}

async function pushUpdates(interaction, { themeChanged = false } = {}) {
  await actions.refreshPublicPanel(interaction.client);
  if (themeChanged) publisher.refresh({ force: true }).catch(() => {});
}

async function handle(interaction, action, args = []) {
  if (!(await requirePermission(interaction, 'manage_bateponto'))) return;
  const themeAction = ['theme', 'ts', 'status'].includes(action) || (action === 'sub' && args[0] === 'theme');
  if (themeAction && !(await requirePermission(interaction, 'change_settings'))) return;

  if (action === 'view') return interaction.update(render());

  if (MODALS[action] || action === 'buttons' || action === 'theme') return interaction.showModal(modalFor(action));

  if (action === 'sub') {
    const res = applySubmit(args[0], interaction.fields);
    if (res.error) return updateOrReply(interaction, { embeds: [errorEmbed(res.error)], components: render().components });
    await adminLog(interaction, 'config_visual', 'Visual alterado', res.log);
    await pushUpdates(interaction, { themeChanged: Boolean(res.theme) });
    return updateOrReply(interaction, render());
  }

  if (action === 'ts' || action === 'status') {
    const key = action === 'ts' ? 'ui_timestamp' : 'ui_status_colors';
    const next = !settings.get(key);
    settings.set(key, next);
    await adminLog(interaction, 'config_visual', 'Tema alterado', `🎨 ${action === 'ts' ? 'Hora no rodapé' : 'Cores de status'}: **${toggleLabel(next)}**`);
    await pushUpdates(interaction, { themeChanged: true });
    return interaction.update(render());
  }

  if (action === 'dmt') {
    const map = { start: ['bpv_dm_on_start', 'início'], goal: ['bpv_dm_on_goal', 'meta atingida'], final: ['bpv_dm_enabled', 'resultado'] };
    const [key, label] = map[args[0]] || [];
    if (!key) return;
    const next = !settings.get(key);
    settings.set(key, next);
    await adminLog(interaction, 'config_visual', 'Visual alterado', `📩 Mensagem no privado (${label}): **${toggleLabel(next)}**`);
    return interaction.update(render());
  }

  if (action === 'layout') {
    const next = settings.get('bpv_layout') === 'list' ? 'fields' : 'list';
    settings.set('bpv_layout', next);
    await adminLog(interaction, 'config_visual', 'Visual alterado', `🧩 Layout do painel público: **${next === 'list' ? 'Lista' : 'Colunas'}**`);
    await pushUpdates(interaction);
    return interaction.update(render());
  }

  if (action === 'preview') {
    const p = ui.buildPublicPanel({ preview: true });
    return interaction.update({ embeds: p.embeds, components: [...p.components, row(backButton('visual'))] });
  }

  if (action === 'previewactive') {
    const cfg = service.getConfig();
    const now = Date.now();
    const fake = {
      id: 0,
      user_id: interaction.user.id,
      area: cfg.area,
      status: 'active',
      messages: Math.floor(cfg.goal / 2),
      goal: cfg.goal,
      duration_ms: cfg.durationMin * 60000,
      started_at: now - (cfg.durationMin * 60000) / 2,
      ends_at: now + (cfg.durationMin * 60000) / 2,
    };
    const p = ui.buildActivePanel(fake, { preview: true });
    return interaction.update({ embeds: p.embeds, components: [...p.components, row(backButton('visual'))] });
  }

  if (action === 'refresh') {
    const ok = await actions.refreshPublicPanel(interaction.client);
    const view = render();
    view.embeds.unshift(ok ? baseEmbed({ title: 'Painel público atualizado', timestamp: false, footer: null }) : errorEmbed('Nenhum painel publicado (ou a mensagem foi apagada). Use **Bate-Ponto → Publicar painel**.'));
    return interaction.update(view);
  }

  if (action === 'reset') {
    for (const k of Object.keys(settings.DEFAULTS)) if (k.startsWith('bpv_') || k.startsWith('ui_')) settings.set(k, settings.DEFAULTS[k]);
    await adminLog(interaction, 'config_visual', 'Visual restaurado', '🧹 Tema e visual do bate-ponto restaurados para o padrão.');
    await pushUpdates(interaction, { themeChanged: true });
    return interaction.update(render());
  }
}

module.exports = { render, handle, modalFor, applySubmit };
