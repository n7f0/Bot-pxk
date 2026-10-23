// ============================================================
// Interface do /admin — Components V2
// ------------------------------------------------------------
// Panel monta uma mensagem V2 com um único container (sem barra colorida).
//   text(s)            texto em markdown
//   sep()              separador pequeno com divisor
//   section(txt, btn)  texto com botão ao lado
//   row(...botões)     linha de botões
//   done()             { components, flags, allowedMentions }
// O texto total da mensagem não passa de ~3900 caracteres (o excesso é cortado com "…").
// ============================================================
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} = require('discord.js');

const MAX_TEXT = 3900;

class Panel {
  constructor() {
    this.container = new ContainerBuilder(); // sem setAccentColor = sem barra lateral
    this.used = 0;
  }

  // Corta o texto para caber no que ainda resta do limite da mensagem
  _fit(s) {
    s = String(s ?? '');
    const left = MAX_TEXT - this.used;
    if (left <= 1) { this.used = MAX_TEXT; return '…'; }
    if (s.length > left) s = s.slice(0, left - 1) + '…';
    if (!s.trim()) s = '​'; // TextDisplay não aceita texto vazio
    this.used += s.length;
    return s;
  }

  text(s) {
    this.container.addTextDisplayComponents(new TextDisplayBuilder().setContent(this._fit(s)));
    return this;
  }

  sep() {
    this.container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    return this;
  }

  section(texto, botao) {
    this.container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(this._fit(texto))).setButtonAccessory(botao)
    );
    return this;
  }

  row(...botoes) {
    const items = botoes.flat().filter(Boolean);
    if (items.length) this.container.addActionRowComponents(new ActionRowBuilder().addComponents(...items));
    return this;
  }

  done() {
    return {
      components: [this.container],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    };
  }
}

// ---------- botões ----------
const STYLES = {
  primary: ButtonStyle.Primary,
  gray: ButtonStyle.Secondary,
  green: ButtonStyle.Success,
  red: ButtonStyle.Danger,
};
const btn = (id, label, style = 'gray', disabled = false) =>
  new ButtonBuilder().setCustomId(id).setLabel(String(label).slice(0, 80)).setStyle(STYLES[style]).setDisabled(!!disabled);

module.exports = { Panel, btn, MAX_TEXT };
