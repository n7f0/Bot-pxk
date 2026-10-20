const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const { getCfg, setCfg, MonitorSession } = require('./db');
const {
  COLORS,
  row,
  ts,
  fmt,
  fmtDuration,
  perms,
  withLock,
  sendLog,
  logEmbed,
  dayKey,
  render,
  deny,
  eph,
  guildKey,
} = require('./core');
const { awardPoints } = require('./points');
const { checkMember } = require('./metas');
const { findVoiceState, isAuthorizedChannel } = require('./movcall');
const { E, Eb } = require('./emojis');

const STATUS = {
  get active() {
    return `${E('progress')} Em andamento`;
  },
  get approved() {
    return `${E('mcOk')} Aprovada`;
  },
  get rejected() {
    return `${E('mcBad')} Reprovada`;
  },
  get cancelled() {
    return `${E('expired')} Cancelada`;
  },
  get expired() {
    return `${E('expired')} Expirada`;
  },
};

function buildMonitorPanel(cfg) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle(`${E('monitor')} ${cfg.appearance.monitorTitle}`)
    .setDescription(render(cfg.appearance.monitorText, { duracao: cfg.monitor.durationMin }));
  const btn = new ButtonBuilder().setCustomId('mon:open').setLabel('Monitorar Membro').setStyle(ButtonStyle.Secondary);
  const em = Eb('btnMonitor');
  if (em) btn.setEmoji(em);
  return { embeds: [embed], components: [row(btn)] };
}

async function publishMonitorPanel(client) {
  const cfg = getCfg();
  const { channelId, messageId } = cfg.panels.monitor;
  if (!channelId) return { ok: false, reason: 'Canal do painel de monitoria não configurado (/admin → Canais e servidores).' };
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased()) return { ok: false, reason: 'Não consegui acessar o canal do painel de monitoria.' };
  const payload = buildMonitorPanel(cfg);
  const msg = messageId ? await ch.messages.fetch(messageId).catch(() => null) : null;
  if (msg) await msg.edit(payload);
  else await setCfg('panels.monitor.messageId', (await ch.send(payload)).id);
  return { ok: true };
}

// presença do monitorado
function accruePresence(s, client, now) {
  const cfg = getCfg();
  const limit = Math.min(now.getTime(), s.endsAt.getTime());
  const st = findVoiceState(client, s.targetId);
  const inAuth = !!st && isAuthorizedChannel(cfg, st.channel);
  if (inAuth && s.lastSeenAt) {
    const gap = (limit - s.lastSeenAt.getTime()) / 1000;
    if (gap > 0 && gap <= 150) s.presentSec += gap;
  }
  s.lastSeenAt = new Date(limit);
  return inAuth;
}
const durSec = (s) => (s.endsAt - s.startedAt) / 1000;
const pctOf = (s) => Math.min(100, Math.round((s.presentSec / durSec(s)) * 100));

async function tickMonitor(client) {
  const now = new Date();
  const list = await MonitorSession.find({ status: 'active' });
  for (const s of list) {
    await withLock(`m:${s._id}`, async () => {
      const f = await MonitorSession.findById(s._id);
      if (!f || f.status !== 'active') return;
      if (now.getTime() > f.endsAt.getTime() + 30 * 60_000) {
        f.status = 'expired';
        f.finishedAt = now;
        await f.save();
        return;
      }
      if (now < f.endsAt) {
        accruePresence(f, client, now);
        await f.save();
      }
    });
  }
}

// telas
function controlView(s, cfg) {
  const now = new Date();
  const left = Math.max(0, Math.ceil((s.endsAt - now) / 1000));
  const crit = s.criteriaSnapshot || [];
  const embed = new EmbedBuilder()
    .setColor(s.status === 'approved' ? COLORS.ok : s.status === 'active' ? COLORS.warn : COLORS.neutral)
    .setTitle(`${E('monitor')} Monitoria - ${s.typeLabel}`)
    .setDescription(
      [
        `**Membro:** <@${s.targetId}> • **Responsável:** <@${s.byId}>`,
        `**Status:** ${STATUS[s.status]}`,
        `**Início:** ${ts(s.startedAt, 't')} • **Término:** ${ts(s.endsAt, 't')} ${s.status === 'active' ? (left > 0 ? `(faltam ${fmtDuration(left)})` : '(tempo concluído)') : ''}`,
        `**Presença na call:** ${pctOf(s)}% (mínimo ${cfg.monitor.minPresencePct}%) • Canal: ${s.channelId ? `<#${s.channelId}>` : '-'}`,
        `**Bônus:** ${fmt(s.bonus)}`,
        s.observation ? `**Observação:** ${s.observation}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .addFields({
      name: 'Critérios',
      value: crit.length
        ? crit
            .map((c, idx) => `${s.criteriaMet.includes(idx) ? E('checkOn') : E('checkOff')} ${c}`)
            .join('\n')
            .slice(0, 1020)
        : 'Nenhum critério configurado.',
    });
  if (s.status !== 'active') return { embeds: [embed], components: [] };
  const components = [];
  if (crit.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`mon:crit:${s._id}`)
          .setPlaceholder('Marque os critérios cumpridos')
          .setMinValues(0)
          .setMaxValues(Math.min(crit.length, 25))
          .addOptions(
            crit
              .slice(0, 25)
              .map((c, idx) => ({ label: c.slice(0, 100), value: String(idx), default: s.criteriaMet.includes(idx) })),
          ),
      ),
    );
  }
  components.push(
    row(
      new ButtonBuilder().setCustomId(`mon:refresh:${s._id}`).setLabel('Atualizar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`mon:ok:${s._id}`).setLabel('Aprovar e dar bônus').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`mon:no:${s._id}`).setLabel('Reprovar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`mon:cancel:${s._id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
    ),
  );
  return { embeds: [embed], components };
}

const pickUserView = (typeKey, label) => ({
  content: `${E('monitor')} **${label}** - escolha o membro que está em uma call autorizada:`,
  embeds: [],
  components: [
    row(new UserSelectMenuBuilder().setCustomId(`mon:pick:${typeKey}`).setPlaceholder('Selecione o membro').setMaxValues(1)),
  ],
});

async function startFlow(i, update = true) {
  const cfg = getCfg();
  const p = perms(i.member, cfg);
  if (!p.canMonitor) return i.reply(deny(`${E('bad')} Você não tem permissão para realizar monitorias.`));
  const types = cfg.monitor.types;
  if (!types.length) return i.reply(deny(`${E('warn')} Nenhum tipo de monitoria configurado.`));
  if (types.length === 1) return i.reply(eph(pickUserView(types[0].key, types[0].label)));
  return i.reply(
    eph({
      content: 'Escolha o tipo de monitoria:',
      embeds: [],
      components: [
        row(
          new StringSelectMenuBuilder()
            .setCustomId('mon:type')
            .setPlaceholder('Tipo de monitoria')
            .addOptions(
              types
                .slice(0, 25)
                .map((t) => ({ label: t.label.slice(0, 100), value: t.key, description: `Bônus: ${fmt(t.bonus)}` })),
            ),
        ),
      ],
    }),
  );
}

async function monitorCommand(i) {
  const cfg = getCfg();
  if (guildKey(i.guildId) !== 'internal') return i.reply(deny(`${E('bad')} A monitoria funciona apenas no servidor interno.`));
  if (!perms(i.member, cfg).canMonitor) return i.reply(deny(`${E('bad')} Você não tem permissão para realizar monitorias.`));
  const mine = await MonitorSession.find({ byId: i.user.id, status: 'active' }).sort({ startedAt: -1 }).limit(25);
  const components = [
    row(new ButtonBuilder().setCustomId('mon:open').setLabel('Monitorar Membro').setStyle(ButtonStyle.Secondary)),
  ];
  if (mine.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId('mon:reopen')
          .setPlaceholder('Reabrir uma monitoria em andamento')
          .addOptions(
            mine.map((m) => ({
              label: `${m.targetTag || m.targetId} - ${m.typeLabel}`.slice(0, 100),
              value: String(m._id),
              description: `Término ${m.endsAt.toISOString().slice(11, 16)} UTC`,
            })),
          ),
      ),
    );
  }
  return i.reply(
    eph({
      content: `${E('monitor')} **Ferramentas de monitoria** - duração padrão: ${cfg.monitor.durationMin} min.`,
      components,
    }),
  );
}

// ações
async function startMonitoring(i, typeKey) {
  const cfg = getCfg();
  const type = cfg.monitor.types.find((t) => t.key === typeKey);
  if (!type) return i.update({ content: `${E('bad')} Tipo de monitoria inválido.`, components: [] });
  if (!perms(i.member, cfg).canMonitor) return i.update({ content: `${E('bad')} Sem permissão.`, components: [] });
  const target = i.users.first();
  if (!target || target.bot) return i.update({ content: `${E('bad')} Escolha um membro (não um bot).`, components: [] });
  if (target.id === i.user.id && !cfg.monitor.allowSelf)
    return i.update({ content: `${E('bad')} Você não pode monitorar a si mesmo.`, components: [] });
  const st = findVoiceState(i.client, target.id);
  if (!st || !isAuthorizedChannel(cfg, st.channel))
    return i.update({
      content: `${E('warn')} <@${target.id}> não está em uma call autorizada agora.`,
      components: [],
      allowedMentions: { parse: [] },
    });
  if (await MonitorSession.exists({ targetId: target.id, status: 'active' }))
    return i.update({
      content: `${E('warn')} Já existe uma monitoria em andamento para <@${target.id}>.`,
      components: [],
      allowedMentions: { parse: [] },
    });

  const now = new Date();
  const s = await MonitorSession.create({
    targetId: target.id,
    targetTag: target.username,
    byId: i.user.id,
    byTag: i.user.username,
    type: type.key,
    typeLabel: type.label,
    channelId: st.channelId,
    startedAt: now,
    lastSeenAt: now,
    endsAt: new Date(now.getTime() + cfg.monitor.durationMin * 60_000),
    criteriaSnapshot: cfg.monitor.criteria,
    bonus: type.bonus,
  });
  sendLog(
    i.client,
    'monitoria',
    logEmbed(
      `${E('monitor')} Monitoria iniciada`,
      `**Responsável:** <@${i.user.id}>\n**Membro:** <@${target.id}>\n**Canal:** <#${st.channelId}>\n**Tipo:** ${type.label}\n**Término:** ${ts(s.endsAt, 't')}`,
    ),
  );
  return i.update({ content: '', ...controlView(s, cfg), allowedMentions: { parse: [] } });
}

async function loadControlled(i, id) {
  const s = await MonitorSession.findById(id).catch(() => null);
  if (!s) {
    await i.reply(deny(`${E('bad')} Monitoria não encontrada.`));
    return null;
  }
  if (i.user.id !== s.byId && !perms(i.member, getCfg()).isLeader) {
    await i.reply(deny(`${E('bad')} Apenas o responsável pela monitoria (ou a liderança) pode usar estes botões.`));
    return null;
  }
  return s;
}

async function finalize(i, id, approved, observation) {
  return withLock(`m:${id}`, async () => {
    const cfg = getCfg();
    const s = await MonitorSession.findById(id);
    if (!s || s.status !== 'active') return i.reply(deny(`${E('warn')} Esta monitoria já foi finalizada.`));
    const now = new Date();
    accruePresence(s, i.client, now);
    const reply = (text) => i.reply(deny(text));
    if (approved) {
      if (now < s.endsAt) {
        await s.save();
        return reply(
          `${E('warn')} Aguarde o fim do tempo da monitoria (${fmtDuration((s.endsAt - now) / 1000)} restantes) para aprovar.`,
        );
      }
      if (pctOf(s) < cfg.monitor.minPresencePct) {
        await s.save();
        return reply(
          `${E('bad')} A presença do membro foi de ${pctOf(s)}%, abaixo do mínimo de ${cfg.monitor.minPresencePct}%. Reprove ou cancele a monitoria.`,
        );
      }
      const total = (s.criteriaSnapshot || []).length;
      if (cfg.monitor.requireAllCriteria && total && s.criteriaMet.length < total) {
        await s.save();
        return reply(`${E('warn')} Marque todos os critérios cumpridos antes de aprovar (${s.criteriaMet.length}/${total}).`);
      }
      const today = dayKey(now);
      if (
        cfg.monitor.maxPerTargetPerDay > 0 &&
        (await MonitorSession.countDocuments({ targetId: s.targetId, status: 'approved', dayKey: today })) >=
          cfg.monitor.maxPerTargetPerDay
      ) {
        return reply(
          `${E('warn')} <@${s.targetId}> já atingiu o limite de ${cfg.monitor.maxPerTargetPerDay} bônus de monitoria hoje.`,
        );
      }
      if (
        cfg.monitor.maxPerMonitorPerDay > 0 &&
        (await MonitorSession.countDocuments({ byId: s.byId, status: 'approved', dayKey: today })) >=
          cfg.monitor.maxPerMonitorPerDay
      ) {
        return reply(`${E('warn')} Você atingiu o limite de ${cfg.monitor.maxPerMonitorPerDay} monitorias aprovadas hoje.`);
      }
      await awardPoints({
        key: `monitor:${s._id}`,
        userId: s.targetId,
        tag: s.targetTag,
        category: 'monitor',
        amount: s.bonus,
        reason: `Monitoria (${s.typeLabel}) por ${s.byTag}`,
        by: s.byId,
        refId: s._id,
      });
      s.dayKey = today;
      checkMember(i.client, s.targetId, s.targetTag).catch((e) => console.error('[metas]', e.message));
    }
    s.status = approved ? 'approved' : 'rejected';
    s.observation = observation || '';
    s.finishedAt = now;
    if (!approved) s.bonus = 0;
    await s.save();
    sendLog(
      i.client,
      'monitoria',
      logEmbed(
        `${E('monitor')} Monitoria ${approved ? 'aprovada' : 'reprovada'}`,
        `**Membro:** <@${s.targetId}>\n**Responsável:** <@${s.byId}>\n**Presença:** ${pctOf(s)}%\n**Critérios:** ${s.criteriaMet.length}/${(s.criteriaSnapshot || []).length}\n**Bônus:** ${fmt(s.bonus)}\n**Observação:** ${s.observation || '-'}`,
        approved ? COLORS.ok : COLORS.bad,
      ),
    );
    return i.update({ content: '', ...controlView(s, cfg), allowedMentions: { parse: [] } });
  });
}

function obsModal(kind, id, required) {
  return new ModalBuilder()
    .setCustomId(`mon:${kind}m:${id}`)
    .setTitle(required ? 'Justificativa da reprovação' : 'Observações (opcional)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('obs')
          .setLabel(required ? 'Justificativa' : 'Observações')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(required)
          .setMaxLength(500),
      ),
    );
}

async function handleMonitor(i) {
  const [, act, arg] = i.customId.split(':');
  const cfg = getCfg();
  switch (act) {
    case 'open':
      return startFlow(i);
    case 'type':
      return i.update(pickUserView(i.values[0], cfg.monitor.types.find((t) => t.key === i.values[0])?.label || 'Monitoria'));
    case 'pick':
      return startMonitoring(i, arg);
    case 'reopen': {
      const s = await loadControlled(i, i.values[0]);
      return s ? i.update({ content: '', ...controlView(s, cfg) }) : undefined;
    }
    case 'refresh': {
      const s = await loadControlled(i, arg);
      if (!s) return;
      if (s.status === 'active') {
        accruePresence(s, i.client, new Date());
        await s.save();
      }
      return i.update({ content: '', ...controlView(s, cfg) });
    }
    case 'crit': {
      const s = await loadControlled(i, arg);
      if (!s) return;
      if (s.status !== 'active') return i.update({ content: '', ...controlView(s, cfg) });
      s.criteriaMet = i.values.map(Number);
      await s.save();
      return i.update({ content: '', ...controlView(s, cfg) });
    }
    case 'ok': {
      const s = await loadControlled(i, arg);
      return s ? i.showModal(obsModal('ok', arg, false)) : undefined;
    }
    case 'no': {
      const s = await loadControlled(i, arg);
      return s ? i.showModal(obsModal('no', arg, true)) : undefined;
    }
    case 'okm': {
      const s = await loadControlled(i, arg);
      return s ? finalize(i, arg, true, i.fields.getTextInputValue('obs').trim()) : undefined;
    }
    case 'nom': {
      const s = await loadControlled(i, arg);
      return s ? finalize(i, arg, false, i.fields.getTextInputValue('obs').trim()) : undefined;
    }
    case 'cancel': {
      const s = await loadControlled(i, arg);
      if (!s) return;
      if (s.status === 'active') {
        s.status = 'cancelled';
        s.finishedAt = new Date();
        await s.save();
        sendLog(
          i.client,
          'monitoria',
          logEmbed(`${E('monitor')} Monitoria cancelada`, `<@${s.byId}> cancelou a monitoria de <@${s.targetId}>.`, COLORS.warn),
        );
      }
      return i.update({ content: '', ...controlView(s, cfg) });
    }
  }
}

module.exports = { buildMonitorPanel, publishMonitorPanel, tickMonitor, monitorCommand, handleMonitor };
