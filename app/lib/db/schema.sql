-- Schema de banco de dados para o GEBV Backup de Progressões
-- Compatível com PostgreSQL 14+

-- 1. Tabela Unificada de Pessoas (Beneficiários e Escotistas)
CREATE TABLE IF NOT EXISTS associados (
  cd_associado VARCHAR(32) PRIMARY KEY,
  nr_registro_formatado VARCHAR(32),
  nm_associado VARCHAR(255) NOT NULL,
  ds_categoria VARCHAR(64) NOT NULL, -- 'Beneficiário' | 'Escotista'
  ds_ramo VARCHAR(64),               -- 'Escoteiro', 'Lobinho', etc.
  fl_status VARCHAR(32),
  dt_nascimento VARCHAR(32),
  ds_email VARCHAR(255),
  ds_telefone_cel VARCHAR(64),
  dados_cadastrais_completos JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_associados_ramo_categoria ON associados (ds_ramo, ds_categoria);

-- 2. Progressões da Tropa Escoteira
CREATE TABLE IF NOT EXISTS progressoes_escoteiro (
  id SERIAL PRIMARY KEY,
  cd_associado VARCHAR(32) NOT NULL REFERENCES associados(cd_associado) ON DELETE CASCADE,
  caminhos JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_progressoes_escoteiro_associado UNIQUE (cd_associado)
);

-- 3. Atividades da Tropa Escoteira
CREATE TABLE IF NOT EXISTS atividades_escoteiro (
  id SERIAL PRIMARY KEY,
  cd_associado VARCHAR(32) NOT NULL REFERENCES associados(cd_associado) ON DELETE CASCADE,
  cd_caminho VARCHAR(64),
  cd_competencia VARCHAR(64),
  ds_atividade TEXT,
  ds_desenvolvimento VARCHAR(128),
  check_jovem VARCHAR(32),
  check_escotista VARCHAR(32),
  dt_check_jovem VARCHAR(32),
  dt_check_escotista VARCHAR(32),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_atividades_escoteiro_associado ON atividades_escoteiro (cd_associado);

-- 4. Logs e Auditoria de Sincronizações
CREATE TABLE IF NOT EXISTS sync_logs (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(32) NOT NULL, -- 'lote_escoteiro' | 'individual'
  cd_associado VARCHAR(32),
  status VARCHAR(32) NOT NULL, -- 'sucesso' | 'erro' | 'parcial'
  detalhes JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
