-- Migration 004: Coluna identificacao na tabela pa_atividades
-- Prefixo padronizado: P- (Período Introdutório), PT- (Pista e Trilha), RT- (Rumo e Travessia)

ALTER TABLE pa_atividades ADD COLUMN IF NOT EXISTS identificacao VARCHAR(32);
CREATE INDEX IF NOT EXISTS idx_pa_atividades_identificacao ON pa_atividades(identificacao);
