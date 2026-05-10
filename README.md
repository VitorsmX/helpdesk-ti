# Helpdesk TI - Prefeitura Municipal de Capanema

Sistema web para gestão de suporte técnico da Secretaria Municipal de Saúde de Capanema-PA. O Helpdesk TI centraliza abertura de chamados, fila técnica, SLA, inventário de hardware, estoque de insumos, relatórios, auditoria e notificações do navegador.

Desenvolvedor: [Vitor Sousa Mesquita](https://github.com/VitorsmX)

## Funcionalidades

- Chamados por perfil: `REQUESTER`, `COORDINATOR`, `TECH` e `ADMIN`.
- Abertura de chamados com unidade, setor, sala, categoria, prioridade automática e anexos.
- Atendimento técnico com comentários públicos/internos, atribuição, status, resolução e consumo de insumos.
- SLA de resposta e resolução com monitoramento de vencimentos e atrasos.
- Cadastro de unidades, setores, salas, categorias, usuários e regras operacionais.
- Inventário de hardware por patrimônio, unidade, setor, sala e status.
- Controle de insumos com estoque mínimo e baixa automática em chamados.
- Relatórios gerenciais com exportação CSV, Excel e PDF.
- Logs de auditoria para operações administrativas e técnicas.
- Recuperação e troca de senha com tokens temporários, quando SMTP estiver habilitado.
- Notificações do navegador por perfil, ativadas ou desativadas pelo usuário no frontend.
- Proteções de produção: CSRF, Helmet/CSP, rate limit, cookies `httpOnly`, validação de upload, logs estruturados e assets minificados.

## Perfis e operação

- `REQUESTER`: abre chamados, acompanha os próprios chamados e recebe notificações de respostas/status.
- `COORDINATOR`: acompanha chamados da própria unidade, acessa relatórios restritos e recebe alertas da unidade.
- `TECH`: atende fila TI, atualiza chamados, usa insumos, consulta inventário e recebe alertas de fila/SLA.
- `ADMIN`: gerencia cadastros, configurações, relatórios, auditoria, estoque, inventário e alertas críticos.

Fluxo recomendado:

1. Solicitante abre o chamado em `/tickets/new`.
2. Técnico acompanha a fila em `/tech/tickets`.
3. Atendimento registra mensagens, anexos, prioridade, status e resolução.
4. Administrador monitora SLA, estoque, auditoria, equipamentos condenados e relatórios.

## Arquitetura

- Runtime: Node.js + Express.
- Views: EJS com `express-ejs-layouts`.
- Banco: Prisma ORM com MySQL em produção.
- Sessão: `express-session`, com store em memória para desenvolvimento ou MySQL para produção.
- Segurança HTTP: Helmet, CSP com nonce, CSRF, rate limit e cookies seguros.
- Assets: arquivos fonte em `public/` e minificados em `public/dist/`.
- Uploads: anexos e assets do sistema em diretórios configuráveis.
- Relatórios: serviços dedicados em `src/services/reporting.service.js` e `reportExport.service.js`.
- Notificações: eventos derivados do banco em `src/services/notification.service.js`, expostos por `/notifications/events` e exibidos pelo navegador em `public/notifications.js`.

Estrutura principal:

```text
src/
  app.js                 # cria Express, middlewares, rotas e handlers de erro
  server.js              # bootstrap HTTP e shutdown gracioso
  config/session.js      # configuração de sessão/cookies/store
  middleware/            # auth, csrf, auditoria, upload, rate limit, monitoramento
  routes/                # rotas por área funcional
  services/              # regras de relatório, exportação, senha, settings e notificações
  utils/                 # validação, segurança, SLA, logs e helpers de view
  views/                 # templates EJS
public/
  app.css                # design system
  app-shell.js           # navegação AJAX progressiva
  notifications.js       # permissão e notificações do navegador
  dist/                  # assets minificados
prisma/
  schema.prisma
  migrations/
  seed.js
tests/
  unit/
```

## Variáveis de ambiente

Copie `.env.example` para `.env` no desenvolvimento e preencha os valores do ambiente.

### Desenvolvimento

Valores comuns:

```env
NODE_ENV=development
DATABASE_URL="mysql://helpdesk_user:senha@localhost:3306/helpdesk"
PORT=3000
SESSION_SECRET="chave-local-com-32-ou-mais-caracteres"
SESSION_STORE=
COOKIE_SECURE=false
TRUST_PROXY=false
PUBLIC_BASE_URL="http://localhost:3000"
SMTP_ENABLED=false
```

Comandos:

```bash
npm install
npm run prisma:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Acesse `http://localhost:3000`.

### Produção

Valores essenciais:

```env
NODE_ENV=production
DATABASE_URL="mysql://usuario:senha-forte@host:3306/helpdesk"
PORT=3000
SESSION_SECRET="gere-uma-chave-com-32-ou-mais-caracteres"
SESSION_STORE=mysql
SESSION_MAX_AGE_MS=28800000
COOKIE_SECURE=true
SESSION_SAME_SITE=lax
TRUST_PROXY=true
TRUST_PROXY_HOPS=1
PUBLIC_BASE_URL="https://helpdesk.seu-dominio.gov.br"
UPLOAD_DIR="/var/helpdesk/uploads"
SYSTEM_ASSET_DIR="/var/helpdesk/uploads/system"
LOG_LEVEL=info
LOG_TO_STDOUT=true
SMTP_ENABLED=true
SMTP_HOST="smtp.seu-dominio.gov.br"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="usuario-smtp"
SMTP_PASS="senha-smtp"
SMTP_FROM="Helpdesk TI <helpdesk@seu-dominio.gov.br>"
```

Boas práticas:

- Use HTTPS no proxy reverso e `COOKIE_SECURE=true`.
- Configure `TRUST_PROXY=true` apenas atrás de proxy confiável.
- Use senha forte para `SESSION_SECRET`, usuário MySQL dedicado e backups automáticos.
- Mantenha `UPLOAD_DIR` e `SYSTEM_ASSET_DIR` fora do repositório.
- Rode `npm run build` antes de publicar.
- Execute migrations com `npm run db:deploy`.
- Use `npm start` ou `npm run start:prod` com gerenciador de processo, container ou serviço do sistema.

## Build e deploy

Build de aplicação:

```bash
npm run build
```

O build executa `prisma generate` e minifica CSS/JS em `public/dist/`.

Deploy de banco:

```bash
npm run db:deploy
npm run db:seed
```

Início em produção:

```bash
npm start
```

Ou:

```bash
npm run start:prod
```

## Docker

O projeto possui `Dockerfile`, `docker-compose.yml` e `.env.docker.example` para publicação com MySQL em container. O Compose constrói a imagem local da aplicação, sobe o banco `db`, aguarda o MySQL ficar saudável, aplica `prisma migrate deploy` automaticamente e inicia o servidor em `NODE_ENV=production`.

Pontos importantes:

- Use `.env.docker`, não o `.env` de desenvolvimento, para evitar `DATABASE_URL` apontando para `localhost` dentro do container.
- No Docker, o host do banco é `db`; o Compose monta `DATABASE_URL` como `mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@db:3306/${MYSQL_DATABASE}`.
- `APP_PORT` é a porta publicada no host. Dentro do container a aplicação sempre escuta a porta `3000`.
- `RUN_MIGRATIONS=true` aplica migrations ao subir. Para executar o seed inicial, defina `SEED_ADMIN_PASSWORD` e use `docker compose exec app npm run db:seed` ou suba uma vez com `RUN_SEED=true`.
- Em produção com HTTPS/proxy reverso, configure `COOKIE_SECURE=true`, `TRUST_PROXY=true` e `PUBLIC_BASE_URL` com a URL pública do sistema.
- Para teste local sem HTTPS, use `COOKIE_SECURE=false`, senão o navegador pode não gravar o cookie de sessão.

### Docker no Windows

Pré-requisitos:

- Docker Desktop instalado.
- Docker Desktop aberto e com o engine Linux ativo.
- Terminal PowerShell aberto na pasta `helpdesk-ti`.

Preparar variáveis:

```powershell
Copy-Item .env.docker.example .env.docker
notepad .env.docker
```

Edite pelo menos `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `SESSION_SECRET`, `SEED_ADMIN_PASSWORD`, `PUBLIC_BASE_URL`, `COOKIE_SECURE` e `APP_PORT`.

Subir em produção local:

```powershell
docker compose --env-file .env.docker config
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f app
```

Criar dados iniciais após o primeiro boot:

```powershell
docker compose --env-file .env.docker exec app npm run db:seed
```

Acesse `http://localhost:3000` ou a porta definida em `APP_PORT`.

Atualizar a aplicação após mudanças no código:

```powershell
docker compose --env-file .env.docker up -d --build app
```

Parar sem apagar dados:

```bash
docker compose --env-file .env.docker down
```

### Docker no Linux

Pré-requisitos:

- Docker Engine e plugin Docker Compose instalados.
- Usuário com permissão para executar Docker, ou uso de `sudo`.
- Terminal aberto na pasta `helpdesk-ti`.

Preparar variáveis:

```bash
cp .env.docker.example .env.docker
nano .env.docker
```

Edite as mesmas variáveis do fluxo Windows: `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `SESSION_SECRET`, `SEED_ADMIN_PASSWORD`, `PUBLIC_BASE_URL`, `COOKIE_SECURE` e `APP_PORT`.

Subir em produção:

```bash
docker compose --env-file .env.docker config
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f app
```

Se o seu usuário não estiver no grupo `docker`, prefixe os comandos com `sudo`.

Criar dados iniciais após o primeiro boot:

```bash
docker compose --env-file .env.docker exec app npm run db:seed
```

Atualizar a aplicação:

```bash
docker compose --env-file .env.docker up -d --build app
```

Parar sem apagar volumes:

```bash
docker compose --env-file .env.docker down
```

Apagar containers e volumes, incluindo banco, uploads e logs:

```bash
docker compose --env-file .env.docker down -v
```

## Notificações

As notificações usam a API nativa do navegador. O usuário ativa pelo botão `Notificações` no menu lateral e também precisa permitir no próprio Chrome, Edge ou Firefox.

Eventos por perfil:

- `REQUESTER`: respostas e mudanças de status nos próprios chamados.
- `COORDINATOR`: novos chamados e movimentações públicas da unidade.
- `TECH`: novos chamados na fila, mensagens em chamados atribuídos e SLA próximo do vencimento.
- `ADMIN`: SLA estourado, chamados urgentes, estoque crítico, aguardando peças e equipamentos sem reparo.

Observação: a aparência final da notificação do Windows depende do navegador e do sistema operacional. O sistema personaliza título, texto, prioridade, ícone, persistência e ação de clique.

## Testes e qualidade

```bash
npm test
npm run build
```

Os testes cobrem validação de segurança, resiliência, exportação, relatórios e notificações. Para uma homologação completa, também valide manualmente:

- login e logout;
- abertura de chamado;
- atendimento técnico;
- mudança de status e resolução;
- upload/download de anexos;
- relatórios e exportações;
- permissões por perfil;
- notificações em navegador com permissão concedida e negada.

## Checklist de produção

- `.env` revisado e sem senhas fracas.
- `NODE_ENV=production`.
- `SESSION_SECRET` forte.
- `COOKIE_SECURE=true` com HTTPS.
- MySQL com usuário dedicado, backup e migrations aplicadas.
- SMTP testado se recuperação de senha estiver ativa.
- Diretórios de upload persistentes, com permissão restrita.
- Logs enviados para arquivo, stdout do container ou coletor central.
- `npm test` e `npm run build` executados sem erro.
- Primeiro admin criado via seed e senha alterada após o primeiro acesso.

## Scripts

- `npm run dev`: inicia servidor local.
- `npm start`: inicia servidor.
- `npm run start:prod`: validações básicas e início para produção.
- `npm run build`: Prisma generate e assets minificados.
- `npm run build:legacy`: assets compatíveis com navegadores antigos.
- `npm run db:migrate`: cria migration em desenvolvimento.
- `npm run db:deploy`: aplica migrations existentes.
- `npm run db:seed`: cria dados iniciais.
- `npm test`: executa testes unitários.
