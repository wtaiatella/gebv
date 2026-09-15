/*
  Warnings:

  - A unique constraint covering the columns `[ds_ramo,cd_caminho_paxtu,cd_ueb]` on the table `pa_atividades` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[ds_ramo,cd_atividade_paxtu]` on the table `pa_atividades` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "pa_atividades_ds_ramo_cd_caminho_paxtu_cd_ueb_key" ON "pa_atividades"("ds_ramo", "cd_caminho_paxtu", "cd_ueb");

-- CreateIndex
CREATE UNIQUE INDEX "pa_atividades_ds_ramo_cd_atividade_paxtu_key" ON "pa_atividades"("ds_ramo", "cd_atividade_paxtu");
