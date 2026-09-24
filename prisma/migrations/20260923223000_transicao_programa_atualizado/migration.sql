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
