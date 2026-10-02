-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Ramo" AS ENUM ('LOBINHO', 'ESCOTEIRO', 'SENIOR', 'PIONEIRO');

-- CreateEnum
CREATE TYPE "TipoAcaoPn" AS ENUM ('FIXA', 'VARIAVEL', 'SUBSTITUTIVA', 'PA');

-- CreateEnum
CREATE TYPE "ModalidadePn" AS ENUM ('BASICO', 'AR', 'MAR');

-- CreateEnum
CREATE TYPE "OperacaoEquivalencia" AS ENUM ('PROGRESSOES', 'ESPECIALIDADE', 'SEMANTICO', 'TODAS', 'QNT_MINIMA', 'SEM_EQUIVALENCIA');

-- CreateEnum
CREATE TYPE "StatusAssociado" AS ENUM ('ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "CategoriaAssociado" AS ENUM ('BENEFICIARIO', 'ESCOTISTA');

-- CreateEnum
CREATE TYPE "PnRamoEspecialidades" AS ENUM ('LOBINHO_ESCOTEIRO', 'SENIOR_PIONEIRO');

-- CreateEnum
CREATE TYPE "OrigemConquista" AS ENUM ('EQUIVALENCIA_AUTOMATICA', 'MANUAL_CHEFE', 'CONQUISTA_NOVA');

-- CreateTable
CREATE TABLE "associados" (
    "cd_associado" VARCHAR(32) NOT NULL,
    "nr_registro_formatado" VARCHAR(32),
    "nm_associado" VARCHAR(255) NOT NULL,
    "ds_categoria" "CategoriaAssociado" NOT NULL DEFAULT 'BENEFICIARIO',
    "ds_ramo" "Ramo",
    "fl_status" "StatusAssociado" DEFAULT 'ATIVO',
    "dt_nascimento" DATE,
    "ds_email" VARCHAR(255),
    "ds_telefone_cel" VARCHAR(64),
    "dados_cadastrais_completos" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "associados_pkey" PRIMARY KEY ("cd_associado")
);

-- CreateTable
CREATE TABLE "progressao_paxtu" (
    "id" SERIAL NOT NULL,
    "cd_associado" VARCHAR(32) NOT NULL,
    "caminhos" JSONB DEFAULT '[]',
    "dados_brutos" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progressao_paxtu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pa_caminhos" (
    "id" SERIAL NOT NULL,
    "ds_ramo" "Ramo" NOT NULL DEFAULT 'ESCOTEIRO',
    "cd_caminho_paxtu" VARCHAR(16) NOT NULL,
    "nm_caminho" VARCHAR(128) NOT NULL,

    CONSTRAINT "pa_caminhos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pa_areas_desenvolvimento" (
    "id" SERIAL NOT NULL,
    "ds_ramo" "Ramo" NOT NULL DEFAULT 'ESCOTEIRO',
    "nm_area" VARCHAR(64) NOT NULL,

    CONSTRAINT "pa_areas_desenvolvimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pa_competencias" (
    "id" SERIAL NOT NULL,
    "ds_ramo" "Ramo" NOT NULL DEFAULT 'ESCOTEIRO',
    "caminho_id" INTEGER,
    "area_id" INTEGER,
    "cd_competencia_paxtu" VARCHAR(32),
    "nr_competencia_ordem" INTEGER,
    "ds_competencia" TEXT NOT NULL,

    CONSTRAINT "pa_competencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pa_atividades" (
    "id" SERIAL NOT NULL,
    "ds_ramo" "Ramo" NOT NULL DEFAULT 'ESCOTEIRO',
    "competencia_id" INTEGER NOT NULL,
    "cd_atividade_paxtu" VARCHAR(32) NOT NULL,
    "cd_caminho_paxtu" VARCHAR(16) NOT NULL,
    "identificacao" VARCHAR(32),
    "nr_ordenacao" INTEGER DEFAULT 0,
    "ds_atividade" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],

    CONSTRAINT "pa_atividades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pa_especialidades_grupos" (
    "id" SERIAL NOT NULL,
    "nm_grupo" VARCHAR(128) NOT NULL,
    "nr_ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pa_especialidades_grupos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pa_especialidades" (
    "id" SERIAL NOT NULL,
    "cd_especialidade" VARCHAR(50) NOT NULL,
    "ds_especialidade" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(128),
    "grupo_id" INTEGER,
    "image_url" VARCHAR(500),
    "total_itens" INTEGER DEFAULT 0,

    CONSTRAINT "pa_especialidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pa_especialidades_itens" (
    "id" SERIAL NOT NULL,
    "especialidade_id" INTEGER NOT NULL,
    "cd_especialidade" VARCHAR(50) NOT NULL,
    "cd_item" VARCHAR(50) NOT NULL,
    "ds_item" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],

    CONSTRAINT "pa_especialidades_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pn_especialidades" (
    "id" SERIAL NOT NULL,
    "cd_especialidade" VARCHAR(50),
    "ds_especialidade" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(128) NOT NULL,
    "eixo_id" INTEGER,
    "ramo" "PnRamoEspecialidades",
    "imagem_url" VARCHAR(500),
    "total_itens" INTEGER DEFAULT 0,
    "meta_nivel_1" INTEGER DEFAULT 4,
    "meta_nivel_2" INTEGER DEFAULT 8,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pn_especialidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pn_especialidades_itens" (
    "id" SERIAL NOT NULL,
    "especialidade_id" INTEGER,
    "cd_especialidade" VARCHAR(50),
    "cd_item" VARCHAR(50) NOT NULL,
    "nr_item" INTEGER,
    "ds_etapa" VARCHAR(50),
    "ds_item" TEXT NOT NULL,
    "tipo_equivalencia" VARCHAR(20) NOT NULL DEFAULT 'TODAS',
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pn_especialidades_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pn_pa_especialidades_relacoes" (
    "id" SERIAL NOT NULL,
    "pn_especialidade_id" INTEGER NOT NULL,
    "pa_especialidade_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pn_pa_especialidades_relacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pn_especialidades_equivalencia_regras" (
    "id" SERIAL NOT NULL,
    "pn_item_id" INTEGER NOT NULL,
    "pa_item_id" INTEGER NOT NULL,
    "score_similaridade" DOUBLE PRECISION,
    "fl_aprovado" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pn_especialidades_equivalencia_regras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pn_bloco_especialidades" (
    "id" SERIAL NOT NULL,
    "bloco_id" INTEGER NOT NULL,
    "nm_especialidade" VARCHAR(128) NOT NULL,
    "area_ramo" VARCHAR(64),

    CONSTRAINT "pn_bloco_especialidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progressao_pa" (
    "id" SERIAL NOT NULL,
    "cd_associado" VARCHAR(32) NOT NULL,
    "atividade_id" INTEGER NOT NULL,
    "concluida" BOOLEAN NOT NULL DEFAULT false,
    "status_escotista" VARCHAR(64),
    "data_conclusao" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progressao_pa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progressao_especialidade_pa" (
    "id" SERIAL NOT NULL,
    "cd_associado" VARCHAR(32) NOT NULL,
    "especialidade_id" INTEGER,
    "cd_especialidade" VARCHAR(50) NOT NULL,
    "ds_especialidade" VARCHAR(255) NOT NULL,
    "nr_nivel" INTEGER NOT NULL DEFAULT 0,
    "dt_nivel" DATE,
    "qtd_itens_concluidos" INTEGER NOT NULL DEFAULT 0,
    "itens_detalhados" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progressao_especialidade_pa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progressao_especialidade_item_pa" (
    "id" SERIAL NOT NULL,
    "cd_associado" VARCHAR(32) NOT NULL,
    "especialidade_item_id" INTEGER NOT NULL,
    "concluida" BOOLEAN NOT NULL DEFAULT false,
    "data_conclusao" DATE,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progressao_especialidade_item_pa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progressao_especialidade_pn" (
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

-- CreateTable
CREATE TABLE "progressao_especialidade_item_pn" (
    "id" SERIAL NOT NULL,
    "cd_associado" VARCHAR(32) NOT NULL,
    "especialidade_item_id" INTEGER NOT NULL,
    "concluida" BOOLEAN NOT NULL DEFAULT true,
    "data_conclusao" DATE,
    "origem" "OrigemConquista" NOT NULL DEFAULT 'EQUIVALENCIA_AUTOMATICA',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progressao_especialidade_item_pn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pn_eixos" (
    "id" SERIAL NOT NULL,
    "ds_ramo" "Ramo" NOT NULL DEFAULT 'ESCOTEIRO',
    "nm_eixo" VARCHAR(128) NOT NULL,
    "nr_ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pn_eixos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pn_blocos" (
    "id" SERIAL NOT NULL,
    "ds_ramo" "Ramo" NOT NULL DEFAULT 'ESCOTEIRO',
    "eixo_id" INTEGER NOT NULL,
    "nm_bloco" VARCHAR(128) NOT NULL,
    "ds_intencionalidade" TEXT NOT NULL,
    "nr_acoes_fixas_obrigatorias" INTEGER NOT NULL DEFAULT 0,
    "nr_acoes_variaveis_exigidas" INTEGER NOT NULL DEFAULT 0,
    "nr_ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pn_blocos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pn_acoes_educativas" (
    "id" SERIAL NOT NULL,
    "ds_ramo" "Ramo" NOT NULL DEFAULT 'ESCOTEIRO',
    "bloco_id" INTEGER NOT NULL,
    "tp_acao" "TipoAcaoPn" NOT NULL,
    "modalidade" "ModalidadePn" NOT NULL DEFAULT 'BASICO',
    "ds_acao" TEXT NOT NULL,
    "regra_qtd_texto" VARCHAR(64),
    "nr_ordem" INTEGER NOT NULL DEFAULT 0,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],

    CONSTRAINT "pn_acoes_educativas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pn_equivalencia_regras" (
    "id" SERIAL NOT NULL,
    "acao_pn_id" INTEGER NOT NULL,
    "operacao" "OperacaoEquivalencia" NOT NULL DEFAULT 'PROGRESSOES',
    "descricao_origem" TEXT NOT NULL,
    "fl_requer_validacao_manual" BOOLEAN NOT NULL DEFAULT false,
    "detalhes_regra" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pn_equivalencia_regras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progressao_pn" (
    "id" SERIAL NOT NULL,
    "cd_associado" VARCHAR(32) NOT NULL,
    "acao_id" INTEGER NOT NULL,
    "origem" "OrigemConquista" NOT NULL,
    "fl_concluido" BOOLEAN NOT NULL DEFAULT true,
    "dt_conclusao" DATE,
    "cd_escotista_avaliador" VARCHAR(32),
    "ds_observacao" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progressao_pn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progressao_blocos" (
    "id" SERIAL NOT NULL,
    "cd_associado" VARCHAR(32) NOT NULL,
    "bloco_id" INTEGER NOT NULL,
    "fl_concluido" BOOLEAN NOT NULL DEFAULT false,
    "nr_fixas_concluidas" INTEGER NOT NULL DEFAULT 0,
    "nr_variaveis_concluidas" INTEGER NOT NULL DEFAULT 0,
    "pct_conclusao" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "dt_conclusao_bloco" DATE,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progressao_blocos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" SERIAL NOT NULL,
    "tipo" VARCHAR(32) NOT NULL,
    "cd_associado" VARCHAR(32),
    "status" VARCHAR(32) NOT NULL,
    "detalhes" JSONB,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "associados_ds_ramo_ds_categoria_idx" ON "associados"("ds_ramo", "ds_categoria");

-- CreateIndex
CREATE UNIQUE INDEX "progressao_paxtu_cd_associado_key" ON "progressao_paxtu"("cd_associado");

-- CreateIndex
CREATE UNIQUE INDEX "pa_caminhos_ds_ramo_cd_caminho_paxtu_key" ON "pa_caminhos"("ds_ramo", "cd_caminho_paxtu");

-- CreateIndex
CREATE UNIQUE INDEX "pa_areas_desenvolvimento_ds_ramo_nm_area_key" ON "pa_areas_desenvolvimento"("ds_ramo", "nm_area");

-- CreateIndex
CREATE UNIQUE INDEX "pa_atividades_ds_ramo_cd_caminho_paxtu_cd_atividade_paxtu_key" ON "pa_atividades"("ds_ramo", "cd_caminho_paxtu", "cd_atividade_paxtu");

-- CreateIndex
CREATE UNIQUE INDEX "pa_atividades_ds_ramo_cd_atividade_paxtu_key" ON "pa_atividades"("ds_ramo", "cd_atividade_paxtu");

-- CreateIndex
CREATE UNIQUE INDEX "pa_especialidades_grupos_nm_grupo_key" ON "pa_especialidades_grupos"("nm_grupo");

-- CreateIndex
CREATE UNIQUE INDEX "pa_especialidades_cd_especialidade_key" ON "pa_especialidades"("cd_especialidade");

-- CreateIndex
CREATE UNIQUE INDEX "pa_especialidades_slug_key" ON "pa_especialidades"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "pa_especialidades_itens_cd_especialidade_cd_item_key" ON "pa_especialidades_itens"("cd_especialidade", "cd_item");

-- CreateIndex
CREATE UNIQUE INDEX "pn_especialidades_slug_key" ON "pn_especialidades"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "pn_especialidades_ds_especialidade_ramo_key" ON "pn_especialidades"("ds_especialidade", "ramo");

-- CreateIndex
CREATE UNIQUE INDEX "pn_pa_especialidades_relacoes_pn_especialidade_id_pa_especi_key" ON "pn_pa_especialidades_relacoes"("pn_especialidade_id", "pa_especialidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "pn_especialidades_equivalencia_regras_pn_item_id_pa_item_id_key" ON "pn_especialidades_equivalencia_regras"("pn_item_id", "pa_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "progressao_pa_cd_associado_atividade_id_key" ON "progressao_pa"("cd_associado", "atividade_id");

-- CreateIndex
CREATE UNIQUE INDEX "progressao_especialidade_pa_cd_associado_cd_especialidade_key" ON "progressao_especialidade_pa"("cd_associado", "cd_especialidade");

-- CreateIndex
CREATE UNIQUE INDEX "progressao_especialidade_item_pa_cd_associado_especialidade_key" ON "progressao_especialidade_item_pa"("cd_associado", "especialidade_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "progressao_especialidade_pn_cd_associado_especialidade_id_key" ON "progressao_especialidade_pn"("cd_associado", "especialidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "progressao_especialidade_item_pn_cd_associado_especialidade_key" ON "progressao_especialidade_item_pn"("cd_associado", "especialidade_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "pn_eixos_ds_ramo_nm_eixo_key" ON "pn_eixos"("ds_ramo", "nm_eixo");

-- CreateIndex
CREATE UNIQUE INDEX "pn_blocos_eixo_id_nm_bloco_key" ON "pn_blocos"("eixo_id", "nm_bloco");

-- CreateIndex
CREATE UNIQUE INDEX "pn_equivalencia_regras_acao_pn_id_key" ON "pn_equivalencia_regras"("acao_pn_id");

-- CreateIndex
CREATE UNIQUE INDEX "progressao_pn_cd_associado_acao_id_key" ON "progressao_pn"("cd_associado", "acao_id");

-- CreateIndex
CREATE UNIQUE INDEX "progressao_blocos_cd_associado_bloco_id_key" ON "progressao_blocos"("cd_associado", "bloco_id");

-- AddForeignKey
ALTER TABLE "progressao_paxtu" ADD CONSTRAINT "progressao_paxtu_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_competencias" ADD CONSTRAINT "pa_competencias_caminho_id_fkey" FOREIGN KEY ("caminho_id") REFERENCES "pa_caminhos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_competencias" ADD CONSTRAINT "pa_competencias_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "pa_areas_desenvolvimento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_atividades" ADD CONSTRAINT "pa_atividades_competencia_id_fkey" FOREIGN KEY ("competencia_id") REFERENCES "pa_competencias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_especialidades" ADD CONSTRAINT "pa_especialidades_grupo_id_fkey" FOREIGN KEY ("grupo_id") REFERENCES "pa_especialidades_grupos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_especialidades_itens" ADD CONSTRAINT "pa_especialidades_itens_especialidade_id_fkey" FOREIGN KEY ("especialidade_id") REFERENCES "pa_especialidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pn_especialidades" ADD CONSTRAINT "pn_especialidades_eixo_id_fkey" FOREIGN KEY ("eixo_id") REFERENCES "pn_eixos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pn_especialidades_itens" ADD CONSTRAINT "pn_especialidades_itens_especialidade_id_fkey" FOREIGN KEY ("especialidade_id") REFERENCES "pn_especialidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pn_pa_especialidades_relacoes" ADD CONSTRAINT "pn_pa_especialidades_relacoes_pn_especialidade_id_fkey" FOREIGN KEY ("pn_especialidade_id") REFERENCES "pn_especialidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pn_pa_especialidades_relacoes" ADD CONSTRAINT "pn_pa_especialidades_relacoes_pa_especialidade_id_fkey" FOREIGN KEY ("pa_especialidade_id") REFERENCES "pa_especialidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pn_especialidades_equivalencia_regras" ADD CONSTRAINT "pn_especialidades_equivalencia_regras_pn_item_id_fkey" FOREIGN KEY ("pn_item_id") REFERENCES "pn_especialidades_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pn_especialidades_equivalencia_regras" ADD CONSTRAINT "pn_especialidades_equivalencia_regras_pa_item_id_fkey" FOREIGN KEY ("pa_item_id") REFERENCES "pa_especialidades_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pn_bloco_especialidades" ADD CONSTRAINT "pn_bloco_especialidades_bloco_id_fkey" FOREIGN KEY ("bloco_id") REFERENCES "pn_blocos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_pa" ADD CONSTRAINT "progressao_pa_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_pa" ADD CONSTRAINT "progressao_pa_atividade_id_fkey" FOREIGN KEY ("atividade_id") REFERENCES "pa_atividades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_especialidade_pa" ADD CONSTRAINT "progressao_especialidade_pa_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_especialidade_pa" ADD CONSTRAINT "progressao_especialidade_pa_especialidade_id_fkey" FOREIGN KEY ("especialidade_id") REFERENCES "pa_especialidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_especialidade_item_pa" ADD CONSTRAINT "progressao_especialidade_item_pa_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_especialidade_item_pa" ADD CONSTRAINT "progressao_especialidade_item_pa_especialidade_item_id_fkey" FOREIGN KEY ("especialidade_item_id") REFERENCES "pa_especialidades_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_especialidade_pn" ADD CONSTRAINT "progressao_especialidade_pn_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_especialidade_pn" ADD CONSTRAINT "progressao_especialidade_pn_especialidade_id_fkey" FOREIGN KEY ("especialidade_id") REFERENCES "pn_especialidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_especialidade_item_pn" ADD CONSTRAINT "progressao_especialidade_item_pn_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_especialidade_item_pn" ADD CONSTRAINT "progressao_especialidade_item_pn_especialidade_item_id_fkey" FOREIGN KEY ("especialidade_item_id") REFERENCES "pn_especialidades_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pn_blocos" ADD CONSTRAINT "pn_blocos_eixo_id_fkey" FOREIGN KEY ("eixo_id") REFERENCES "pn_eixos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pn_acoes_educativas" ADD CONSTRAINT "pn_acoes_educativas_bloco_id_fkey" FOREIGN KEY ("bloco_id") REFERENCES "pn_blocos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pn_equivalencia_regras" ADD CONSTRAINT "pn_equivalencia_regras_acao_pn_id_fkey" FOREIGN KEY ("acao_pn_id") REFERENCES "pn_acoes_educativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_pn" ADD CONSTRAINT "progressao_pn_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_pn" ADD CONSTRAINT "progressao_pn_acao_id_fkey" FOREIGN KEY ("acao_id") REFERENCES "pn_acoes_educativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_blocos" ADD CONSTRAINT "progressao_blocos_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progressao_blocos" ADD CONSTRAINT "progressao_blocos_bloco_id_fkey" FOREIGN KEY ("bloco_id") REFERENCES "pn_blocos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

