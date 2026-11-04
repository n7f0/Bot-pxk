# PXK Bot

Bot Discord, comandos oficiais e painel administrativo.

## Requisitos

- Node.js 20 ou superior
- MongoDB acessível pela URI `DATABASE_URL`
- Aplicação Discord com bot e OAuth2 habilitados
- Volume persistente em `/app/data` durante a migração inicial

## Configuração

1. Configure no Portainer as variáveis Discord, OAuth2, IDs dos servidores, `DATABASE_URL`, `BASE_URL` e `PANEL_SECRET`.
2. No Discord Developer Portal, adicione `BASE_URL/callback` como Redirect URI do OAuth2.
3. Defina `PANEL_SECRET` com uma chave aleatória forte de pelo menos 32 caracteres.
4. Configure `OWNER_IDS` e/ou `DEV_IDS` com os IDs autorizados a abrir o dashboard.
5. Mantenha o volume persistente antigo montado em `/app/data`. O arquivo padrão legado é `/app/data/pxk-features.sqlite`. Caso ele estivesse em outro local, configure `DB_PATH` para o caminho dentro do container.

Não coloque tokens ou senhas no GitHub nem em mensagens. Cadastre-os apenas como variáveis/segredos no Portainer.

## Banco único e migração automática

O MongoDB é o banco operacional único. Os módulos legados continuam usando suas coleções MongoDB; os antigos módulos oficiais agora também usam coleções MongoDB com o prefixo `pxk_feature_`.

No primeiro start desta versão, antes de iniciar o dashboard e o bot, o processo:

1. conecta ao MongoDB e cria/valida os índices;
2. lê o SQLite legado em `DB_PATH`;
3. cria uma cópia integral SQLite em `/app/data/backups/pxk-pre-mongodb-migration-*.sqlite`;
4. importa usuários, temporadas, placares, histórico de pontos, sessões e mensagens de bate-ponto, permissões, regras de cargos, rankings arquivados, logs e configurações;
5. mantém os IDs e as relações originais;
6. verifica as quantidades importadas e só grava o marcador de migração concluída depois das verificações;
7. carrega o repositório MongoDB, recupera eventuais lançamentos pendentes e somente então inicializa dashboard e bot.

A migração usa upserts idempotentes. Se falhar antes da conclusão, a inicialização para e uma nova tentativa pode retomar sem apagar o SQLite. O arquivo de origem **não é apagado nem alterado**. Não remova o volume antigo nem o backup até verificar os dados no bot e guardar uma cópia externa.

**Proteção contra banco vazio:** se a migração ainda não foi concluída e o SQLite não estiver no caminho informado, o container para antes de ligar o bot. Isso evita iniciar silenciosamente com placares/configurações vazios. Apenas uma instalação genuinamente nova, sem dados SQLite anteriores, deve definir `ALLOW_EMPTY_FEATURE_DB=true`.

Depois da migração, operações de pontuação e histórico, temporadas, ranking, bate-ponto, permissões, cargos e logs gravam no MongoDB. O histórico de pontuação fica em documentos individuais para não crescer sem limite dentro de um único documento.

## Backups

- Backups automáticos do MongoDB são exportados em Extended JSON para `/app/data/backups/`.
- `MONGODB_BACKUP_INTERVAL_MS` define o intervalo (mínimo de uma hora).
- `MONGODB_BACKUP_RETENTION` define quantos backups manter.
- O backup SQLite pré-migração é uma cópia integral de segurança adicional.

O volume `/app/data` deve ser persistente no Portainer. O MongoDB também precisa ter seu próprio volume persistente.

## Execução e verificações

```bash
npm install
npm test
npm start
```

O dashboard usa a porta definida em `PORT` (padrão 8080); `/healthz` informa o estado da conexão MongoDB. `npm test` verifica sintaxe/imports e regras de arquitetura estática; isso não substitui um start real com MongoDB, SQLite legado e credenciais Discord.

## Comandos

`npm run deploy` registra os comandos legados e oficiais em uma única lista por servidor.
