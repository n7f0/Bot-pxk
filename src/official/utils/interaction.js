'use strict';

const {
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const EPHEMERAL = MessageFlags.Ephemeral;

/** Responde de forma segura (reply / followUp / editReply conforme o estado da interação). */
async function safeReply(interaction, payload, { ephemeral = true } = {}) {
  const data = { ...payload };
  if (ephemeral) data.flags = EPHEMERAL;
  try {
    if (interaction.deferred && !interaction.replied) {
      delete data.flags;
      return await interaction.editReply(data);
    }
    if (interaction.replied) return await interaction.followUp(data);
    return await interaction.reply(data);
  } catch (err) {
    console.error('[interaction] falha ao responder:', err.message);
    return null;
  }
}

/** Atualiza a mensagem do componente (ou responde ephemeral se não for possível). */
async function updateOrReply(interaction, payload) {
  const canUpdate =
    (typeof interaction.isMessageComponent === 'function' && interaction.isMessageComponent()) ||
    (typeof interaction.isModalSubmit === 'function' &&
      interaction.isModalSubmit() &&
      interaction.isFromMessage());
  if (canUpdate) return interaction.update(payload);
  return safeReply(interaction, payload);
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(customId, label, { emoji, style = ButtonStyle.Secondary, disabled = false } = {}) {
  const b = new ButtonBuilder().setCustomId(customId).setStyle(style).setDisabled(disabled);
  if (label) b.setLabel(label);
  if (emoji) b.setEmoji(emoji);
  return b;
}

/** inputs: [{ id, label, value, placeholder, required, long, min, max }] */
function buildModal(customId, title, inputs) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  for (const i of inputs) {
    const input = new TextInputBuilder()
      .setCustomId(i.id)
      .setLabel(i.label)
      .setStyle(i.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(i.required !== false);
    if (i.placeholder) input.setPlaceholder(i.placeholder);
    if (i.value !== undefined && i.value !== null && String(i.value) !== '') input.setValue(String(i.value));
    if (i.min) input.setMinLength(i.min);
    if (i.max) input.setMaxLength(i.max);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

module.exports = { EPHEMERAL, safeReply, updateOrReply, row, button, buildModal, ButtonStyle };
