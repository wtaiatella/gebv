-- AlterTable
ALTER TABLE "pn_especialidades_itens" ADD COLUMN IF NOT EXISTS "tipo_equivalencia" VARCHAR(20) NOT NULL DEFAULT 'TODAS';
