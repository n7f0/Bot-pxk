# PXK Bot

Bot Discord e painel administrativo do PXK.

## Requisitos

- Node.js 20 ou superior
- MongoDB (URI em \`DATABASE_URL\`)
- Aplicação Discord com bot e OAuth2 habilitados
- Permissão de leitura/escrita no diretório \`data/\`

## Configuração

1. Copie \`.env.example\` para \`.env\`.
2. Preencha \`DISCORD_TOKEN\`, \`CLIENT_ID\`, os IDs dos servidores e \`DATABASE_URL\`.
3. No Discord Developer Portal, adicione \`BASE_URL/callback\` como Redirect URI do OAuth2.
4. Preencha \`DISCORD_CLIENT_ID\` e \`DISCORD_CLIENT_SECRET\`.
5. Configure \`OWNER_IDS\` e/ou \`DEV_IDS\` com os IDs Discord autorizados a abrir o dashboard.
6. Defina \`PANEL_SECRET\` com uma chave aleatória forte (pelo menos 32 caracteres). Uma opção é gerar com \`openssl rand -hex 32\`.

O dashboard só libera as rotas administrativas para as contas listadas em \`OWNER_IDS\` ou \`DEV_IDS\`. Não exponha o serviço sem HTTPS em produção.

## Execução

\`\`\`bash
npm install
npm test
npm start
\`\`\`

O painel fica disponível na porta definida em \`PORT\` (padrão 8080). O endpoint \`/healthz\` informa o estado da conexão MongoDB.

## Dados e backups

- O MongoDB guarda os dados dos módulos legados e as sessões do dashboard.
- O SQLite oficial fica em \`DB_PATH\` (padrão \`data/pxk-features.sqlite\`).
- Backups automáticos do SQLite são gravados em \`data/backups/\`.
- \`SQLITE_BACKUP_INTERVAL_MS\` define o intervalo (mínimo de uma hora).
- \`SQLITE_BACKUP_RETENTION\` define quantos backups manter.
- Em Docker, monte um volume persistente em \`/app/data\`. Sem volume persistente, o banco SQLite e os backups podem ser perdidos quando o container for removido.

## Comandos

\`npm run deploy\` registra os comandos legados e oficiais em uma única lista por servidor.

\`npm test\` executa verificações estáticas de sintaxe JavaScript e imports relativos. Não substitui testes de integração com Discord, MongoDB ou SQLite.

## Observações de migração

O projeto mantém módulos legados em MongoDB e módulos oficiais em SQLite. Os dados ainda não foram unificados automaticamente. Não apague nem migre coleções/tabelas sem um plano de migração e backup validado.
