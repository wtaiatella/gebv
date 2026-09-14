# GEBV — Gestão e Transição do Novo Programa Escoteiro

Sistema web moderno (Next.js 15 App Router + Prisma 6 + PostgreSQL) para extração segura, equivalência de competências e acompanhamento de progressões do programa antigo para o Novo Programa Escoteiro da UEB.

---

## 🚀 Requisitos e Configuração

### 1. Variáveis de Ambiente (`.env`)

```ini
# Conexão principal com o banco PostgreSQL (utilizada pelo Prisma e scripts)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gebv"

# Cookie de sessão opcional para execução de scripts de teste Paxtu (via CLI)
PAXTU_COOKIE=""

# Ambiente de execução
NODE_ENV="development"
```

### 2. Comandos Prisma

```bash
# Gerar os tipos do Prisma Client (@prisma/client)
npm run prisma:generate

# Aplicar migrações pendentes no banco de dados
npm run prisma:migrate
```

### 3. Execução em Desenvolvimento

```bash
npm run dev
```

Acesse em [http://localhost:3000](http://localhost:3000).

---

## 📡 Endpoints da API

### Sincronização Paxtu 100
- **`POST /api/sync/ramo/[ramo]`**: Sincronização completa de seção via streaming NDJSON. Suporta os ramos `lobinho` (branch 2), `escoteiro` (branch 1), `senior` (branch 3) e `pioneiro` (branch 4).
- **`POST /api/sync/[id]`**: Sincronização sob demanda da ficha de progressão e especialidades de um associado específico.
- **`POST /api/paxtu/login`**: Autenticação no Paxtu com emissão de cookie HTTP seguro (`paxtu_session`) para suporte a multi-sessão isolada por usuário.

### Motor de Equivalência e Transição
- **`POST /api/transicao/[id]?ramo=[ramo]`**: Executa o recálculo atômico das regras de equivalência para um associado.
- **`POST /api/transicao/lote?ramo=[ramo]`**: Executa o recálculo em lote para todos os associados ativos do ramo selecionado.
- **`GET /api/progressoes/novo-modelo/[id]?ramo=[ramo]`**: Retorna a visão completa dos 18 blocos transicionados, percentuais, estatísticas e detalhes de equivalência.

### Ajuste Manual de Ações
- **`POST /api/progressoes/novo-modelo/[id]/acao`**: Conclusão ou reversão manual de ação (`OrigemConquista.MANUAL_CHEFE`) com recálculo imediato do status do bloco.
- **`POST /api/progressoes/novo-modelo/[id]/bloco-save-all`**: Persistência em lote de todas as ações de um bloco específico em transação única.

### Catálogo e Regras de Equivalência
- **`GET /api/regras-equivalencia?ramo=[ramo]`**: Listagem das regras de equivalência, eixos, blocos e catálogo PA para autocomplete.
- **`PUT /api/regras-equivalencia/[id]`**: Atualização de regra de equivalência (operação, itens UEB, especialidades exigidas, contagem mínima).

---

## 🛠️ Scripts Utilitários

- **`npx tsx scripts/run-transicao.mjs`**: Executa o motor de transição para todos os jovens e imprime uma tabela formatada no terminal com contagem de ações e blocos concluídos.
- **`npx tsx scripts/migrate-legacy-data.mjs`**: Migração e sanitização histórica de dados legados para os modelos oficiais do Prisma.
