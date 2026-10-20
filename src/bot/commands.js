const { SlashCommandBuilder } = require('discord.js');

const ordens = [
  { name: 'Cristais', value: 'crystals' },
  { name: 'Horas em call', value: 'hours' },
  { name: 'MOVs concluídos', value: 'movs' },
  { name: 'Bônus de monitoria', value: 'monitor' },
  { name: 'Metas concluídas', value: 'goals' },
];

const pontosSub = (name, desc, qtyDesc) => (sub) => {
  sub
    .setName(name)
    .setDescription(desc)
    .addUserOption((o) => o.setName('usuario').setDescription('Membro').setRequired(true));
  if (qtyDesc) {
    sub.addNumberOption((o) =>
      o.setName('quantidade').setDescription(qtyDesc).setRequired(true).setMinValue(0).setMaxValue(1_000_000),
    );
    sub.addStringOption((o) =>
      o.setName('motivo').setDescription('Motivo (fica registrado)').setRequired(true).setMaxLength(200),
    );
  }
  return sub;
};

module.exports = [
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Abre o painel administrativo da Mov Call')
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Consulta o ranking de cristais ou as estatísticas de um membro')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('usuario').setDescription('Ver as estatísticas de um membro'))
    .addStringOption((o) =>
      o
        .setName('ordem')
        .setDescription('Critério de ordenação')
        .addChoices(...ordens),
    )
    .addIntegerOption((o) => o.setName('temporada').setDescription('Número da temporada (padrão: atual)').setMinValue(1))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('atividade')
    .setDescription('Histórico de tempo e sessões em call')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('usuario').setDescription('Membro (somente liderança)'))
    .addIntegerOption((o) => o.setName('dias').setDescription('Período em dias (padrão 7)').setMinValue(1).setMaxValue(90))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('movcall')
    .setDescription('Informações e estatísticas da Mov Call')
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('metas')
    .setDescription('Consulta as metas e o seu progresso')
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('monitoria')
    .setDescription('Ferramentas de monitoria (usuários autorizados)')
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('pontos')
    .setDescription('Consulta ou ajusta os cristais de um membro')
    .setDMPermission(false)
    .addSubcommand(pontosSub('consultar', 'Mostra os cristais de um membro'))
    .addSubcommand(pontosSub('adicionar', 'Adiciona cristais', 'Quantidade a adicionar'))
    .addSubcommand(pontosSub('remover', 'Remove cristais', 'Quantidade a remover'))
    .addSubcommand(pontosSub('definir', 'Define o total de cristais da temporada', 'Novo total'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('relatorio')
    .setDescription('Gera um relatório de atividade (liderança)')
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName('periodo')
        .setDescription('Período do relatório')
        .addChoices(
          { name: 'Hoje', value: 'hoje' },
          { name: 'Últimos 7 dias', value: '7d' },
          { name: 'Últimos 30 dias', value: '30d' },
          { name: 'Temporada atual', value: 'temporada' },
        ),
    )
    .addUserOption((o) => o.setName('usuario').setDescription('Filtrar por membro'))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('mov')
    .setDescription('Consulta os MOVs oficiais e seus horários')
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('iniciarmov')
    .setDescription('Inicia a sua MOV Call (você precisa estar em uma call autorizada)')
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('pararlista')
    .setDescription('Para a Lista de MOV em andamento e envia para a análise da gestão')
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName('acao')
        .setDescription('O que fazer (padrão: parar e enviar para análise)')
        .addChoices(
          { name: 'Parar e enviar para análise da gestão', value: 'parar' },
          { name: 'Cancelar (ninguém é pontuado)', value: 'cancelar' },
        ),
    )
    .addStringOption((o) =>
      o.setName('lista').setDescription('ID da lista (ex.: A1B2C3) - só se houver mais de uma em andamento').setMaxLength(10),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('movhistorico')
    .setDescription('Histórico das MOVs Call de um membro')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('usuario').setDescription('Membro (somente liderança)'))
    .toJSON(),
];
