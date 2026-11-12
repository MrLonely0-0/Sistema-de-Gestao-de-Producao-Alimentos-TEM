# Alimentos TEM · Gestão de Produção e Logística

Painel Kanban para o chão de fábrica: **Produção → Qualidade → Acabamento → Estoque e Logística**, com perfis de acesso, cadastro dinâmico de produtos/embalagens e pasta (simulada) no Google Drive por batelada.

Stack: **Next.js (React, App Router) + Tailwind CSS + rotas Node.js + PostgreSQL via Drizzle ORM**. O banco é Postgres puro — roda em Neon, Supabase ou qualquer outro.

---

## 1. Como o fluxo funciona

Cada card fica **na coluna de quem precisa agir sobre ele**:

| Coluna | Status do card | Quem age | O que faz |
| --- | --- | --- | --- |
| 01 Produção | `Em preparo` | Operador de Produção | Abre a batelada, preenche lotes, horários e unidades; marca **Pronto** |
| 02 Qualidade | `Pronto`, `Retido` | Inspetor de Qualidade | **Libera** (carimbo imutável), **Retém** ou **Devolve** à Produção (com motivo) |
| 03 Acabamento | `Liberado` | Operador de Acabamento | Escolhe de 1 a 3 embalagens e digita as caixas produzidas |
| 04 Estoque e Logística | `Em estoque` | Logística | Vê o saldo consolidado e **separa pedidos** |

### Login que funciona em qualquer ambiente

Sessão por **token**, sem depender de cookie. O token é guardado em camadas, da mais durável à mais efêmera, e enviado em três canais simultâneos:

| Guardado em | Serve para |
| --- | --- |
| `localStorage` / `sessionStorage` | Abas novas e próximas visitas |
| `window.name` | Recarregar e navegar na mesma aba mesmo com armazenamento bloqueado |
| `#t=` na URL (só quando todo o resto está bloqueado) | Primeira carga depois do login |

| Enviado em | Serve para |
| --- | --- |
| `Authorization: Bearer` | Caminho padrão |
| `x-tem-session` | Proxies que preservam cabeçalhos customizados |
| `?t=` na URL da API | Último recurso: nenhum proxy remove a query string |

O cookie httpOnly continua existindo como caminho adicional; em HTTPS ele sai como `Partitioned; SameSite=None; Secure` e sobrevive dentro de iframes (CHIPS). O banco guarda apenas o SHA-256 do token. A resposta inclui `Referrer-Policy: same-origin` para o token da URL não vazar em links externos.

A escrita na API aceita como prova de origem `Origin`/`Referer` do mesmo host, `Sec-Fetch-Site`, o cabeçalho `x-tem-client` ou corpo JSON — o que mantém a proteção contra CSRF sem depender de um único sinal que proxies podem remover.

Regras que o servidor garante (não só a tela):

- **Última alteração registrada em cada card** (nome, perfil de acesso e data/hora) e histórico por evento com o perfil de quem agiu. Na gaveta, o usuário vê também o seu último registro naquela batelada.
- **Numeração sequencial por item** (`#1`, `#2`… por marca + formato), gerada com incremento atômico no banco — duas bateladas simultâneas nunca recebem o mesmo número.
- **Pronto** só com todos os dados: 2 lotes, 6 horários (fim ≥ início) e unidades boas/perdas.
- **Carimbo de liberação**: gravado com o relógio do banco, uma única vez. Um *trigger* no Postgres rejeita qualquer alteração posterior, inclusive via SQL direto.
- **Caixas**: a soma (caixas × unidades por caixa) não pode passar das unidades boas.
- **Separação**: não deixa retirar mais caixas do que o saldo, mesmo com duas pessoas separando ao mesmo tempo.
- Todos veem o painel inteiro; cada perfil só **age** na sua etapa. Todo card tem histórico de quem fez o quê e quando.

No computador dá para **arrastar o card** para a coluna seguinte; em tablet/celular (onde arrastar não funciona bem) as mesmas ações estão nos botões do card.

## 1.1 Relatórios, classificações e exclusões

- **Relatórios** (`/relatorios`, link na barra superior): filtros por período, marca, produto e status; indicadores de produção, perdas, rendimento, caixas, liberações e tempo médio de liberação; gráfico de produção diária; tabelas de produção por produto, saldo, qualidade e expedições. Exportação em **CSV** (separador `;`, BOM UTF-8, pronto para Excel pt-BR) e **JSON** para 5 conjuntos de dados + relatório completo. Os arquivos respeitam os filtros; a opção "Incluir excluídos" traz a auditoria.
- **Classificações dinâmicas** (Admin › Produtos e classificações): Marca, Família, Grupo e qualquer novo "tipo de separação" criado pelo gestor. Cada um tem valores com **adicionar, editar, excluir e desativar**; os produtos podem ser filtrados e agrupados por qualquer dimensão. Renomear uma marca propaga para os produtos e para as bateladas antigas. A dimensão Marca é essencial (alimenta as etiquetas) e não pode ser excluída.
- **Produtos e bateladas podem ser excluídos pelo admin** (editar produto, excluir produto, excluir batelada na gaveta). A exclusão é **lógica**: o registro sai do painel, mas caixas, expedições, carimbos e histórico permanecem para não quebrar o saldo nem a rastreabilidade. Produtos com bateladas em andamento são protegidos; valores em uso por produtos também.

## 1.2 Gestão de estoque, painéis e alteração em massa

- **Gestão de estoque** (`/estoque`): saldo por embalagem (produzido + ajustes − expedido), lançamento de **ajustes** de entrada/baixa com motivo, e **editar/excluir** ajustes e expedições. Toda operação valida o saldo para não ficar negativo; a exclusão do ajuste é lógica (motivo fica para auditoria) e a da expedição devolve as caixas ao saldo. Permissão: Logística e Admin, e depende da funcionalidade "separar" estar ligada.
- **Painéis do quadro** (Admin › Painéis do quadro): **adicionar, editar, excluir, ativar/desativar e reordenar** colunas do Kanban; escolher nome, subtítulo, cor, perfil responsável, quais status aparecem e quais **funcionalidades** ficam habilitadas (abrir, editar, liberar, reter, devolver, finalizar, separar, anexar, excluir) e onde o saldo de estoque aparece. Desligar uma funcionalidade bloqueia a ação **também na API**. Um status não pode estar em dois painéis e precisa sempre pertencer a algum painel ativo.
- **Alteração em massa** (Admin › Produtos e classificações): marque produtos individualmente ou "Selecionar todos" e altere marca, família, grupo e outras separações de uma vez, mantendo as demais. Trocar a marca propaga para as bateladas antigas.
- **Família → produtos e gramaturas**: ao filtrar por família (ou outra separação), aparece uma tabela com as gramaturas encontradas e, para cada produto, marca, classificações, próxima batelada e embalagens.

## 1.3 Links de acesso à pré-visualização

Cada execução de deploy gera um **novo endereço** (`https://3000-<id-do-sandbox>.e2b.app`). Endereços de execuções anteriores são **snapshots congelados**: continuam respondendo, mas não recebem nenhuma alteração nova — é por isso que um link antigo parece "quebrado" (por exemplo, `/estoque` retorna 404 nele).

Regras práticas:

1. Use sempre o link de **Preview exibido pela plataforma na resposta mais recente**, não um endereço copiado de uma mensagem anterior.
2. O domínio oficial do sandbox é protegido: exige o cabeçalho `e2b-traffic-access-token`, que a interface da plataforma injeta automaticamente. Abrir o endereço "cru" (colando no navegador, via `curl` ou incorporando em outro site) retorna `403` com a mensagem `Sandbox is secured with traffic access token` — isso **não** é erro da aplicação.
3. Para confirmar que você está no build atual, abra **`/api/version`**. Deve retornar um JSON com `version`, `modules` e `serverTime`. Se der `404`, você está num snapshot antigo; se der `403`, abra pelo botão de Preview da plataforma.
4. Dentro do app, a versão atual tem 4 itens na barra superior (Painel, Relatórios, Estoque, Admin) e a aba **Painéis do quadro** no Admin.

O healthcheck (`/api/health`) continua retornando `{"ok":true}` para a plataforma.

### Se aparecer "Missing traffic access token"

O sandbox foi criado com `allowPublicTraffic: false`: **todas** as portas exigem o cabeçalho `e2b-traffic-access-token`. Esse token é emitido apenas pela API de criação/conexão do sandbox (64 caracteres hexadecimais) e **não existe dentro do sandbox** — nem em variáveis de ambiente, nem no daemon `envd`. Por isso não é possível desabilitá-lo ou lê-lo a partir do código da aplicação; é a interface da plataforma que precisa injetá-lo.

Ordem de tentativa:

1. Abra pelo **botão/link de Preview da plataforma**, não colando o endereço manualmente e não incorporando em iframe de outro site.
2. Reinicie a pré-visualização (um novo `build_and_start` chama `connect` e reemite o token).
3. Plano B imediato, sem conta e sem custo — túnel direto para a porta 3000, que não passa pelo proxy protegido:

   ```bash
   curl -L -o /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
   chmod +x /tmp/cloudflared
   /tmp/cloudflared tunnel --url http://localhost:3000 --no-autoupdate
   ```

   O comando imprime uma URL `https://<nome>.trycloudflare.com`. É pública e não pede o cabeçalho, mas é **temporária** (sem garantia de uptime e morre se o sandbox reiniciar).
4. Solução definitiva: o deploy na Vercel + Neon da seção 4 gera uma URL pública permanente, sem token de sandbox.

## 2. Estrutura do código

```
src/
├─ db/
│  ├─ schema.ts            Tabelas (Drizzle): users, sessions, products, packaging_options,
│  │                       batches, batch_outputs, shipments, attachments, batch_events
│  └─ index.ts             Conexão (lê DATABASE_URL)
├─ lib/
│  ├─ admin-service.ts      CRUD de produtos, dimensões e valores (classificações)
│  ├─ report-export.ts      Geração de CSV/JSON para exportação
│  ├─ domain.ts            Regras compartilhadas servidor/navegador: perfis, status,
│  │                       matriz de permissões, checklist do "Pronto", tipos da API
│  ├─ batch-service.ts     Regras de negócio: criar, editar, transições, caixas, anexos, separação
│  ├─ queries.ts           Leituras: painel, detalhe da batelada, saldo, visão do admin
│  ├─ auth.ts              Senhas (scrypt) e sessões (cookie httpOnly; só o hash fica no banco)
│  ├─ api.ts               Wrapper das rotas: erros uniformes, checagem de perfil, defesa CSRF
│  ├─ drive.ts             Integração Google Drive (simulada) atrás de uma interface única
│  ├─ seed.ts              Primeira execução: trigger do carimbo, catálogo e dados de demonstração
│  └─ client.ts            fetch + formatação pt-BR (só navegador)
├─ app/
│  ├─ login/               Tela de entrada
│  ├─ (app)/page.tsx       Painel Kanban          (exige sessão)
│  ├─ (app)/admin/         Painel Admin           (exige perfil admin)
│  └─ api/                 Rotas finas que delegam para lib/
│     ├─ auth/login · auth/logout
│     ├─ board                         GET  tudo que o painel precisa
│     ├─ batches                       POST cria batelada
│     ├─ batches/[id]                  GET detalhe · PATCH edita (só Em preparo)
│     ├─ batches/[id]/transition       POST marcar_pronto | liberar | reter | devolver | finalizar
│     ├─ batches/[id]/attachments      POST/DELETE links de laudos e fotos
│     ├─ shipments                     POST separação para expedição
│     └─ admin · admin/users · admin/products · admin/packaging
└─ components/
   ├─ board.tsx            Quadro, filtros, arrastar-e-soltar, atualização a cada 8 s
   ├─ batch-card.tsx       Card da batelada
   ├─ batch-form.tsx       Etapa 1 — formulário de produção
   ├─ batch-drawer.tsx     Detalhes: carimbo, horários, caixas, pasta do Drive, histórico
   ├─ dialogs.tsx          Liberar · Reter/Devolver · Compositor de caixas · Separar pedido
   ├─ stock-panel.tsx      Etapa 4 — saldo consolidado
   ├─ admin-panel.tsx      Abas: Produtos e classificações · Usuários · Drive
   ├─ products-tab.tsx     CRUD de produtos, marcas, famílias, grupos e dimensões
   ├─ reports-panel.tsx    Indicadores, gráficos, tabelas e exportação
   ├─ columns-tab.tsx      CRUD, ordem e funcionalidades dos painéis
   ├─ stock-manager.tsx    CRUD de ajustes e expedições
   └─ ui.tsx               Botão, campos, modal/gaveta, avisos, etiquetas
```

Para mudar **quem pode o quê**, edite `ACTION_ROLE` em `src/lib/domain.ts` — tela e servidor usam a mesma tabela.

## 3. Rodar no seu computador

Requisitos: Node 20+ e um PostgreSQL.

```bash
npm install
echo 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db' > .env
npx drizzle-kit push        # cria as tabelas
npm run dev                 # http://localhost:3000
```

Na primeira abertura o sistema garante a conta do gestor (`ADMIN_EMAIL` / `ADMIN_PASSWORD`), cadastra o catálogo (TEM e Feliz × 160 g, 450 g, 1 kg, 2 kg, 3 kg, com embalagens e classificações de exemplo) e, em modo demonstração, algumas bateladas de exemplo.

**A tela de login mostra apenas e-mail e senha** — não há contas de exemplo nem credenciais expostas. A conta do gestor é garantida a cada inicialização; a senha de uma conta existente **nunca** é sobrescrita. Troque a senha em **Admin › Usuários** e defina `ADMIN_EMAIL`/`ADMIN_PASSWORD` no provedor para o uso real. Os demais usuários são criados pelo gestor em **Admin › Usuários e perfis**.

## 4. Colocar na nuvem sem custo (passo a passo)

Combinação sugerida: **Neon** (Postgres) + **Vercel** (aplicação). Leva uns 15 minutos.

**Passo 1 — Código no GitHub.** Crie um repositório privado e envie este projeto (`git init`, `git add .`, `git commit`, `git push`). O arquivo `.env` não deve ir junto.

**Passo 2 — Banco no Neon.** Em [neon.tech](https://neon.tech), crie um projeto (região *AWS São Paulo*). Em *Connect*, marque **Pooled connection** e copie a string `postgresql://…-pooler…/neondb?sslmode=require`.

**Passo 3 — Criar as tabelas.** No seu computador, dentro da pasta do projeto:

```bash
npx drizzle-kit push --dialect=postgresql --schema=./src/db/schema.ts --url="COLE_A_STRING_AQUI"
```

**Passo 4 — Aplicação na Vercel.** Em [vercel.com](https://vercel.com) → *Add New → Project* → importe o repositório. Antes de clicar em *Deploy*, abra *Environment Variables* e adicione:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | a string do Neon (pooled) |
| `DEMO_MODE` | `off` — não cria usuários nem bateladas de demonstração |
| `ADMIN_EMAIL` | e-mail do primeiro administrador |
| `ADMIN_PASSWORD` | senha inicial (8+ caracteres) |
| `COOKIE_SAMESITE` | `lax` — modo mais restrito do cookie de sessão |

**Passo 5 — Primeiro acesso.** Abra a URL gerada, entre com `ADMIN_EMAIL`/`ADMIN_PASSWORD` e, em **Admin**, troque a senha do gestor, crie os usuários de cada posto e revise produtos e embalagens. Mantenha as duas variáveis configuradas na Vercel: se a conta do gestor for apagada, ela é recriada no próximo boot.

A cada `git push`, a Vercel publica a nova versão sozinha. Se mudar `schema.ts`, repita o Passo 3.

### O que "gratuito" significa na prática

Confira os limites vigentes de cada serviço antes de depender deles — eles mudam:

- **Vercel (plano Hobby)**: os termos restringem o plano gratuito a uso pessoal/não comercial. Serve bem para piloto e validação; para uso contínuo da empresa, considere o plano pago ou uma alternativa gratuita como o **Render** (*New → Web Service*, build `npm install && npm run build`, start `npm start`, mesmas variáveis). No Render gratuito o serviço "dorme" sem acesso e o primeiro carregamento depois disso demora.
- **Neon (plano Free)**: armazenamento e horas de computação mensais limitados, e o banco suspende quando ocioso (a primeira consulta depois demora cerca de um segundo). Um painel aberto o dia todo consulta o banco a cada 8 s e o mantém acordado; se isso consumir a cota, aumente `POLL_MS` em `src/components/board.tsx`.
- **Supabase** também funciona — é Postgres. Use a string do *pooler* em `DATABASE_URL`; se aparecer erro de certificado, acrescente `?sslmode=no-verify`. Projetos gratuitos são pausados após um período sem uso.

## 5. Variáveis de ambiente

| Variável | Obrigatória | Para quê |
| --- | --- | --- |
| `DATABASE_URL` | sim | Conexão PostgreSQL |
| `DEMO_MODE` | não (padrão: ligado) | `off` desliga apenas as bateladas de exemplo (nunca cria contas de demonstração; a tela de login não exibe credenciais) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | não | Conta do gestor. Padrão: `vinicius@tem.com.br` / `#Vini2183`. Criada se faltar e promovida a admin se existir — em todo boot |
| `COOKIE_SAMESITE` | não | `lax` restringe o cookie de sessão; sem ela, em HTTPS o cookie usa `SameSite=None` para sobreviver em iframes. O token do navegador funciona nos dois casos |

## 6. Google Drive: do simulado para o real

Hoje nenhuma chamada sai para o Google. Ao criar uma batelada, `src/lib/drive.ts` gera um ID e um caminho (`Alimentos TEM / Bateladas / TEM 450 g / Batelada #3`) e os links de laudos e fotos ficam na tabela `attachments`. Para ligar de verdade:

1. No Google Cloud Console, crie um projeto, ative a **Google Drive API** e crie uma **conta de serviço** com chave JSON.
2. Compartilhe a pasta raiz do Drive da empresa com o e-mail da conta de serviço, como *Editor*.
3. Guarde e-mail, chave privada e ID da pasta raiz em variáveis de ambiente.
4. Troque o corpo de `createBatchFolder` por uma chamada a `POST https://www.googleapis.com/drive/v3/files` com `{ name, mimeType: "application/vnd.google-apps.folder", parents: [ID_DA_RAIZ] }` (o pacote `googleapis` cuida da autenticação) e devolva o `id` real e `url: https://drive.google.com/drive/folders/<id>`.

O resto do sistema só conhece essa função, então telas e banco não mudam.

## 6.1 Se o login reclamar de origem

A mensagem *"Não foi possível confirmar a origem da requisição"* só aparece se a chamada chegar sem `Origin`, sem `Sec-Fetch-Site`, sem `x-tem-client` e sem corpo JSON — situação incomum, típica de proxy corporativo que reescreve requisições. Recarregue a página e tente de novo; se persistir, acesse por um endereço direto, porque é o `Origin` que impede outro site de agir em seu nome.

## 7. Limites desta versão inicial

- Drive simulado (acima). Anexos são **links** colados pelo usuário; não há upload de arquivo.
- Sessão por token no navegador: quem tiver acesso à máquina consegue lê-lo (`localStorage`, `window.name` ou a URL) — o cookie httpOnly sozinho não tinha esse risco. Em compensação, o login funciona em ambientes que bloqueiam cookies. Para o chão de fábrica, use um navegador/perfil dedicado por posto e o botão **Sair** ao terminar o turno (o Sair apaga o token no servidor e no navegador).
- Em caso de dúvida sobre segurança, a ordem de preferência é: cookie particionado (o padrão em HTTPS) → token no navegador. Definir `COOKIE_SAMESITE=lax` restringe o cookie, mas não desliga os canais por token.
- Atualização do painel por consulta periódica (8 s), não em tempo real por WebSocket.
- Sem recuperação de senha por e-mail (o admin redefine) e sem limite de tentativas de login.
- A separação baixa o saldo consolidado por produto/embalagem; não escolhe de qual batelada sai (sem FEFO).
- Embalagens já usadas não podem ser excluídas nem ter a quantidade alterada — desative e cadastre outra, para não distorcer o estoque produzido.
- Alterações feitas no Painel Admin (produtos e classificações) não entram no histórico de eventos das bateladas.
- A exclusão é lógica (soft delete): não apaga dados do banco. Não há lixeira nem restauração pela interface nesta versão.
