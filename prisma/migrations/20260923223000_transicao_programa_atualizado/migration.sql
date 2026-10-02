-- Inicia transação atômica
BEGIN;

-- 1. Cria tipo enum temporário com os novos valores canônicos
CREATE TYPE "OperacaoEquivalencia_new" AS ENUM (
  'PROGRESSOES',
  'ESPECIALIDADE',
  'SEMANTICO',
  'TODAS',
  'QNT_MINIMA',
  'SEM_EQUIVALENCIA'
);

-- 2. Converte valores legados na tabela pn_equivalencia_regras
ALTER TABLE "pn_equivalencia_regras" 
  ALTER COLUMN "operacao" DROP DEFAULT;

ALTER TABLE "pn_equivalencia_regras" 
  ALTER COLUMN "operacao" TYPE "OperacaoEquivalencia_new" 
  USING (
    CASE "operacao"::text
      WHEN 'DIRETA' THEN 'PROGRESSOES'::"OperacaoEquivalencia_new"
      WHEN 'OR' THEN 'QNT_MINIMA'::"OperacaoEquivalencia_new"
      WHEN 'MIN_COUNT' THEN 'QNT_MINIMA'::"OperacaoEquivalencia_new"
      WHEN 'ESPECIALIDADES' THEN 'ESPECIALIDADE'::"OperacaoEquivalencia_new"
      WHEN 'SEM_EQUIVALENCIA' THEN 'SEM_EQUIVALENCIA'::"OperacaoEquivalencia_new"
      ELSE 'PROGRESSOES'::"OperacaoEquivalencia_new"
    END
  );

-- 3. Substitui o tipo enum antigo pelo novo
DROP TYPE "OperacaoEquivalencia";
ALTER TYPE "OperacaoEquivalencia_new" RENAME TO "OperacaoEquivalencia";
ALTER TABLE "pn_equivalencia_regras" 
  ALTER COLUMN "operacao" SET DEFAULT 'PROGRESSOES'::"OperacaoEquivalencia";

-- 3.5. Backfill de segurança: preserva os campos legados em detalhes_regra (formato achatado
--      que o motor de avaliação e a UI já sabem interpretar como fallback) para qualquer linha
--      que ainda não tenha sido re-semeada a partir do catálogo canônico
--      (data/catalogo/pn_equivalencia_regras.json via scripts/seed-catalogo.mjs) antes desta
--      migração. Sem este passo, o DROP COLUMN abaixo apagaria essa informação sem
--      possibilidade de recuperação caso o reseed não rode imediatamente após a migração
--      neste ambiente. Não sobrescreve linhas que já tenham detalhes_regra preenchido.
UPDATE "pn_equivalencia_regras"
SET "detalhes_regra" = jsonb_build_object(
  'origem_pistas_ueb', to_jsonb(COALESCE("origem_pistas_ueb", ARRAY[]::text[])),
  'origem_rumo_ueb', to_jsonb(COALESCE("origem_rumo_ueb", ARRAY[]::text[])),
  'origem_especialidades', to_jsonb(COALESCE("origem_especialidades", ARRAY[]::text[])),
  'nivel_min_especialidade', COALESCE("nivel_min_especialidade", 1),
  'min_count', COALESCE("min_count", 1)
)
WHERE ("detalhes_regra" IS NULL OR "detalhes_regra" = '{}'::jsonb)
  AND (
    COALESCE(array_length("origem_pistas_ueb", 1), 0) > 0
    OR COALESCE(array_length("origem_rumo_ueb", 1), 0) > 0
    OR COALESCE(array_length("origem_especialidades", 1), 0) > 0
  );

-- 4. Remove as 5 colunas legadas obsoletas de pn_equivalencia_regras
ALTER TABLE "pn_equivalencia_regras"
  DROP COLUMN IF EXISTS "origem_pistas_ueb",
  DROP COLUMN IF EXISTS "origem_rumo_ueb",
  DROP COLUMN IF EXISTS "origem_especialidades",
  DROP COLUMN IF EXISTS "nivel_min_especialidade",
  DROP COLUMN IF EXISTS "min_count";

-- 5. Adiciona colunas de embeddings Float[]
ALTER TABLE "pn_acoes_educativas"
  ADD COLUMN IF NOT EXISTS "embedding" double precision[] DEFAULT ARRAY[]::double precision[];

ALTER TABLE "pa_atividades"
  ADD COLUMN IF NOT EXISTS "embedding" double precision[] DEFAULT ARRAY[]::double precision[];

COMMIT;
