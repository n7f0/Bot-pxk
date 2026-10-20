// prefixos de mensagem e Lista de MOV
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getCfg, setCfg, getSeason, MovLista, UserMov } = require('./db');
const { row, ts, fmt, fmtDuration, perms, withLock, guildKey, render, trunc } = require('./core');
const { awardPoints } = require('./points');
const { checkMember } = require('./metas');
const { findVoiceState, isAuthorizedChannel } = require('./movcall');
const { scheduleRankingRefresh } = require('./ranking');
const { startMov, adminCancelMov, ui } = require('./iniciarmov');
const { E, Eb } = require('./emojis');

const { v2, v2Update, text, sep, plain, btn, dm, incStat, movLog, short } = ui;

const GAP_MAX = 180;
const PANEL_EVERY_MS = 55_000;
const MAX_LINES_CHARS = 3000;
const PAGE_SIZE = 10; // pessoas por página no painel da lista
const listPage = new Map();

// prefixos
const norm = (s) =>
  String(s || '')
    .trim()
    .toLowerCase();
function matchPrefix(content, prefix) {
  const c = norm(content);
  const p = norm(prefix);
  if (!p || !c.startsWith(p)) return null;
  if (c.length === p.length) return '';
  return /\s/.test(c[p.length]) ? c.slice(p.length).trim() : null;
}

let warnedDelete = false;
async function privateNote(msg, content) {
  try {
    await msg.author.send({ content, allowedMentions: { parse: [] } });
    return;
  } catch {
    /* DMs fechadas: usa o aviso temporário */
  }
  try {
    const m = await msg.channel.send({ content: `<@${msg.author.id}> ${content}`, allowedMentions: { parse: [] } });
    setTimeout(() => m.delete().catch(() => {}), 12_000);
  } catch (e) {
    console.warn('[prefixo] não consegui avisar o membro:', e.message);
  }
}

async function onPrefixMessage(client, msg) {
  if (msg.author.bot || !msg.guild || !guildKey(msg.guildId)) return;
  const cfg = getCfg();
  const isStart = matchPrefix(msg.content, cfg.prefixes.start) !== null;
  const listaArgs = isStart ? null : matchPrefix(msg.content, cfg.prefixes.lista);
  const isLista = listaArgs !== null;
  const isCancel = !isStart && !isLista && matchPrefix(msg.content, cfg.prefixes.cancel) !== null;
  if (!isStart && !isLista && !isCancel) return;

  await msg.delete().catch((e) => {
    if (!warnedDelete) {
      warnedDelete = true;
      console.warn(`[prefixo] não consegui apagar a mensagem (dê a permissão Gerenciar mensagens ao bot): ${e.message}`);
    }
  });
  const reply = (content) => privateNote(msg, content);
  const member = msg.member || (await msg.guild.members.fetch(msg.author.id).catch(() => null));
  if (!member) return;
  if (isLista ? !canLaunch(member, cfg) : !perms(member, cfg).canStartMov) {
    return reply(`${E('bad')} Você não possui um cargo autorizado a ${isLista ? 'lançar a lista de MOV' : 'usar este prefixo'}.`);
  }

  if (isCancel) return cancelByPrefix({ client, msg, reply });
  if (isStart) {
    return startMov({ client, user: msg.author, member, guildId: msg.guildId, channel: msg.channel, reply });
  }
  return startLista({ client, msg, reply, args: listaArgs });
}

function canLaunch(member, cfg = getCfg()) {
  const p = perms(member, cfg);
  const ids = cfg.listaMov.launchRoleIds || [];
  if (!ids.length) return p.canStartMov;
  return p.isAdmin || ids.some((r) => member.roles.cache.has(r));
}

async function cancelByPrefix({ client, msg, reply }) {
  const by = msg.author;
  const done = [];
  const mov = await UserMov.findOne({ userId: by.id, status: 'active' }).select('_id').lean();
  if (mov && (await adminCancelMov(client, mov._id, `${by.username} pelo prefixo`))) done.push('sua **MOV** em andamento');
  const listas = await MovLista.find({ startedById: by.id, status: 'active' }).select('_id').lean();
  let n = 0;
  for (const x of listas) if (await cancelLista(client, x._id, by)) n++;
  if (n) done.push(`${n} **lista(s)** em andamento`);
  if (!done.length) return reply(`${E('warn')} Você não tem MOV nem lista em andamento para cancelar.`);
  return reply(`${E('ok')} Cancelado: ${done.join(' e ')}.`);
}

function cancelLista(client, id, by) {
  return withLock(`ml:${id}`, async () => {
    const l = await MovLista.findById(id);
    if (!l || l.status !== 'active') return false;
    const notifyTo = [];
    for (const p of l.participants) {
      if (['waiting', 'active'].includes(p.status)) {
        p.status = 'cancelled';
        notifyTo.push(p.userId);
      }
    }
    l.status = 'cancelled';
    l.cancelledById = by.id;
    await l.save();
    if (getCfg().listaMov.notify)
      for (const uid of notifyTo)
        dm(client, uid, `${E('cancel')} A MOV foi **cancelada** por quem a iniciou. Sua contagem foi interrompida.`);
    await movLog(client, `${E('cancel')} Lista de MOV cancelada`, [
      `**Lista:** #${short(l._id)} • **Por:** <@${by.id}>`,
      `**Participantes interrompidos:** ${notifyTo.length}`,
    ]);
    await refreshList(client, l);
    return true;
  });
}

// /pararlista
function stopLista(client, id, by) {
  return withLock(`ml:${id}`, async () => {
    const l = await MovLista.findById(id);
    if (!l || l.status !== 'active') return null;
    const now = new Date();
    const affected = [];
    for (const p of l.participants) {
      if (p.status === 'waiting') {
        p.status = 'missed';
        affected.push(p);
      } else if (p.status === 'active') {
        if (p.inCall && p.lastSeenAt) {
          const gap = (now - p.lastSeenAt) / 1000;
          if (gap > 0 && gap <= GAP_MAX) p.presentSec = Math.min(p.presentSec + gap, l.durationMin * 60);
        }
        p.status = 'done';
        p.endsAt = now;
        p.lastSeenAt = now;
        p.inCall = false;
        affected.push(p);
      }
    }
    l.status = 'analysis';
    l.stoppedById = by.id;
    await l.save();
    if (getCfg().listaMov.notify) {
      for (const p of affected) {
        dm(
          client,
          p.userId,
          p.status === 'done'
            ? `${E('wait')} A lista de MOV foi **encerrada** pela gestão. Sua contagem parou com **${pctOf(p, l)}%** de presença e foi enviada para análise.`
            : `${E('cancel')} A lista de MOV foi **encerrada** pela gestão antes de você descer para a call pública.`,
        );
      }
    }
    await movLog(client, `${E('movcall')} Lista de MOV parada`, [
      `**Lista:** #${short(l._id)} • **Por:** <@${by.id}>`,
      `**Participantes encerrados:** ${affected.length}`,
      'A gestão pontua pelo chat-lista.',
    ]);
    await refreshList(client, l);
    return { l, count: affected.length };
  });
}

async function pararListaCommand(i) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const cfg = getCfg();
  const p = perms(i.member, cfg);
  if (!p.canPoints && !p.canStartMov) return i.editReply(`${E('bad')} Você não tem permissão para parar a lista.`);

  const wanted = (i.options.getString('lista') || '').replace('#', '').trim().toUpperCase();
  const acao = i.options.getString('acao') || 'parar';
  let listas = await MovLista.find({ status: 'active' }).sort({ createdAt: -1 }).lean();
  if (!p.canPoints) listas = listas.filter((l) => l.startedById === i.user.id);
  if (wanted) listas = listas.filter((l) => short(l._id) === wanted);

  if (!listas.length) {
    return i.editReply(
      `${E('warn')} ${wanted ? `Não achei lista em andamento com o ID **#${wanted}**.` : 'Não há lista de MOV em andamento para parar.'}`,
    );
  }
  if (listas.length > 1) {
    const ids = listas
      .slice(0, 10)
      .map((l) => `• **#${short(l._id)}** - iniciada por <@${l.startedById}> ${ts(l.createdAt, 'R')}`)
      .join('\n');
    return i.editReply({
      content: `${E('warn')} Há **${listas.length}** listas em andamento. Rode de novo informando o ID no campo \`lista\`:\n${ids}`,
      allowedMentions: { parse: [] },
    });
  }

  const l = listas[0];
  if (acao === 'cancelar') {
    const ok = await cancelLista(i.client, l._id, i.user);
    return i.editReply(
      ok
        ? `${E('ok')} Lista **#${short(l._id)}** cancelada. Ninguém será pontuado por ela.`
        : `${E('warn')} Essa lista já não está mais em andamento.`,
    );
  }
  const res = await stopLista(i.client, l._id, i.user);
  if (!res) return i.editReply(`${E('warn')} Essa lista já não está mais em andamento.`);
  return i.editReply(
    `${E('ok')} Lista **#${short(l._id)}** parada. ${res.count} participante(s) encerrado(s) e a lista foi enviada para **análise da gestão** (botões Pontuar continuam funcionando).`,
  );
}

// canal chat-lista
async function ensureListChannel(client, guild, cfg) {
  const id = cfg.listaMov.channelId;
  let ch = id ? await client.channels.fetch(id).catch(() => null) : null;
  if (ch?.isTextBased()) return ch;
  ch = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === 'chat-lista');
  if (!ch) {
    try {
      const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
      ];
      const roleIds = [...new Set([...cfg.perms.admin, ...cfg.perms.leader, ...cfg.perms.points])].filter((r) =>
        guild.roles.cache.has(r),
      );
      for (const r of roleIds)
        overwrites.push({ id: r, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
      ch = await guild.channels.create({
        name: 'chat-lista',
        type: ChannelType.GuildText,
        permissionOverwrites: overwrites,
        reason: 'Lista de MOV',
      });
    } catch (e) {
      console.warn('[movlista] não consegui criar o chat-lista:', e.message);
      return null;
    }
  }
  await setCfg('listaMov.channelId', ch.id).catch(() => {});
  return ch;
}

async function startLista({ client, msg, reply, args = '' }) {
  const cfg = getCfg();
  const lc = cfg.listaMov;
  const word = norm(args).split(/\s+/)[0];
  const mode = ['todos', 'todo', 'all'].includes(word)
    ? 'all'
    : ['cargos', 'cargo', 'roles'].includes(word)
      ? 'roles'
      : lc.collectMode === 'roles'
        ? 'roles'
        : 'all';
  if (mode === 'roles' && !lc.roleIds.length)
    return reply(
      `${E('warn')} Para coletar só quem tem cargo, configure o cargo de Mov Call em **/admin → Prefixos e Lista de MOV** (ou use \`${cfg.prefixes.lista} todos\` para coletar todos da call).`,
    );
  const st = findVoiceState(client, msg.author.id);
  if (!st) return reply(`${E('warn')} Entre na call onde estão os membros da Mov Call antes de usar o prefixo.`);

  const inChannel = [...st.guild.voiceStates.cache.values()].filter((v) => v.channelId === st.channelId);
  const found = [];
  for (const vs of inChannel) {
    const m = vs.member || (await st.guild.members.fetch(vs.id).catch(() => null));
    if (!m || m.user.bot) continue;
    if (mode === 'all') {
      found.push(m);
      continue;
    } // modo "todos": todos os IDs da call
    const hasMov = lc.roleIds.some((r) => m.roles.cache.has(r));
    const hasStaff = !lc.staffRoleIds.length || lc.staffRoleIds.some((r) => m.roles.cache.has(r));
    if (hasMov && hasStaff) found.push(m);
  }
  if (!found.length)
    return reply(
      mode === 'all'
        ? `${E('warn')} Não encontrei ninguém nesta call.`
        : `${E('warn')} Não encontrei ninguém com o cargo de Mov Call${lc.staffRoleIds.length ? ' e de staff' : ''} nesta call. Use \`${cfg.prefixes.lista} todos\` para coletar todos.`,
    );

  const open = await MovLista.find({ status: 'active' }).select('participants.userId participants.status').lean();
  const busy = new Set(
    open.flatMap((l) => l.participants.filter((p) => ['waiting', 'active'].includes(p.status)).map((p) => p.userId)),
  );
  const fresh = found.filter((m) => !busy.has(m.id));
  const skipped = found.length - fresh.length;
  if (!fresh.length) return reply(`${E('warn')} Todos os membros desta call já estão em uma lista em andamento.`);

  const channel = await ensureListChannel(client, st.guild, cfg);
  if (!channel)
    return reply(
      `${E('bad')} Não consegui achar nem criar o canal **chat-lista**. Escolha um canal em **/admin → Prefixos e Lista de MOV** (o bot precisa de permissão para enviar mensagens nele).`,
    );

  const season = await getSeason();
  const lista = await MovLista.create({
    guildId: msg.guildId,
    seasonId: season._id,
    startedById: msg.author.id,
    startedByTag: msg.author.username,
    sourceChannelId: st.channelId,
    sourceChannelName: st.channel?.name || '',
    durationMin: lc.durationMin,
    minPresencePct: lc.minPresencePct,
    waitMin: lc.waitMin,
    collectMode: mode,
    released: !lc.requireStartButton,
    releasedAt: lc.requireStartButton ? undefined : new Date(),
    releasedById: lc.requireStartButton ? undefined : msg.author.id,
    participants: fresh.map((m) => ({ userId: m.id, tag: m.user.username })),
  });
  try {
    const sent = await channel.send(listPayload(lista, cfg));
    lista.list = { channelId: sent.channelId, messageId: sent.id };
    await lista.save();
    lastPanel.set(String(lista._id), Date.now());
  } catch (e) {
    console.error('[movlista] não consegui publicar a lista:', e.message);
    await MovLista.deleteOne({ _id: lista._id });
    return reply(`${E('bad')} Não consegui publicar a lista no canal configurado (confira as permissões do bot).`);
  }
  await movLog(client, `${E('movcall')} Lista de MOV criada`, [
    `**Iniciada por:** <@${lista.startedById}>`,
    `**Call:** ${lista.sourceChannelName}`,
    `**Participantes coletados:** ${fresh.length}`,
    `**ID:** #${short(lista._id)}`,
  ]);
  const ids = fresh.map((m) => m.id);
  const head = `${E('ok')} Lista **#${short(lista._id)}** criada (${mode === 'all' ? 'todos os IDs da call' : 'só quem tem cargo'}) com **${fresh.length}** participante(s)${skipped ? ` (${skipped} já estavam em outra lista)` : ''}.`;
  if (lista.released === false)
    return reply(
      `${head} A contagem só começa quando alguém autorizado clicar em **Iniciar MOV** no painel de <#${channel.id}>.`,
    );
  setImmediate(() => {
    for (const id of ids) onVoiceLista(client, id).catch(() => {});
  }); // quem já estiver numa call pública começa na hora
  return reply(
    `${head} Assim que cada um entrar numa call pública, a contagem de **${lista.durationMin} min** começa e a pessoa recebe uma DM. Acompanhe em <#${channel.id}>.`,
  );
}

// apresentação
const pctOf = (p, l) => Math.min(100, Math.round((p.presentSec / (l.durationMin * 60)) * 100));
const eligible = (p, l) => p.status === 'done' && !p.scored && pctOf(p, l) >= l.minPresencePct;

function lineOf(p, l) {
  const base = `<@${p.userId}> (\`${p.userId}\`)`;
  const t = `${fmtDuration(p.presentSec)} de ${l.durationMin} min (${pctOf(p, l)}%)`;
  if (p.scored) return `${E('crystal')} ${base} - ${t} • **+${fmt(p.points)}**`;
  switch (p.status) {
    case 'waiting':
      return `${E('wait')} ${base} - aguardando descer para a call pública`;
    case 'active':
      return `${E('join')} ${base} - ${t} • termina ${ts(p.endsAt, 'R')}`;
    case 'done':
      return `${pctOf(p, l) >= l.minPresencePct ? E('ok') : E('warn')} ${base} - ${t}`;
    case 'missed':
      return `${E('cancel')} ${base} - não desceu a tempo`;
    case 'cancelled':
      return `${E('cancel')} ${base} - interrompido (lista cancelada)`;
    default:
      return base;
  }
}

function listPayload(l, cfg) {
  const c = new ContainerBuilder();
  const pages = Math.max(1, Math.ceil(l.participants.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, listPage.get(String(l._id)) || 0), pages - 1);
  listPage.set(String(l._id), page);
  const shown = l.participants.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const count = (s) => l.participants.filter((p) => p.status === s).length;
  const live = l.status === 'active';
  text(c, `## ${E('movcall')} Lista de MOV\n-# #${short(l._id)}`);
  sep(c);
  text(
    c,
    [
      `**Iniciada por:** <@${l.startedById}> • ${ts(l.createdAt, 't')}`,
      l.sourceChannelName ? `**Call de origem:** ${trunc(l.sourceChannelName, 60)}` : '',
      `**Por pessoa:** ${l.durationMin} min em call pública • **Mínimo para o botão Pontuar:** ${l.minPresencePct}%`,
      `**Status:** ${l.status === 'cancelled' ? `${E('cancel')} Cancelada${l.cancelledById ? ` por <@${l.cancelledById}>` : ''}` : live ? (l.released === false ? `${E('wait')} Aguardando início - clique em **Iniciar MOV**` : `${E('join')} Em andamento`) : `${E('review')} Em análise da gestão${l.stoppedById ? ` (parada por <@${l.stoppedById}>)` : ''}`} • ${count('done')} concluída(s) • ${count('active')} em call • ${count('waiting')} aguardando${count('missed') ? ` • ${count('missed')} não desceu` : ''}`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  sep(c);
  const lines = [];
  let used = 0;
  for (const p of shown) {
    const ln = lineOf(p, l);
    if (used + ln.length > MAX_LINES_CHARS) break;
    lines.push(ln);
    used += ln.length + 1;
  }
  text(c, lines.join('\n') || '-');
  if (pages > 1) {
    c.addActionRowComponents(
      row(
        new ButtonBuilder()
          .setCustomId(`ml:pg:${l._id}:${page - 1}`)
          .setEmoji(Eb('prev'))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId('ml:noop')
          .setLabel(`Página ${page + 1}/${pages} • ${l.participants.length} pessoas`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`ml:pg:${l._id}:${page + 1}`)
          .setEmoji(Eb('next'))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= pages - 1),
      ),
    );
  }
  if (l.status === 'cancelled') return v2(c);
  sep(c);
  text(
    c,
    `-# O bot mede se a pessoa está **conectada** numa call pública. Confira o histórico de chamada e pontue um por um no menu abaixo, ou use o botão para todos que atingiram a presença mínima.${live && l.released === false ? ' A contagem só começa quando alguém autorizado clicar em **Iniciar MOV**.' : ''}`,
  );
  const pickable = shown.filter((p) => p.status === 'done' && !p.scored); // quem está na página aberta
  if (pickable.length) {
    c.addActionRowComponents(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(`ml:pick:${l._id}`)
          .setPlaceholder('Pontuar uma pessoa (individual)')
          .addOptions(
            pickable.map((p) => ({
              label: trunc(p.tag || p.userId, 100),
              value: p.userId,
              description: trunc(`${fmtDuration(p.presentSec)} • ${pctOf(p, l)}% • ${p.userId}`, 100),
            })),
          ),
      ),
    );
  }
  const nElig = l.participants.filter((p) => eligible(p, l)).length;
  const buttons = [
    btn(`ml:all:${l._id}`, `Pontuar (≥${l.minPresencePct}%)${nElig ? ` • ${nElig}` : ''}`, ButtonStyle.Success),
    btn(`ml:ref:${l._id}`, 'Atualizar'),
  ];
  if (live) {
    const waiting = l.released === false;
    buttons.push(
      btn(
        `ml:go:${l._id}`,
        waiting ? 'Iniciar MOV' : 'MOV iniciada',
        waiting ? ButtonStyle.Primary : ButtonStyle.Secondary,
        '▶️',
      ).setDisabled(!waiting),
    );
  }
  c.addActionRowComponents(row(...buttons));
  return v2(c);
}

const lastPanel = new Map();
async function refreshList(client, listaOrId) {
  try {
    const l = listaOrId?._id ? listaOrId : await MovLista.findById(listaOrId);
    if (!l?.list?.messageId) return;
    const ch = await client.channels.fetch(l.list.channelId).catch(() => null);
    const msg = ch?.isTextBased() ? await ch.messages.fetch(l.list.messageId).catch(() => null) : null;
    if (!msg) return;
    await msg.edit(listPayload(l, getCfg()));
    lastPanel.set(String(l._id), Date.now());
  } catch (e) {
    console.error('[movlista-painel]', e.message);
  }
}

// acompanhamento
function stepParticipant(p, l, client, cfg, now, maxGap) {
  const events = [];
  const st = findVoiceState(client, p.userId);
  const inPublic = !!st && isAuthorizedChannel(cfg, st.channel);
  if (p.status === 'waiting') {
    if (inPublic) {
      p.status = 'active';
      p.startedAt = now;
      p.endsAt = new Date(now.getTime() + l.durationMin * 60_000);
      p.lastSeenAt = now;
      p.inCall = true;
      events.push('start');
    } else if (now - (l.releasedAt || l.createdAt) > l.waitMin * 60_000) {
      // o prazo conta a partir do Iniciar MOV
      p.status = 'missed';
      events.push('missed');
    }
    return events;
  }
  if (p.status === 'active') {
    const limit = new Date(Math.min(now.getTime(), p.endsAt.getTime()));
    if (p.lastSeenAt) {
      const gap = (limit - p.lastSeenAt) / 1000;
      if (p.inCall && gap > 0 && gap <= maxGap) p.presentSec += gap;
    }
    p.inCall = inPublic;
    p.lastSeenAt = limit;
    if (now >= p.endsAt) {
      p.status = 'done';
      p.presentSec = Math.min(p.presentSec, l.durationMin * 60);
      events.push('end');
    }
  }
  return events;
}

async function notify(client, l, p, kind) {
  const cfg = getCfg();
  if (!cfg.listaMov.notify) return;
  const tpl = kind === 'start' ? cfg.listaMov.msgStart : cfg.listaMov.msgEnd;
  if (!tpl) return;
  const content = trunc(
    render(tpl, {
      emoji: E(kind === 'start' ? 'join' : 'review'),
      usuario: `<@${p.userId}>`,
      duracao: l.durationMin,
      fim: p.endsAt ? ts(p.endsAt, 't') : '',
      presenca: pctOf(p, l),
    }).trim(),
    1900,
  );
  const ok = await dm(client, p.userId, content);
  if (!ok && !p.dmWarned) {
    await movLog(client, `${E('warn')} DM não entregue (Lista de MOV)`, [
      `**Membro:** <@${p.userId}>`,
      'O membro está com as DMs de membros do servidor desativadas (Privacidade do Discord).',
      `**Lista:** #${short(l._id)}`,
    ]);
    await MovLista.updateOne(
      { _id: l._id, 'participants.userId': p.userId },
      { $set: { 'participants.$.dmWarned': true } },
    ).catch(() => {});
  }
}

function processLista(client, id, maxGap = GAP_MAX) {
  return withLock(`ml:${id}`, async () => {
    const l = await MovLista.findById(id);
    if (!l || l.status !== 'active') return;
    if (l.released === false) return;
    const cfg = getCfg();
    const now = new Date();
    const events = [];
    for (const p of l.participants) {
      if (!['waiting', 'active'].includes(p.status)) continue;
      for (const ev of stepParticipant(p, l, client, cfg, now, maxGap)) events.push([ev, p]);
    }
    const allDone = l.participants.every((p) => ['done', 'missed'].includes(p.status));
    if (allDone) l.status = 'analysis';
    await l.save();
    for (const [ev, p] of events) if (ev === 'start' || ev === 'end') await notify(client, l, p, ev);
    if (allDone) {
      await movLog(client, `${E('movcall')} Lista de MOV em análise`, [
        `**Lista:** #${short(l._id)}`,
        `**Concluídas:** ${l.participants.filter((p) => p.status === 'done').length} de ${l.participants.length}`,
        'A gestão pontua pelo chat-lista.',
      ]);
    }
    if (events.length || allDone || Date.now() - (lastPanel.get(String(l._id)) || 0) >= PANEL_EVERY_MS)
      await refreshList(client, l);
  });
}

async function tickLista(client) {
  const list = await MovLista.find({ status: 'active' }).select('_id').lean();
  for (const x of list) await processLista(client, x._id).catch((e) => console.error('[movlista-tick]', e));
}

async function onVoiceLista(client, userId) {
  const list = await MovLista.find({ status: 'active', 'participants.userId': userId }).select('_id').lean();
  for (const x of list) await processLista(client, x._id);
}

async function reconcileLista(client) {
  const tol = getCfg().movCall.restartToleranceSec || 600;
  const list = await MovLista.find({ status: 'active' }).select('_id').lean();
  for (const x of list) await processLista(client, x._id, tol).catch((e) => console.error('[movlista-reconcile]', e));
  console.log(`Lista de MOV: ${list.length} lista(s) em andamento recuperada(s).`);
}

function releaseLista(client, id, by) {
  return withLock(`ml:${id}`, async () => {
    const l = await MovLista.findById(id);
    if (!l || l.status !== 'active' || l.released !== false) return null;
    l.released = true;
    l.releasedAt = new Date();
    l.releasedById = by.id;
    await l.save();
    await movLog(client, `${E('movcall')} Lista de MOV iniciada`, [
      `**Lista:** #${short(l._id)} • **Iniciada por:** <@${by.id}>`,
      `**Participantes:** ${l.participants.length}`,
    ]);
    const ids = l.participants.map((p) => p.userId);
    setImmediate(() => {
      for (const uid of ids) onVoiceLista(client, uid).catch(() => {});
    }); // quem já está numa call pública começa na hora
    return l;
  });
}

const pointsModal = (customId, title, def) =>
  new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('pts')
          .setLabel('Pontuação')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
          .setValue(String(def)),
      ),
    );

function parsePoints(raw, cfg) {
  const n = Math.round(parseFloat(String(raw).replace(',', '.')) * 100) / 100;
  const max = cfg.listaMov.pointsMax;
  if (!Number.isFinite(n) || n <= 0 || n > max) return { error: `A pontuação precisa estar entre 0,01 e ${fmt(max)}.` };
  return { value: n };
}

function scoreList(i, listaId, userIds, amount) {
  return withLock(`ml:${listaId}`, async () => {
    const cfg = getCfg();
    const l = await MovLista.findById(listaId);
    if (!l) return { error: 'Lista não encontrada.' };
    const targets = l.participants.filter(
      (p) => p.status === 'done' && !p.scored && (userIds ? userIds.includes(p.userId) : pctOf(p, l) >= l.minPresencePct),
    );
    if (!targets.length)
      return {
        error: userIds
          ? 'Essa pessoa não pode ser pontuada agora (já pontuada ou ainda em andamento).'
          : `Ninguém com pelo menos ${l.minPresencePct}% de presença e sem pontuação no momento.`,
      };
    const done = [];
    for (const p of targets) {
      await awardPoints({
        key: `movlista:${l._id}:${p.userId}`,
        userId: p.userId,
        tag: p.tag,
        category: 'mov',
        amount,
        reason: `MOV (lista #${short(l._id)})`,
        by: i.user.id,
        refId: l._id,
      });
      p.scored = true;
      p.points = amount;
      p.scoredBy = i.user.id;
      done.push(p);
    }
    await l.save();
    for (const p of done) {
      await incStat(p.userId, p.tag, { mcDone: 1, mcApproved: 1, mcSec: Math.floor(p.presentSec) }).catch((e) =>
        console.error('[movlista-stat]', e.message),
      );
      checkMember(i.client, p.userId, p.tag).catch((e) => console.error('[metas]', e.message));
      dm(i.client, p.userId, `${E('crystal')} Sua MOV foi pontuada: **+${fmt(amount)} ${cfg.points.unit}**.`);
    }
    scheduleRankingRefresh(i.client);
    await movLog(i.client, `${E('movcall')} Lista de MOV pontuada`, [
      `**Lista:** #${short(l._id)} • **Por:** <@${i.user.id}>`,
      `**Pontuação:** ${fmt(amount)} ${cfg.points.unit} para ${done.length} pessoa(s)`,
      done.map((p) => `<@${p.userId}>`).join(' '),
    ]);
    return { l, count: done.length };
  });
}

async function handleLista(i) {
  const [, act, id, uid] = i.customId.split(':');
  const cfg = getCfg();
  const pm = perms(i.member, cfg);
  if (act === 'go') {
    if (!canLaunch(i.member, cfg)) return i.reply(plain(`${E('bad')} Só quem tem o cargo autorizado pode iniciar a MOV.`));
  } else if (act === 'ref' || act === 'pg' ? !(pm.canPoints || canLaunch(i.member, cfg)) : !pm.canPoints) {
    return i.reply(plain(`${E('bad')} Só a gestão da área de MOV Call pode pontuar.`));
  }
  const l = await MovLista.findById(id).catch(() => null);
  if (!l) return i.reply(plain(`${E('bad')} Lista não encontrada.`));
  const def = cfg.listaMov.pointsDefault;

  switch (act) {
    case 'ref':
      await i.deferUpdate();
      return refreshList(i.client, l);
    case 'pg':
      listPage.set(String(l._id), parseInt(uid, 10) || 0);
      await i.deferUpdate();
      return refreshList(i.client, l);
    case 'go': {
      const res = await releaseLista(i.client, id, i.user);
      if (!res) return i.reply(plain(`${E('warn')} Essa lista já foi iniciada ou não está mais em andamento.`));
      await i.deferUpdate();
      return refreshList(i.client, res);
    }
    case 'all':
      return i.showModal(pointsModal(`ml:alm:${id}`, `Pontuar todos com ≥${l.minPresencePct}%`, def));
    case 'pick': {
      const p = l.participants.find((x) => x.userId === i.values[0]);
      if (!p) return i.reply(plain(`${E('bad')} Participante não encontrado.`));
      return i.showModal(pointsModal(`ml:pim:${id}:${p.userId}`, `Pontuar ${p.tag || p.userId}`, def));
    }
    case 'alm':
    case 'pim': {
      const pts = parsePoints(i.fields.getTextInputValue('pts'), cfg);
      if (pts.error) return i.reply(plain(`${E('bad')} ${pts.error}`));
      if (i.isFromMessage?.()) await i.deferUpdate();
      else await i.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await scoreList(i, id, act === 'pim' ? [uid] : null, pts.value);
      if (res.error) return i.followUp(plain(`${E('warn')} ${res.error}`));
      if (i.isFromMessage?.()) await refreshList(i.client, res.l);
      return i.followUp(plain(`${E('ok')} ${res.count} pessoa(s) pontuada(s) com **${fmt(pts.value)} ${cfg.points.unit}**.`));
    }
    default:
      return undefined;
  }
}

module.exports = {
  pararListaCommand,
  stopLista,
  onPrefixMessage,
  tickLista,
  onVoiceLista,
  reconcileLista,
  handleLista,
  _test: { canLaunch, releaseLista, matchPrefix, stepParticipant, listPayload, pctOf },
};
