const {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} = require('discord.js');

const FLAGS = MessageFlags.IsComponentsV2;
const MAX_TEXT = 3900;

class Panel {
  constructor() {
    this.c = new ContainerBuilder();
    this.left = MAX_TEXT;
  }
  take(s) {
    s = String(s ?? '').trim() || '-';
    if (this.left <= 0) return null;
    const out = s.length > this.left ? `${s.slice(0, Math.max(1, this.left - 1))}…` : s;
    this.left -= out.length;
    return out;
  }
  text(s) {
    const t = this.take(s);
    if (t) this.c.addTextDisplayComponents(new TextDisplayBuilder().setContent(t));
    return this;
  }
  sep() {
    this.c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    return this;
  }
  // texto com botão ao lado
  section(s, button) {
    this.c.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(this.take(s) || '-'))
        .setButtonAccessory(button),
    );
    return this;
  }
  row(...components) {
    this.c.addActionRowComponents(new ActionRowBuilder().addComponents(...components));
    return this;
  }
  rowOf(builder) {
    this.c.addActionRowComponents(builder);
    return this;
  }
  done() {
    return { components: [this.c], flags: FLAGS, allowedMentions: { parse: [] } };
  }
}

function legacyToV2(p) {
  const pn = new Panel();
  for (const e of p.embeds || []) {
    const d = e.data || e;
    if (d.title) pn.text(`## ${d.title}`);
    if (d.description) pn.text(d.description);
    for (const f of d.fields || []) pn.text(`**${f.name}**\n${f.value}`);
  }
  if (p.content) pn.text(p.content);
  const rows = p.components || [];
  if (rows.length) pn.sep();
  for (const r of rows) pn.rowOf(r);
  return pn.done();
}

const isV2 = (p) => !!p && (Number(p.flags || 0) & FLAGS) === FLAGS;
const asV2 = (p) => (!p || isV2(p) || !(p.embeds || p.components) ? p : legacyToV2(p));

module.exports = { Panel, FLAGS, legacyToV2, asV2, isV2 };
