# System Design Document (SDD): Sistema de Backup e Gestão de Progressões GEBV

## 1. Visão Geral e Contexto
O Movimento Escoteiro no Brasil (União dos Escoteiros do Brasil - UEB) está passando por uma evolução metodológica e migração do sistema legado de acompanhamento de progressão (**Paxtu** legado) para uma nova plataforma.

O objetivo do **GEBV (Grupo Escoteiro Bela Vista)** é garantir:
1. **Backup integral e auditável** do histórico de todos os associados e suas progressões do sistema legado.
2. **Sincronização sob demanda:** varredura automatizada por seção ou atualização individual por jovem.
3. **Persistência segura em PostgreSQL**, preparando o terreno para ferramentas futuras de equivalência e conversão para o novo modelo de progressão da UEB.

---

## 2. Estrutura de Dados e Tabelas (PostgreSQL)

### 2.1. Tabela Unificada de Pessoas
* **`associados`**: Guarda todos os membros do grupo (Beneficiários de todas as seções e Escotistas/Adultos).
  * Campos: `cd_associado` (PK), `nr_registro_formatado`, `nm_associado`, `dsCategoria` ("Beneficiário" | "Escotista"), `dsRamo` ("Escoteiro", "Lobinho", "Sênior", "Pioneiro"), `flStatus`, `dt_nascimento`, `ds_email`, `ds_telefone_cel`, `dados_cadastrais_completos` (JSONB), `updated_at`.

### 2.2. Tabelas de Progressões e Atividades (Separadas por Seção)
Cada seção possui suas próprias particularidades, distintivos e caminhos de progressão. As tabelas são segregadas por ramo:

* **Tropa Escoteira (Foco da V1):**
  * `progressoes_escoteiro` (caminhos: Introdutório, Pista/Trilha, Rumo/Travessia)
  * `atividades_escoteiro` (tarefas, competências, checks de escotista e jovem)
* **Alcateia / Lobinhos (Futuro):**
  * `progressoes_alcateia`
  * `atividades_alcateia`
* **Tropa Sênior (Futuro):**
  * `progressoes_senior`
  * `atividades_senior`
* **Clã Pioneiro (Futuro):**
  * `progressoes_pioneiro`
  * `atividades_pioneiro`

### 2.3. Logs de Sincronização
* **`sync_logs`**: Registra execuções, status, duração e eventuais erros de sincronizações gerais e individuais.

---

## 3. Endpoints de API

### 3.1. Sincronização em Massa (Por Seção)
* **`POST /api/sync/escoteiro`** *(V1)*: Varre todos os beneficiários com `dsRamo == 'Escoteiro'` no Paxtu e atualiza as tabelas `progressoes_escoteiro` e `atividades_escoteiro`.
* **`POST /api/sync/alcateia`** *(Futuro)*: Varredura da seção de lobinhos.
* **`POST /api/sync/senior`** *(Futuro)*: Varredura da seção sênior/guia.
* **`POST /api/sync/pioneiro`** *(Futuro)*: Varredura do clã pioneiro.

### 3.2. Sincronização Individual
* **`POST /api/sync/[id]`** *(V1)*: Recebe o `cd_associado` via parâmetro de rota.
  1. Consulta a tabela `associados` para identificar o ramo do jovem.
  2. Faz o disparo RPC para o Paxtu exclusivamente para aquele associado.
  3. Atualiza os dados cadastrais em `associados` e a progressão na tabela correspondente ao seu ramo (ex: `progressoes_escoteiro`).

---

## 4. Interface do Usuário (UI) - V1

Mantém a estrutura visual atual do **ScoutExplorer** com a adição pontual de **dois botões de ação**:

1. **Botão de Sincronização Geral da Tropa:**
   * Localizado no topo/cabeçalho da aplicação.
   * Rótulo: **"Sincronizar Escoteiros"** (aciona `POST /api/sync/escoteiro`).
   * Exibe estado de carregamento enquanto o lote é processado.

2. **Botão de Sincronização Individual:**
   * Localizado no card do escoteiro selecionado.
   * Rótulo: **"Sincronizar dados deste jovem"** (aciona `POST /api/sync/[id]`).
   * Exibe spinner/loading durante a atualização do jovem em tela.

---

## 5. Próximos Passos de Execução
1. Criar o script SQL de migração com as tabelas `associados`, `progressoes_escoteiro`, `atividades_escoteiro` e `sync_logs`.
2. Configurar a conexão do PostgreSQL com o Next.js (usando variáveis de ambiente no `.env`).
3. Implementar a biblioteca de integração RPC (`app/lib/paxtu/`).
4. Criar as rotas de API `/api/sync/escoteiro` e `/api/sync/[id]`.
5. Integrar os dois botões no componente `ScoutExplorer`.
