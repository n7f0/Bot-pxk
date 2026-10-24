// src/official/theme/defaults.js
'use strict';

const UI_DEFAULTS = {
  ui_color: '#2b2d31',
  ui_status_colors: false,
  ui_sep_char: '─',
  ui_sep_len: 24,
  ui_timestamp: false,
  ui_footer: null,
  ui_bar_full: '▰',
  ui_bar_empty: '▱',
};

const BPV_TEXT = {
  bpv_title: '{area} · Bate-ponto',
  bpv_intro: 'Inicie a sessão, cumpra o tempo e a meta e receba os pontos automaticamente.',
  bpv_disabled_text: 'O bate-ponto está **desativado** no momento.',
  bpv_rules_title: 'Como funciona',
  bpv_rules: 'O tempo e a meta são definidos pela administração.\nSó contam as suas mensagens no canal indicado.\nBater a meta não encerra o bate-ponto: é preciso cumprir todo o tempo.\nAo fim do tempo, com a meta cumprida, os pontos entram automaticamente.',
  bpv_footer: null,
  bpv_l_time: 'Tempo mínimo',
  bpv_l_goal: 'Meta',
  bpv_l_channel: 'Canal',
  bpv_l_reward: 'Recompensa',
  bpv_image: null,
  bpv_thumb: null,
  bpv_btn_start_label: 'Iniciar bate-ponto',
  bpv_btn_start_emoji: '🟢',
  bpv_btn_start_style: 'secondary',
  bpv_btn_view_label: 'Meu bate-ponto',
  bpv_btn_view_emoji: '📊',
  bpv_btn_view_style: 'secondary',
  bpv_t_active: 'Bate-ponto ativo',
  bpv_t_started: 'Bate-ponto iniciado',
  bpv_active_footer: '{area} · Atualiza sozinho · Termina às {fim}',
  bpv_active_labels: 'Tempo, Mensagens, Progresso',
  bpv_t_approved: 'Bate-ponto aprovado',
  bpv_t_rejected: 'Bate-ponto reprovado',
  bpv_t_cancelled: 'Bate-ponto cancelado',
  bpv_t_goal: 'Meta de mensagens concluída',
  bpv_t_log: 'Log de bate-ponto',
  bpv_dm_approved: '✅ Seu bate-ponto em **{area}** terminou e foi **aprovado**! Você ganhou **{pontos}** pontos.',
  bpv_dm_rejected: '❌ Seu bate-ponto em **{area}** terminou e foi **reprovado**: a meta de {meta} mensagens não foi atingida.',
  bpv_dm_cancelled: '🛑 Seu bate-ponto em **{area}** foi **cancelado** pela administração.',
  bpv_dm_started: '⏱️ Seu bate-ponto em **{area}** foi **iniciado**. Envie **{meta}** mensagens em {canal} durante **{tempo}**. Quando terminar, avisarei aqui se foi aprovado.',
  bpv_dm_goal_reached: '🎯 Você atingiu a meta de **{meta}** mensagens! Continue ativo até o fim do tempo ({tempo}) para ser aprovado e receber **{recompensa}**.',
};

module.exports = { UI_DEFAULTS, BPV_TEXT };