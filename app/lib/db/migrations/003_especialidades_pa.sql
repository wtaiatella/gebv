-- Migration 003: Especialidades do Programa Antigo (Paxtu)
-- Catálogo oficial de especialidades, itens de requisitos e registro de conquistas dos jovens

CREATE TABLE IF NOT EXISTS pa_especialidades (
  id SERIAL PRIMARY KEY,
  cd_especialidade VARCHAR(50) NOT NULL UNIQUE,
  ds_especialidade VARCHAR(255) NOT NULL,
  total_itens INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pa_especialidades_itens (
  id SERIAL PRIMARY KEY,
  especialidade_id INT REFERENCES pa_especialidades(id) ON DELETE CASCADE,
  cd_especialidade VARCHAR(50) NOT NULL,
  cd_item VARCHAR(50) NOT NULL,
  ds_item TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_pa_especialidade_item UNIQUE (cd_especialidade, cd_item)
);

CREATE TABLE IF NOT EXISTS escoteiro_pa_especialidades (
  id SERIAL PRIMARY KEY,
  cd_associado VARCHAR(50) NOT NULL REFERENCES associados(cd_associado) ON DELETE CASCADE,
  especialidade_id INT REFERENCES pa_especialidades(id) ON DELETE CASCADE,
  cd_especialidade VARCHAR(50) NOT NULL,
  ds_especialidade VARCHAR(255) NOT NULL,
  nr_nivel INT DEFAULT 0, -- 0 = Em andamento / parcial, 1 = Nível 1, 2 = Nível 2, 3 = Nível 3
  dt_nivel VARCHAR(50),
  qtd_itens_concluidos INT DEFAULT 0,
  itens_detalhados JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_escoteiro_pa_especialidade UNIQUE (cd_associado, cd_especialidade)
);

CREATE INDEX IF NOT EXISTS idx_pa_especialidades_cd ON pa_especialidades(cd_especialidade);
CREATE INDEX IF NOT EXISTS idx_pa_especialidades_ds ON pa_especialidades(ds_especialidade);
CREATE INDEX IF NOT EXISTS idx_escoteiro_pa_especialidades_assoc ON escoteiro_pa_especialidades(cd_associado);
CREATE INDEX IF NOT EXISTS idx_escoteiro_pa_especialidades_esp ON escoteiro_pa_especialidades(cd_especialidade);
