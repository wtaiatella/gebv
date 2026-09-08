-- Migration 002: Catálogo e Motor de Transição com Suporte Multi-Ramo (Lobinho, Escoteiro, Sênior, Pioneiro)

-- ============================================================================
-- 1. PROGRAMA ANTIGO (CATÁLOGO MULTI-RAMO E PROGRESSÕES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pa_areas_desenvolvimento (
  id SERIAL PRIMARY KEY,
  ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro', -- 'Lobinho', 'Escoteiro', 'Sênior', 'Pioneiro'
  nm_area VARCHAR(64) NOT NULL
);
ALTER TABLE pa_areas_desenvolvimento ADD COLUMN IF NOT EXISTS ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pa_area_ramo ON pa_areas_desenvolvimento(ds_ramo, nm_area);

CREATE TABLE IF NOT EXISTS pa_caminhos (
  id SERIAL PRIMARY KEY,
  ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro',
  cd_caminho_paxtu VARCHAR(16) NOT NULL,
  nm_caminho VARCHAR(128) NOT NULL
);
ALTER TABLE pa_caminhos ADD COLUMN IF NOT EXISTS ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pa_caminho_ramo ON pa_caminhos(ds_ramo, cd_caminho_paxtu);

CREATE TABLE IF NOT EXISTS pa_competencias (
  id SERIAL PRIMARY KEY,
  ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro',
  caminho_id INTEGER REFERENCES pa_caminhos(id) ON DELETE SET NULL,
  area_id INTEGER REFERENCES pa_areas_desenvolvimento(id) ON DELETE SET NULL,
  cd_competencia_paxtu VARCHAR(32),
  nr_competencia_ordem INTEGER,
  ds_competencia TEXT NOT NULL
);
ALTER TABLE pa_competencias ADD COLUMN IF NOT EXISTS ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro';
CREATE INDEX IF NOT EXISTS idx_pa_comp_ramo ON pa_competencias(ds_ramo);

CREATE TABLE IF NOT EXISTS pa_atividades (
  id SERIAL PRIMARY KEY,
  ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro',
  competencia_id INTEGER NOT NULL REFERENCES pa_competencias(id) ON DELETE CASCADE,
  cd_atividade_paxtu VARCHAR(32),
  cd_ueb VARCHAR(16) NOT NULL,
  nr_ordenacao INTEGER DEFAULT 0,
  ds_atividade TEXT NOT NULL
);
ALTER TABLE pa_atividades ADD COLUMN IF NOT EXISTS ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro';
CREATE INDEX IF NOT EXISTS idx_pa_atividades_ramo_ueb ON pa_atividades(ds_ramo, cd_ueb);
CREATE INDEX IF NOT EXISTS idx_pa_atividades_paxtu ON pa_atividades(cd_atividade_paxtu);

-- Histórico de atividades do jovem no Programa Antigo (desmembrado do Paxtu)
CREATE TABLE IF NOT EXISTS escoteiro_pa_atividades (
  id SERIAL PRIMARY KEY,
  cd_associado VARCHAR(32) NOT NULL REFERENCES associados(cd_associado) ON DELETE CASCADE,
  atividade_id INTEGER NOT NULL REFERENCES pa_atividades(id) ON DELETE CASCADE,
  fl_check_jovem BOOLEAN DEFAULT FALSE,
  fl_check_escotista BOOLEAN DEFAULT FALSE,
  dt_check_jovem VARCHAR(32),
  dt_check_escotista VARCHAR(32),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_escoteiro_pa_atividade UNIQUE (cd_associado, atividade_id)
);

CREATE INDEX IF NOT EXISTS idx_escoteiro_pa_atividades_assoc ON escoteiro_pa_atividades(cd_associado);

-- ============================================================================
-- 2. NOVO PROGRAMA EDUCATIVO (MULTI-RAMO: EIXOS, BLOCOS E AÇÕES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pn_eixos (
  id SERIAL PRIMARY KEY,
  ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro',
  nm_eixo VARCHAR(128) NOT NULL,
  nr_ordem INTEGER DEFAULT 0
);
ALTER TABLE pn_eixos ADD COLUMN IF NOT EXISTS ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pn_eixo_ramo ON pn_eixos(ds_ramo, nm_eixo);

CREATE TABLE IF NOT EXISTS pn_blocos (
  id SERIAL PRIMARY KEY,
  ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro',
  eixo_id INTEGER NOT NULL REFERENCES pn_eixos(id) ON DELETE CASCADE,
  nm_bloco VARCHAR(128) NOT NULL,
  ds_intencionalidade TEXT NOT NULL,
  nr_acoes_fixas_obrigatorias INTEGER DEFAULT 0,
  nr_acoes_variaveis_exigidas INTEGER DEFAULT 0,
  nr_ordem INTEGER DEFAULT 0,
  CONSTRAINT uq_pn_bloco_eixo UNIQUE (eixo_id, nm_bloco)
);
ALTER TABLE pn_blocos ADD COLUMN IF NOT EXISTS ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro';

CREATE TABLE IF NOT EXISTS pn_acoes_educativas (
  id SERIAL PRIMARY KEY,
  ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro',
  bloco_id INTEGER NOT NULL REFERENCES pn_blocos(id) ON DELETE CASCADE,
  tp_acao VARCHAR(32) NOT NULL,            -- 'Fixa', 'Variável', 'Substitui Variável'
  modalidade VARCHAR(32) DEFAULT 'Básico', -- 'Básico', 'Ar', 'Mar'
  ds_acao TEXT NOT NULL,
  regra_qtd_texto VARCHAR(64),
  nr_ordem INTEGER DEFAULT 0
);
ALTER TABLE pn_acoes_educativas ADD COLUMN IF NOT EXISTS ds_ramo VARCHAR(32) NOT NULL DEFAULT 'Escoteiro';
CREATE INDEX IF NOT EXISTS idx_pn_acoes_bloco ON pn_acoes_educativas(bloco_id);
CREATE INDEX IF NOT EXISTS idx_pn_acoes_ramo ON pn_acoes_educativas(ds_ramo);

CREATE TABLE IF NOT EXISTS pn_bloco_especialidades (
  id SERIAL PRIMARY KEY,
  bloco_id INTEGER NOT NULL REFERENCES pn_blocos(id) ON DELETE CASCADE,
  nm_especialidade VARCHAR(128) NOT NULL,
  area_ramo VARCHAR(64)
);

-- ============================================================================
-- 3. REGRAS DE EQUIVALÊNCIA E CONQUISTAS NO NOVO PROGRAMA
-- ============================================================================

CREATE TABLE IF NOT EXISTS pn_equivalencia_regras (
  id SERIAL PRIMARY KEY,
  acao_pn_id INTEGER NOT NULL REFERENCES pn_acoes_educativas(id) ON DELETE CASCADE,
  operacao VARCHAR(32) NOT NULL DEFAULT 'DIRETA', -- 'DIRETA', 'OR', 'MIN_COUNT', 'ESPECIALIDADES', 'SEM_EQUIVALENCIA'
  descricao_origem TEXT NOT NULL,
  origem_pistas_ueb VARCHAR(16)[] DEFAULT '{}',
  origem_rumo_ueb VARCHAR(16)[] DEFAULT '{}',
  origem_especialidades TEXT[] DEFAULT '{}',
  nivel_min_especialidade INTEGER DEFAULT 1,
  min_count INTEGER DEFAULT 1,
  fl_requer_validacao_manual BOOLEAN DEFAULT FALSE,
  detalhes_regra JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_pn_equiv_acao UNIQUE (acao_pn_id)
);

CREATE INDEX IF NOT EXISTS idx_pn_equiv_acao ON pn_equivalencia_regras(acao_pn_id);
CREATE INDEX IF NOT EXISTS idx_pn_equiv_operacao ON pn_equivalencia_regras(operacao);

CREATE TABLE IF NOT EXISTS escoteiro_pn_acoes (
  id SERIAL PRIMARY KEY,
  cd_associado VARCHAR(32) NOT NULL REFERENCES associados(cd_associado) ON DELETE CASCADE,
  acao_id INTEGER NOT NULL REFERENCES pn_acoes_educativas(id) ON DELETE CASCADE,
  origem VARCHAR(32) NOT NULL, -- 'equivalencia_automatica', 'manual_chefe', 'conquista_nova'
  fl_concluido BOOLEAN DEFAULT TRUE,
  dt_conclusao DATE,
  cd_escotista_avaliador VARCHAR(32),
  ds_observacao TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_escoteiro_pn_acao UNIQUE (cd_associado, acao_id)
);

CREATE INDEX IF NOT EXISTS idx_escoteiro_pn_acoes_assoc ON escoteiro_pn_acoes(cd_associado);

CREATE TABLE IF NOT EXISTS escoteiro_pn_blocos_status (
  id SERIAL PRIMARY KEY,
  cd_associado VARCHAR(32) NOT NULL REFERENCES associados(cd_associado) ON DELETE CASCADE,
  bloco_id INTEGER NOT NULL REFERENCES pn_blocos(id) ON DELETE CASCADE,
  fl_concluido BOOLEAN DEFAULT FALSE,
  nr_fixas_concluidas INTEGER DEFAULT 0,
  nr_variaveis_concluidas INTEGER DEFAULT 0,
  pct_conclusao NUMERIC(5,2) DEFAULT 0,
  dt_conclusao_bloco DATE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_escoteiro_pn_bloco UNIQUE (cd_associado, bloco_id)
);

CREATE INDEX IF NOT EXISTS idx_escoteiro_pn_blocos_assoc ON escoteiro_pn_blocos_status(cd_associado);
