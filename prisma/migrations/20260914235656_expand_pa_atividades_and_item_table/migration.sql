-- AlterTable
ALTER TABLE "pa_atividades" ADD COLUMN     "cd_caminho_paxtu" VARCHAR(16);

-- CreateTable
CREATE TABLE "progressao_especialidade_item_pa" (
    "id" SERIAL NOT NULL,
    "cd_associado" VARCHAR(32) NOT NULL,
    "especialidade_item_id" INTEGER NOT NULL,
    "fl_check_jovem" BOOLEAN NOT NULL DEFAULT false,
    "fl_check_escotista" BOOLEAN NOT NULL DEFAULT false,
    "dt_check_jovem" DATE,
    "dt_check_escotista" DATE,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progressao_especialidade_item_pa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "progressao_especialidade_item_pa_cd_associado_especialidade_key" ON "progressao_especialidade_item_pa"("cd_associado", "especialidade_item_id");

-- AddForeignKey
ALTER TABLE "progressao_especialidade_item_pa" ADD CONSTRAINT "progressao_especialidade_item_pa_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_especialidade_item_pa" ADD CONSTRAINT "progressao_especialidade_item_pa_especialidade_item_id_fkey" FOREIGN KEY ("especialidade_item_id") REFERENCES "pa_especialidades_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
