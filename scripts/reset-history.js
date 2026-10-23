require('dotenv').config();
const mongoose = require('mongoose');
const pxk = require('../src/bot/db');
const recruitment = require('../src/txtmod/db');

const MODELS_TO_RESET = [
  pxk.MemberStat, pxk.PointTx, pxk.VoiceSession, pxk.MovEvent, pxk.MovOccurrence,
  pxk.MovParticipation, pxk.MonitorSession, pxk.UserMov, pxk.MovMonitoria,
  pxk.MovLista, pxk.GoalCompletion, pxk.Season, pxk.AuditLog,
  recruitment.UserStat, recruitment.Ticket, recruitment.Recruitment,
  recruitment.Shift, recruitment.LogEntry, recruitment.Counter, recruitment.AdminLog,
];

(async () => {
  if (process.env.RESET_PXK_HISTORY !== 'YES') {
    console.error('Ação bloqueada. Defina RESET_PXK_HISTORY=YES para confirmar a exclusão do histórico.');
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definido no .env');
  await mongoose.connect(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 15000 });
  try {
    for (const model of MODELS_TO_RESET) {
      if (!model) continue;
      const result = await model.deleteMany({});
      console.log(`[reset] ${model.modelName}: ${result.deletedCount ?? 0} registro(s) removido(s)`);
    }
    console.log('Histórico apagado. Configurações dos módulos foram preservadas. Reinicie o bot para criar as temporadas novas.');
  } finally {
    await mongoose.disconnect();
  }
})().catch((err) => {
  console.error('Falha ao limpar histórico:', err.message);
  process.exitCode = 1;
});
