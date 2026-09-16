-- DropConstraint
ALTER TABLE "pn_especialidades" DROP CONSTRAINT IF EXISTS "pn_especialidades_ds_especialidade_key";

-- AlterTable
ALTER TABLE "pa_especialidades" ADD COLUMN IF NOT EXISTS "grupo_id" INTEGER,
ADD COLUMN IF NOT EXISTS "image_url" VARCHAR(500),
ADD COLUMN IF NOT EXISTS "slug" VARCHAR(128);

-- AlterTable
ALTER TABLE "pn_especialidades" DROP COLUMN IF EXISTS "ds_area",
ADD COLUMN IF NOT EXISTS "eixo_id" INTEGER,
ADD COLUMN IF NOT EXISTS "imagem_url" VARCHAR(500),
ADD COLUMN IF NOT EXISTS "ramo" VARCHAR(50),
ADD COLUMN IF NOT EXISTS "slug" VARCHAR(128) NOT NULL;

-- AlterTable
ALTER TABLE "pn_especialidades_itens" ADD COLUMN IF NOT EXISTS "cd_especialidade" VARCHAR(50),
ADD COLUMN IF NOT EXISTS "ds_etapa" VARCHAR(50),
ALTER COLUMN "cd_item" SET NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "pa_especialidades_grupos" (
    "id" SERIAL NOT NULL,
    "nm_grupo" VARCHAR(128) NOT NULL,
    "nr_ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pa_especialidades_grupos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pa_especialidades_grupos_nm_grupo_key" ON "pa_especialidades_grupos"("nm_grupo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pa_especialidades_slug_key" ON "pa_especialidades"("slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pn_especialidades_slug_key" ON "pn_especialidades"("slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pn_especialidades_ds_especialidade_ramo_key" ON "pn_especialidades"("ds_especialidade", "ramo");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pa_especialidades_grupo_id_fkey'
    ) THEN
        ALTER TABLE "pa_especialidades" ADD CONSTRAINT "pa_especialidades_grupo_id_fkey" FOREIGN KEY ("grupo_id") REFERENCES "pa_especialidades_grupos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pn_especialidades_eixo_id_fkey'
    ) THEN
        ALTER TABLE "pn_especialidades" ADD CONSTRAINT "pn_especialidades_eixo_id_fkey" FOREIGN KEY ("eixo_id") REFERENCES "pn_eixos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
