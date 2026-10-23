// Textos de ajuda do /admin: aparecem em letras pequenas abaixo de cada campo.
// A chave é o caminho da configuração (com {g} no lugar do servidor atual).
const HELP = {
  // ---- Canais ----
  'logs.{g}.geral': 'Canal padrão dos logs deste servidor. Usado quando não há um canal específico.',
  'logs.{g}.tickets': 'Logs de abertura, atendimento e fechamento de tickets.',
  'logs.{g}.recrutamento': 'Logs de recrutamentos e migrações finalizados.',
  'logs.internal.plantao': 'Obrigatório: aqui chegam os plantões para a liderança aceitar ou recusar.',
  'logs.internal.admin': 'Cada alteração feita neste painel é registrada aqui (quem, campo e valor).',
  'voice.{g}': 'Call em que o bot fica conectado neste servidor. Vazio = o bot não entra em call.',
  'tickets.categoryId': 'Categoria onde os tickets em canal são criados (quando o modo tópico está desligado).',
  'tickets.threadChannelId': 'Canal de texto onde os tickets em tópico são criados (modo tópico).',
  'shift.categoryId': 'ID da categoria do servidor principal cujas calls valem para o plantão.',
  'shift.allowedChannelIds': 'Canais em que o botão de iniciar plantão funciona. Vazio = qualquer canal.',

  // ---- Permissões ----
  'perms.{g}.admin': 'Cargos que abrem este painel. Quem tem a permissão Administrador do servidor sempre pode.',
  'perms.{g}.leader': 'Liderança: analisa plantões e usa as ações de gestão.',
  'perms.{g}.recruiter': 'Recrutadores: assumem e finalizam tickets de recrutamento.',
  'perms.main.migrator': 'Cargos habilitados a atender tickets de migração.',
  'perms.internal.shift': 'Quem pode iniciar plantão. Vazio = todos os recrutadores.',

  // ---- Tickets ----
  'tickets.style': 'Aparência do painel de tickets: V1 embed única, V2 embeds em blocos, V3 container de bordas finas.',
  'tickets.useThread': 'Ligado: o ticket abre como tópico privado. Desligado: abre como canal na categoria.',
  'tickets.requireShiftToClaim': 'Ligado: o recrutador precisa estar em plantão para assumir um ticket.',
  'tickets.nameTemplate': 'Variáveis: {tipo} {usuario} {numero}.',
  'tickets.accessRoleIds': 'Cargos que enxergam os tickets.',
  'tickets.assignableRoleIds': 'Cargos de área que o recrutador pode setar (Mov Call, Mov Chat...).',
  'tickets.hierarchyRoleIds': 'Cargos de hierarquia que o migrador pode setar junto com a área.',
  'tickets.hierarchyMax': 'Quantos cargos de hierarquia podem ser setados em cada migração.',
  'tickets.inicianteRoleIds': 'Cargos iniciais dados junto aos cargos setados (Promessa, Staff cargo inicial...).',
  'tickets.questions.staff': 'Uma pergunta por linha: Pergunta | exemplo | longa? | obrigatória? (máx. 5).',
  'tickets.questions.migracao': 'Uma pergunta por linha: Pergunta | exemplo | longa? | obrigatória? (máx. 5).',

  // ---- Mensagens ----
  'tickets.messages.open': 'Primeira mensagem do ticket. Variáveis: {usuario} {tipo} {numero}.',
  'tickets.messages.claim': 'Quando um recrutador assume. Variáveis: {recrutador} {usuario}.',
  'tickets.messages.finish': 'Quando o recrutamento é finalizado. Variáveis: {usuario} {recrutador} {cargos}.',
  'tickets.messages.reject': 'Quando a candidatura é reprovada. Variáveis: {usuario} {recrutador}.',
  'tickets.messages.close': 'Aviso antes de fechar o ticket.',
  'shift.messages.start': 'DM ao iniciar. Variáveis: {usuario} {minutos} {tolerancia} {call} {fim}.',
  'shift.messages.leave': 'DM ao sair da call. Variáveis: {usuario} {tolerancia} {limite}.',
  'shift.messages.cancel': 'DM quando o plantão é cancelado. Variáveis: {usuario} {motivo}.',
  'shift.messages.incomplete': 'DM quando não volta a tempo. Variáveis: {usuario} {tempo}.',
  'shift.messages.done': 'DM ao completar o plantão. Variáveis: {usuario} {minutos}.',

  // ---- Pontuação ----
  'points.recruitment': 'Pontos que o recrutador ganha por candidato recrutado.',
  'points.migration': 'Pontos que o migrador ganha por migração concluída.',
  'points.shiftFlat': 'Pontos fixos por plantão aceito pela liderança.',
  'points.shiftPerHour': 'Pontos extras por hora de plantão aceito.',
  'points.reject': 'Pontos por candidato reprovado (0 = não pontua).',

  // ---- Plantão ----
  'shift.enabled': 'Desligado: ninguém consegue iniciar plantão.',
  'shift.requireVoice': 'Ligado: só inicia o plantão quem estiver em uma call válida.',
  'shift.plannedMinutes': 'Tempo que a pessoa precisa ficar na call para concluir o plantão.',
  'shift.minMinutes': 'Tempo mínimo na call para o plantão contar. Não pode passar da duração prevista.',
  'shift.returnMinutes': 'Minutos para voltar à call depois de sair, antes de o plantão ser encerrado.',
  'shift.maxHours': 'Plantão esquecido vai para análise depois desse tempo.',
  'shift.rules': 'Texto de regras mostrado no painel de plantão.',

  // ---- Ranking ----
  'ranking.enabled': 'Desligado: o ranking deixa de ser atualizado.',
  'ranking.auto': 'Ligado: o bot atualiza o ranking sozinho no intervalo definido.',
  'ranking.topSize': 'Quantas pessoas aparecem no ranking (5 a 25).',
  'ranking.intervalMin': 'De quantos em quantos minutos o ranking é atualizado.',
  'ranking.channelId': 'Canal de texto do servidor interno onde o ranking fica publicado.',
  'ranking.view.sortBy': 'Critério de ordenação do ranking.',
  'ranking.view.style': 'Embed clássica ou container de bordas finas (V3).',
  'ranking.view.unit': 'Nome da pontuação (ex.: pontos).',
  'ranking.view.title': 'Título do ranking.',
  'ranking.view.color': 'Cor da embed em HEX, ex.: #2B2D31.',
  'ranking.view.banner': 'URL da imagem de banner. Vazio remove.',
  'ranking.view.thumbnail': 'URL da miniatura. Vazio remove.',
  'ranking.view.footer': 'Rodapé. {top} vira o tamanho do top.',
  'ranking.view.lineTemplate': 'Modelo de cada linha. Ex.: {emoji} {usuario} — {pontos} {unidade}.',
  'ranking.view.emptyText': 'Texto exibido quando ninguém pontuou ainda.',
  'ranking.view.description': 'Texto opcional acima da lista. Vazio remove.',
  'ranking.view.podiumCount': 'Quantos primeiros usam o modelo de pódio (0 desliga, máx. 10).',
  'ranking.view.podiumTemplate': 'Modelo das linhas do pódio. Vazio = usa o modelo normal.',
  'ranking.view.totalsTemplate': 'Linha de totais abaixo da lista. Vazio = não mostra.',
  'ranking.view.spacing': 'Espaço entre as posições: automático, compacto ou arejado.',
  'ranking.view.showTimestamp': 'Mostra a data da última atualização.',
  'ranking.view.v3Accent': 'V3: liga a barra colorida lateral.',

  // ---- Aparência do painel de tickets ----
  'tickets.panel.title': 'Título do painel "Seja Staff".',
  'tickets.panel.desc1': 'Texto principal do painel.',
  'tickets.panel.desc2': 'Segundo bloco de texto (somente V2). Vazio remove.',
  'tickets.panel.desc3': 'Terceiro bloco de texto (somente V2). Vazio remove.',
  'tickets.panel.desc4': 'Quarto bloco de texto (somente V2). Vazio remove.',
  'tickets.panel.color': 'Cor do painel em HEX, ex.: #D4AF37.',
  'tickets.panel.banner': 'URL da imagem de banner. Vazio remove.',
  'tickets.panel.thumbnail': 'URL da miniatura. Vazio remove.',
  'tickets.panel.footer': 'Texto do rodapé. Vazio remove.',
  'tickets.panel.labelStaff': 'Texto do botão de candidatura a staff.',
  'tickets.panel.labelMig': 'Texto do botão de migração.',
  'tickets.panel.selectPlaceholder': 'Texto do menu de seleção (V3).',
  'tickets.panel.optLabelStaff': 'Nome da opção Recrutamento no menu (V3).',
  'tickets.panel.optLabelMig': 'Nome da opção Migração no menu (V3).',
  'tickets.panel.optDescStaff': 'Descrição da opção Recrutamento (V3).',
  'tickets.panel.optDescMig': 'Descrição da opção Migração (V3).',
  'tickets.panel.v3Accent': 'V3: liga a barra colorida com a cor do painel.',
};

const help = (path) => HELP[path] || '';

module.exports = { HELP, help };
