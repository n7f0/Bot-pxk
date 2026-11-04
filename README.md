# PXK Bot

Bot Discord, comandos oficiais e painel administrativo.

## Requisitos

- Node.js 20 ou superior
- MongoDB acessível pela URI `DATABASE_URL`
- Aplicação Discord com bot e OAuth2 habilitados
- Volume persistente em `/app/data` para backups

## Configuração

1. Configure no Portainer as variáveis Discord, OAuth2, IDs dos servidores, `DATABASE_URL`, `BASE_URL` e `PANEL_SECRET`.
2. No Discord Developer Portal, adicione `BASE_URL/callback` como Redirect URI do OAuth2.
3. Defina `PANEL_SECRET` com uma chave aleatória forte de pelo menos 32 caracteres.
4. Configure `OWNER_IDS` e/ou `DEV_IDS` com os IDs autorizados a abrir o dashboard.

Não coloque tokens ou senhas no GitHub nem em mensagens. Cadastre-os apenas como variáveis/segredos no Portainer.

## Banco de dados

O MongoDB é o único banco operacional. Na inicialização, o sistema conecta ao MongoDB, cria/valida os modelos e índices, inicializa as coleções vazias necessárias e carrega os serviços.

**Os bancos SQLite antigos (`bot.db` e `pxk-features.sqlite`) não são lidos, importados ou migrados.** A instalação começa sem os registros antigos. Os arquivos antigos podem ser removidos do volume `/app/data) depois que a nova versão estiver validada e funcionando; eles não são necessários para o novo sistema.

## Backups

- Backups automáticos do MongoDB são exportados em Extended JSON para `/app/data/backups/`.
- `MONGODB_BACKUP_INTERVAL_MS` define o intervalo (mínimo de uma hora).
- `MONGODB_BACKUP_RETENTION` define quantos backups manter.
- O volume `/app/data` deve ser persistente no Portainer. O MongoDB também precisa ter seu próprio volume persistente.

## Execução e verificações

```bash
npm install
npm test
npm start
```

O dashboard usa a porta definida em `PORT` (padrão 8080); `/healthz` informa o estado da conexão MongoDB. `npm test` verifica sintaxe/imports e regras de arquitetura estática; isso não substitui um start real com MongoDB e credenciais Discord.

## Comandos

`npm run deploy` registra os comandos legados e oficiais em uma única lista por servidor.
