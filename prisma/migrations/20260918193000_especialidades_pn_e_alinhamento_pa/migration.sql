-- CreateEnum
CREATE TYPE "PnRamoEspecialidades" AS ENUM ('LOBINHO_ESCOTEIRO', 'SENIOR_PIONEIRO');

-- DropIndex
DROP INDEX IF EXISTS "pa_atividades_ds_ramo_cd_caminho_paxtu_cd_ueb_key";
DROP INDEX IF EXISTS "pa_atividades_ds_ramo_cd_ueb_idx";

-- AlterTable pa_atividades
ALTER TABLE "pa_atividades" DROP COLUMN IF EXISTS "cd_ueb",
ALTER COLUMN "cd_atividade_paxtu" SET NOT NULL,
ALTER COLUMN "cd_caminho_paxtu" SET NOT NULL;

-- CreateIndex for pa_atividades
CREATE UNIQUE INDEX IF NOT EXISTS "pa_atividades_ds_ramo_cd_caminho_paxtu_cd_atividade_paxtu_key" ON "pa_atividades"("ds_ramo", "cd_caminho_paxtu", "cd_atividade_paxtu");

-- AlterTable pn_especialidades (safe enum cast preserving data)
ALTER TABLE "pn_especialidades" 
ADD COLUMN IF NOT EXISTS "meta_nivel_1" INTEGER DEFAULT 4,
ADD COLUMN IF NOT EXISTS "meta_nivel_2" INTEGER DEFAULT 8;

ALTER TABLE "pn_especialidades"
ALTER COLUMN "ramo" TYPE "PnRamoEspecialidades" USING ("ramo"::text::"PnRamoEspecialidades");

-- AlterTable progressao_pa (safe backfill then drop)
ALTER TABLE "progressao_pa"
ADD COLUMN IF NOT EXISTS "concluida" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "data_conclusao" DATE,
ADD COLUMN IF NOT EXISTS "status_escotista" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "progressao_pa" SET
  "concluida" = COALESCE("fl_check_escotista", false),
  "status_escotista" = CASE 
    WHEN "fl_check_escotista" THEN 'confirmadoEscotista'
    WHEN "fl_check_jovem" THEN 'conversar'
    ELSE NULL
  END,
  "data_conclusao" = "dt_check_escotista"
WHERE "concluida" = false AND "fl_check_escotista" IS NOT NULL;

ALTER TABLE "progressao_pa"
DROP COLUMN IF EXISTS "dt_check_escotista",
DROP COLUMN IF EXISTS "dt_check_jovem",
DROP COLUMN IF EXISTS "fl_check_escotista",
DROP COLUMN IF EXISTS "fl_check_jovem";

-- AlterTable progressao_especialidade_item_pa (safe backfill then drop)
ALTER TABLE "progressao_especialidade_item_pa"
ADD COLUMN IF NOT EXISTS "concluida" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "data_conclusao" DATE;

UPDATE "progressao_especialidade_item_pa" SET
  "concluida" = (COALESCE("fl_check_escotista", false) OR COALESCE("fl_check_jovem", false) OR "dt_check_escotista" IS NOT NULL),
  "data_conclusao" = COALESCE("dt_check_escotista", "dt_check_jovem")
WHERE "concluida" = false AND ("fl_check_escotista" IS NOT NULL OR "dt_check_escotista" IS NOT NULL);

ALTER TABLE "progressao_especialidade_item_pa"
DROP COLUMN IF EXISTS "dt_check_escotista",
DROP COLUMN IF EXISTS "dt_check_jovem",
DROP COLUMN IF EXISTS "fl_check_escotista",
DROP COLUMN IF EXISTS "fl_check_jovem";

-- AlterTable progressao_paxtu
ALTER TABLE "progressao_paxtu"
ADD COLUMN IF NOT EXISTS "dados_brutos" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "caminhos" DROP NOT NULL;

-- CreateTable pn_pa_especialidades_relacoes
CREATE TABLE IF NOT EXISTS "pn_pa_especialidades_relacoes" (
    "id" SERIAL NOT NULL,
    "pn_especialidade_id" INTEGER NOT NULL,
    "pa_especialidade_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pn_pa_especialidades_relacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable pn_especialidades_equivalencia_regras
CREATE TABLE IF NOT EXISTS "pn_especialidades_equivalencia_regras" (
    "id" SERIAL NOT NULL,
    "pn_item_id" INTEGER NOT NULL,
    "pa_item_id" INTEGER NOT NULL,
    "score_similaridade" DOUBLE PRECISION,
    "fl_aprovado" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pn_especialidades_equivalencia_regras_pkey" PRIMARY KEY ("id")
);

-- CreateTable progressao_especialidade_pn
CREATE TABLE IF NOT EXISTS "progressao_especialidade_pn" (
    "id" SERIAL NOT NULL,
    "cd_associado" VARCHAR(32) NOT NULL,
    "especialidade_id" INTEGER NOT NULL,
    "nr_nivel" INTEGER NOT NULL DEFAULT 0,
    "fl_concluido" BOOLEAN NOT NULL DEFAULT false,
    "dt_conquista" DATE,
    "qtd_itens_concluidos" INTEGER NOT NULL DEFAULT 0,
    "origem" "OrigemConquista" NOT NULL DEFAULT 'EQUIVALENCIA_AUTOMATICA',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progressao_especialidade_pn_pkey" PRIMARY KEY ("id")
);

-- CreateTable progressao_especialidade_item_pn
CREATE TABLE IF NOT EXISTS "progressao_especialidade_item_pn" (
    "id" SERIAL NOT NULL,
    "cd_associado" VARCHAR(32) NOT NULL,
    "especialidade_item_id" INTEGER NOT NULL,
    "concluida" BOOLEAN NOT NULL DEFAULT true,
    "data_conclusao" DATE,
    "origem" "OrigemConquista" NOT NULL DEFAULT 'EQUIVALENCIA_AUTOMATICA',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progressao_especialidade_item_pn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pn_pa_especialidades_relacoes_pn_especialidade_id_pa_especi_key" ON "pn_pa_especialidades_relacoes"("pn_especialidade_id", "pa_especialidade_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pn_especialidades_equivalencia_regras_pn_item_id_pa_item_id_key" ON "pn_especialidades_equivalencia_regras"("pn_item_id", "pa_item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "progressao_especialidade_pn_cd_associado_especialidade_id_key" ON "progressao_especialidade_pn"("cd_associado", "especialidade_id");
CREATE UNIQUE INDEX IF NOT EXISTS "progressao_especialidade_item_pn_cd_associado_especialidade_key" ON "progressao_especialidade_item_pn"("cd_associado", "especialidade_item_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pn_pa_especialidades_relacoes_pn_especialidade_id_fkey') THEN
        ALTER TABLE "pn_pa_especialidades_relacoes" ADD CONSTRAINT "pn_pa_especialidades_relacoes_pn_especialidade_id_fkey" FOREIGN KEY ("pn_especialidade_id") REFERENCES "pn_especialidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pn_pa_especialidades_relacoes_pa_especialidade_id_fkey') THEN
        ALTER TABLE "pn_pa_especialidades_relacoes" ADD CONSTRAINT "pn_pa_especialidades_relacoes_pa_especialidade_id_fkey" FOREIGN KEY ("pa_especialidade_id") REFERENCES "pa_especialidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pn_especialidades_equivalencia_regras_pn_item_id_fkey') THEN
        ALTER TABLE "pn_especialidades_equivalencia_regras" ADD CONSTRAINT "pn_especialidades_equivalencia_regras_pn_item_id_fkey" FOREIGN KEY ("pn_item_id") REFERENCES "pn_especialidades_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pn_especialidades_equivalencia_regras_pa_item_id_fkey') THEN
        ALTER TABLE "pn_especialidades_equivalencia_regras" ADD CONSTRAINT "pn_especialidades_equivalencia_regras_pa_item_id_fkey" FOREIGN KEY ("pa_item_id") REFERENCES "pa_especialidades_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progressao_especialidade_pn_cd_associado_fkey') THEN
        ALTER TABLE "progressao_especialidade_pn" ADD CONSTRAINT "progressao_especialidade_pn_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progressao_especialidade_pn_especialidade_id_fkey') THEN
        ALTER TABLE "progressao_especialidade_pn" ADD CONSTRAINT "progressao_especialidade_pn_especialidade_id_fkey" FOREIGN KEY ("especialidade_id") REFERENCES "pn_especialidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progressao_especialidade_item_pn_cd_associado_fkey') THEN
        ALTER TABLE "progressao_especialidade_item_pn" ADD CONSTRAINT "progressao_especialidade_item_pn_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progressao_especialidade_item_pn_especialidade_item_id_fkey') THEN
        ALTER TABLE "progressao_especialidade_item_pn" ADD CONSTRAINT "progressao_especialidade_item_pn_especialidade_item_id_fkey" FOREIGN KEY ("especialidade_item_id") REFERENCES "pn_especialidades_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
