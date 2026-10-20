module.exports = {
  // aparência
  'ranking.title': 'Título que aparece no topo da mensagem do ranking.',
  'ranking.style': 'Embed clássico usa a caixa com barra colorida; Container V3 é o visual novo, mais limpo.',
  'ranking.color': 'Cor da barra do ranking, em hexadecimal. Exemplo: #2B2D31.',
  'ranking.banner': 'Link (https://) de uma imagem grande exibida no ranking. Deixe vazio para não usar.',
  'ranking.thumbnail': 'Link (https://) de uma imagem pequena exibida no canto do ranking. Vazio = sem imagem.',
  'ranking.footer': 'Texto do rodapé. Variáveis: {top} {pagina} {paginas} {temporada} {ordem}.',
  'ranking.emptyText': 'Texto mostrado enquanto ninguém pontuou na temporada.',
  'ranking.lineTemplate': 'Modelo de cada linha do ranking. As variáveis entre chaves são trocadas pelos dados de cada pessoa.',
  'ranking.showTimestamp': 'Mostra no ranking o horário da última atualização.',
  'ranking.accentBar': 'Liga a barra lateral colorida no formato Container V3.',
  'points.unit': 'Nome da moeda usado nas mensagens, por exemplo: cristais.',
  'appearance.monitorTitle': 'Título do painel público onde os monitores iniciam a monitoria.',
  'appearance.monitorText': 'Texto explicativo do painel de monitoria. Variável: {duracao}.',

  // canais e servidores
  'servers.mainId': 'ID do servidor principal. Vazio = usa o que está no arquivo .env.',
  'servers.internalId': 'ID do servidor interno (da gestão). Vazio = usa o que está no .env.',
  'servers.extraGuildIds':
    'IDs de outros servidores cujas calls também valem. Cadastre ANTES de convidar o bot lá, senão ele sai sozinho.',
  'voice.channelIds':
    'Calls públicas onde o tempo conta para os cristais (horas gerais). Também são as "calls públicas" da Lista de MOV.',
  'voice.categoryIds': 'Categorias inteiras de calls públicas: todas as calls dentro delas passam a valer.',
  'voice.movChannelIds': 'Calls específicas válidas para a MOV Call. Se ficar vazio, valem as calls de horas gerais.',
  'voice.movCategoryIds': 'Categorias específicas válidas para a MOV Call. Vazio = valem as de horas gerais.',
  'ranking.channelId': 'Canal onde fica a mensagem fixa do ranking.',
  'movCall.panelChannelId': 'Canal onde o painel público de cada MOV é publicado (com o botão Monitorar).',
  'movCall.commandChannelId':
    'Único canal onde o /iniciarmov (e o prefixo de início) funciona. Em qualquer outro canal o bot recusa e avisa qual usar. Vazio = qualquer canal.',
  'panels.monitor.channelId': 'Canal onde fica o painel de monitoria avulsa.',
  'logs.geral': 'Canal de log geral: recebe tudo que não tem um canal de log próprio.',
  'logs.movcall': 'Canal que registra início, fim, cancelamento e pontuação das MOVs e listas.',
  'logs.sessoes': 'Canal que registra entradas e saídas de call de cada membro.',
  'logs.movs': 'Canal de log das MOVs oficiais com horário fixo.',
  'logs.monitoria': 'Canal de log das monitorias.',
  'logs.pontos': 'Canal que registra pontos dados, removidos ou ajustados.',
  'logs.admin': 'Canal que registra toda alteração feita neste painel (auditoria).',

  // MOV Call
  'perms.starter': 'Cargos que podem iniciar MOV, tanto pelo /iniciarmov quanto pelos prefixos.',
  'perms.monitor': 'Cargos que podem clicar em Monitorar e avaliar a MOV de outro membro.',
  'perms.selfMonitor': 'Cargos que podem monitorar e aprovar a própria MOV. Use com cuidado.',
  'movCall.durationMin': 'Quantos minutos dura uma MOV iniciada pelo membro.',
  'movCall.minPresencePct': 'Porcentagem mínima do tempo em que o membro precisa estar na call para a MOV valer.',
  'movCall.leaveGraceSec': 'Segundos que o membro pode ficar fora da call antes de a MOV ser cancelada. 0 = só avalia no final.',
  'monitor.durationMin': 'Minutos que o monitor acompanha o membro depois de clicar em Monitorar.',
  'movCall.pointsMin': 'Menor pontuação que o monitor pode dar ao aprovar.',
  'movCall.pointsMax': 'Maior pontuação que o monitor pode dar ao aprovar.',
  'movCall.pointsDefault': 'Pontuação já preenchida no formulário de aprovação.',
  'movCall.allowDuplicateMonitoring': 'Permite mais de um monitor acompanhando a mesma MOV ao mesmo tempo.',
  'movCall.onLeave':
    'O que fazer se o membro sair da call durante a monitoria: mandar para análise da liderança ou reprovar na hora.',
  'movCall.requireMonitorInCall': 'Exige que o monitor esteja na mesma call do membro durante a monitoria.',
  'movCall.allowEarlyApproval': 'Permite aprovar e pontuar antes de a monitoria terminar.',
  'movCall.autoPointsEnabled': 'Se a MOV terminar sem nenhum monitor, o bot pontua sozinho.',
  'movCall.autoPoints': 'Pontuação dada automaticamente a uma MOV concluída sem monitor.',
  'movCall.autoMoveMonitor': 'O bot tenta mover o monitor para a call do membro (precisa da permissão Mover Membros).',
  'movCall.restartToleranceSec':
    'Depois de um reinício do bot, até quantos segundos parados ainda contam para quem continua na call.',
  'movCall.title': 'Título exibido no painel público da MOV.',

  // prefixos e Lista
  'prefixes.start': 'Palavra que inicia a MOV. Escreva só ela no chat; o bot apaga a mensagem e inicia.',
  'prefixes.lista': 'Palavra que coleta a Lista de MOV da call em que você está. O bot apaga a mensagem.',
  'prefixes.cancel': 'Palavra que cancela a sua MOV e a sua lista em andamento. O bot apaga a mensagem.',
  'listaMov.launchRoleIds':
    'Só quem tem um destes cargos (ou é administrador) consegue lançar a lista com o prefixo e clicar em Iniciar MOV no painel. Vazio = vale o cargo de "Cargos autorizados a usar os prefixos".',
  'listaMov.collectMode':
    'Todos os IDs da call = a lista pega todo mundo que está na call (padrão). Só cargos = pega só quem tem cargo de Mov Call (e staff, se configurado). Em cada uso dá para forçar: `unionlista todos` ou `unionlista cargos`.',
  'listaMov.requireStartButton':
    'Ligado: a lista é lançada, mas a contagem só começa quando alguém autorizado clica em Iniciar MOV no painel. Desligado: começa assim que a lista é lançada.',
  'listaMov.roleIds':
    'Cargo de Mov Call: usado só no modo "só cargos" (e em `unionlista cargos`) - entra na lista só quem está na call COM este cargo.',
  'listaMov.staffRoleIds': 'Cargos de staff: se preenchido, a pessoa também precisa ter um deles. Vazio = não exige staff.',
  'listaMov.channelId': 'Canal chat-lista, onde a lista é publicada. Vazio = o bot procura ou cria um canal chamado chat-lista.',
  'listaMov.durationMin': 'Minutos que cada pessoa precisa ficar numa call pública, contados a partir de quando ela entra.',
  'listaMov.minPresencePct': 'Presença mínima para o botão Pontuar dar pontos a todos de uma vez.',
  'listaMov.waitMin':
    'Minutos que a pessoa tem para descer a uma call pública depois da coleta. Depois disso fica como "não desceu".',
  'listaMov.pointsDefault': 'Pontuação já preenchida nos formulários de pontuar da lista.',
  'listaMov.pointsMax': 'Maior pontuação que a gestão pode dar a uma pessoa na lista.',
  'listaMov.notify': 'Envia as DMs automáticas da lista (entrou na MOV, MOV foi para análise, cancelada).',
  'listaMov.msgStart': 'DM enviada quando a pessoa entra na call pública. Variáveis: {emoji} {usuario} {duracao} {fim}.',
  'listaMov.msgEnd': 'DM enviada quando a hora termina. Variáveis: {emoji} {usuario} {duracao} {presenca}.',

  // mensagens da MOV
  'movCall.notifyEnabled': 'Liga ou desliga TODAS as mensagens automáticas da MOV.',
  'movCall.notifyDm': 'Envia as mensagens na DM do membro (ele precisa permitir DMs do servidor).',
  'movCall.notifyChannel': 'Também publica as mensagens num canal, mencionando o membro.',
  'movCall.notifyFallback': 'Se a DM não for entregue, publica a mensagem no canal.',
  'movCall.notifyChannelId': 'Canal das mensagens públicas. Vazio = o mesmo canal do painel da MOV.',
  'movCall.msgStart':
    'Texto quando a MOV começa. Variáveis: {emoji} {usuario} {duracao} {fim} {tolerancia} {motivo} {presenca} {pontuacao} {pontos} {moeda} {call}.',
  'movCall.msgLeave': 'Texto quando o membro sai da call. Use {tolerancia} para o tempo que ele tem para voltar.',
  'movCall.msgReturn': 'Texto quando o membro volta para a call a tempo.',
  'movCall.msgCancel': 'Texto quando a MOV é cancelada. Use {motivo}.',
  'movCall.msgFinish': 'Texto quando a MOV termina. Use {presenca} e {pontuacao}.',
  'movCall.msgFail': 'Texto quando a MOV não é validada. Use {motivo}.',
  'movCall.msgAuto': 'Texto da pontuação automática dada depois. Use {pontos} e {moeda}.',

  // permissões
  'perms.admin': 'Administradores do bot: acesso total a este painel.',
  'perms.leader': 'Responsáveis pela Mov Call: monitoram, pontuam, decidem casos em análise e consultam histórico de outros.',
  'perms.points': 'Cargos que podem dar, remover e ajustar pontos, e pontuar a Lista de MOV.',
  'perms.discordAdmin':
    'Quem tem a permissão Administrador do Discord também é admin do bot. Só desligue depois de cadastrar um cargo de administrador.',

  // pontuação
  'points.perHour': 'Quantos cristais cada hora válida em call rende.',
  'points.rounding': 'Como arredondar os cristais ganhos por tempo.',
  'points.dailyCap': 'Máximo de cristais por tempo que um membro ganha por dia. 0 = sem limite.',
  'mov.points': 'Pontos que um novo MOV oficial já vem configurado para dar.',
  'mov.minMinutes': 'Minutos mínimos de participação que um novo MOV oficial já vem exigindo.',

  // contagem automática
  'voice.countMuted': 'Quem está com o microfone mutado continua acumulando tempo.',
  'voice.countDeafened': 'Quem está ensurdecido continua acumulando tempo.',
  'voice.minSessionSec': 'Tempo mínimo em call, em segundos, para a sessão valer algum ponto.',
  'voice.maxSessionHours': 'Duração máxima de uma sessão contínua. Passou disso, uma nova sessão é aberta.',

  // monitoria
  'monitor.minPresencePct': 'Presença mínima do monitorado durante a monitoria para ela poder ser aprovada.',
  'monitor.requireAllCriteria': 'Exige marcar todos os critérios antes de aprovar.',
  'monitor.allowSelf': 'Permite que o monitor monitore a si mesmo. Normalmente fica desligado.',
  'monitor.maxPerTargetPerDay': 'Máximo de bônus de monitoria por membro por dia. 0 = sem limite.',
  'monitor.maxPerMonitorPerDay': 'Máximo de aprovações que um monitor faz por dia. 0 = sem limite.',
  'monitor.criteria': 'Lista de critérios que o monitor marca ao avaliar. Um por linha, até 25.',
  'monitor.types': 'Tipos de monitoria e o bônus de cada um. Uma linha por tipo: chave|Nome|bônus.',

  // ranking
  'ranking.enabled': 'Liga ou desliga o ranking inteiro.',
  'ranking.auto': 'O bot atualiza a mensagem do ranking sozinho.',
  'ranking.intervalMin': 'De quantos em quantos minutos o ranking é atualizado.',
  'ranking.topSize': 'Quantas posições o ranking mostra, até 100.',
  'ranking.pageSize': 'Quantas posições aparecem por página (botões ◀ ▶).',
  'ranking.sortBy': 'Critério que define a ordem do ranking.',
};
