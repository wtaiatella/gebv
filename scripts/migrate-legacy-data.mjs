import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://gebv:gebv@localhost:5432/gebv'
});

async function run() {
  console.log('--- Iniciando Migração de Dados Legados (T024 + T005) ---');
  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Criar Enums se não existirem
    console.log('1. Criando Enums...');
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "Ramo" AS ENUM ('LOBINHO', 'ESCOTEIRO', 'SENIOR', 'PIONEIRO');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE "TipoAcaoPn" AS ENUM ('FIXA', 'VARIAVEL', 'SUBSTITUTIVA', 'PA');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE "ModalidadePn" AS ENUM ('BASICO', 'AR', 'MAR');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE "OperacaoEquivalencia" AS ENUM ('DIRETA', 'OR', 'MIN_COUNT', 'ESPECIALIDADES', 'SEM_EQUIVALENCIA');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE "StatusAssociado" AS ENUM ('ATIVO', 'INATIVO');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE "CategoriaAssociado" AS ENUM ('BENEFICIARIO', 'ESCOTISTA');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      DO $$ BEGIN
        CREATE TYPE "OrigemConquista" AS ENUM ('EQUIVALENCIA_AUTOMATICA', 'MANUAL_CHEFE', 'CONQUISTA_NOVA');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // 2. Criar Novas Tabelas padronizadas
    console.log('2. Criando novas tabelas progressao_*...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "progressao_paxtu" (
        "id" SERIAL PRIMARY KEY,
        "cd_associado" VARCHAR(32) NOT NULL UNIQUE,
        "caminhos" JSONB NOT NULL DEFAULT '[]',
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS "progressao_pa" (
        "id" SERIAL PRIMARY KEY,
        "cd_associado" VARCHAR(32) NOT NULL,
        "atividade_id" INTEGER NOT NULL,
        "fl_check_jovem" BOOLEAN NOT NULL DEFAULT false,
        "fl_check_escotista" BOOLEAN NOT NULL DEFAULT false,
        "dt_check_jovem" DATE,
        "dt_check_escotista" DATE,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "progressao_pa_cd_associado_atividade_id_key" UNIQUE ("cd_associado", "atividade_id")
      );

      CREATE TABLE IF NOT EXISTS "progressao_especialidade_pa" (
        "id" SERIAL PRIMARY KEY,
        "cd_associado" VARCHAR(32) NOT NULL,
        "especialidade_id" INTEGER,
        "cd_especialidade" VARCHAR(50) NOT NULL,
        "ds_especialidade" VARCHAR(255) NOT NULL,
        "nr_nivel" INTEGER NOT NULL DEFAULT 0,
        "dt_nivel" DATE,
        "qtd_itens_concluidos" INTEGER NOT NULL DEFAULT 0,
        "itens_detalhados" JSONB NOT NULL DEFAULT '[]',
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "progressao_especialidade_pa_cd_associado_cd_especialidade_key" UNIQUE ("cd_associado", "cd_especialidade")
      );

      CREATE TABLE IF NOT EXISTS "progressao_pn" (
        "id" SERIAL PRIMARY KEY,
        "cd_associado" VARCHAR(32) NOT NULL,
        "acao_id" INTEGER NOT NULL,
        "origem" "OrigemConquista" NOT NULL,
        "fl_concluido" BOOLEAN NOT NULL DEFAULT true,
        "dt_conclusao" DATE,
        "cd_escotista_avaliador" VARCHAR(32),
        "ds_observacao" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "progressao_pn_cd_associado_acao_id_key" UNIQUE ("cd_associado", "acao_id")
      );

      CREATE TABLE IF NOT EXISTS "progressao_blocos" (
        "id" SERIAL PRIMARY KEY,
        "cd_associado" VARCHAR(32) NOT NULL,
        "bloco_id" INTEGER NOT NULL,
        "fl_concluido" BOOLEAN NOT NULL DEFAULT false,
        "nr_fixas_concluidas" INTEGER NOT NULL DEFAULT 0,
        "nr_variaveis_concluidas" INTEGER NOT NULL DEFAULT 0,
        "pct_conclusao" DECIMAL(5,2) NOT NULL DEFAULT 0,
        "dt_conclusao_bloco" DATE,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "progressao_blocos_cd_associado_bloco_id_key" UNIQUE ("cd_associado", "bloco_id")
      );
    `);

    // 3. Sanitização e Cast Defensivo de associados
    console.log('3. Sanitizando e convertendo associados...');
    await client.query(`
      ALTER TABLE "associados"
        ALTER COLUMN "fl_status" DROP DEFAULT,
        ALTER COLUMN "ds_categoria" DROP DEFAULT,
        ALTER COLUMN "ds_ramo" DROP DEFAULT;

      ALTER TABLE "associados"
        ALTER COLUMN "dt_nascimento" TYPE DATE USING (
          CASE
            WHEN dt_nascimento IS NULL OR TRIM(dt_nascimento) = '' THEN NULL
            WHEN dt_nascimento ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_DATE(SUBSTRING(dt_nascimento FROM 1 FOR 10), 'DD/MM/YYYY')
            WHEN dt_nascimento ~ '^\\d{4}-\\d{2}-\\d{2}' THEN TO_DATE(SUBSTRING(dt_nascimento FROM 1 FOR 10), 'YYYY-MM-DD')
            ELSE NULL
          END
        ),
        ALTER COLUMN "fl_status" TYPE "StatusAssociado" USING (
          CASE
            WHEN fl_status IN ('S', 'Ativo', 'ATIVO') THEN 'ATIVO'::"StatusAssociado"
            ELSE 'INATIVO'::"StatusAssociado"
          END
        ),
        ALTER COLUMN "fl_status" SET DEFAULT 'ATIVO'::"StatusAssociado",
        ALTER COLUMN "ds_categoria" TYPE "CategoriaAssociado" USING (
          CASE
            WHEN ds_categoria IN ('Escotista', 'ESCOTISTA') THEN 'ESCOTISTA'::"CategoriaAssociado"
            ELSE 'BENEFICIARIO'::"CategoriaAssociado"
          END
        ),
        ALTER COLUMN "ds_categoria" SET DEFAULT 'BENEFICIARIO'::"CategoriaAssociado",
        ALTER COLUMN "ds_ramo" TYPE "Ramo" USING (
          CASE
            WHEN ds_ramo IN ('Escoteiro', 'ESCOTEIRO') THEN 'ESCOTEIRO'::"Ramo"
            WHEN ds_ramo IN ('Lobinho', 'LOBINHO') THEN 'LOBINHO'::"Ramo"
            WHEN ds_ramo IN ('Sênior', 'Senior', 'SENIOR') THEN 'SENIOR'::"Ramo"
            WHEN ds_ramo IN ('Pioneiro', 'PIONEIRO') THEN 'PIONEIRO'::"Ramo"
            ELSE NULL
          END
        ),
        ALTER COLUMN "updated_at" SET NOT NULL,
        ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);
    `);

    // 4. Sanitização e Cast de pn_acoes_educativas
    console.log('4. Sanitizando e convertendo pn_acoes_educativas...');
    await client.query(`
      UPDATE "pn_acoes_educativas"
      SET "tp_acao" = 'PA', "modalidade" = 'BASICO'
      WHERE "modalidade" = 'PA';

      UPDATE "pn_acoes_educativas"
      SET "modalidade" = 'BASICO'
      WHERE "modalidade" = 'Substitutiva';

      UPDATE "pn_acoes_educativas"
      SET "modalidade" = CASE
        WHEN "modalidade" IN ('Básico', 'BASICO') THEN 'BASICO'
        WHEN "modalidade" IN ('Mar', 'MAR') THEN 'MAR'
        WHEN "modalidade" IN ('Ar', 'AR') THEN 'AR'
        ELSE 'BASICO'
      END;

      UPDATE "pn_acoes_educativas"
      SET "tp_acao" = CASE
        WHEN "tp_acao" IN ('Fixa', 'FIXA') THEN 'FIXA'
        WHEN "tp_acao" IN ('Variável', 'VARIAVEL') THEN 'VARIAVEL'
        WHEN "tp_acao" IN ('Substitutiva', 'SUBSTITUTIVA') THEN 'SUBSTITUTIVA'
        WHEN "tp_acao" = 'PA' THEN 'PA'
        ELSE 'FIXA'
      END;

      ALTER TABLE "pn_acoes_educativas"
        ALTER COLUMN "modalidade" DROP DEFAULT,
        ALTER COLUMN "tp_acao" DROP DEFAULT,
        ALTER COLUMN "ds_ramo" DROP DEFAULT;

      ALTER TABLE "pn_acoes_educativas"
        ALTER COLUMN "tp_acao" TYPE "TipoAcaoPn" USING ("tp_acao"::"TipoAcaoPn"),
        ALTER COLUMN "modalidade" TYPE "ModalidadePn" USING ("modalidade"::"ModalidadePn"),
        ALTER COLUMN "modalidade" SET DEFAULT 'BASICO'::"ModalidadePn",
        ALTER COLUMN "ds_ramo" TYPE "Ramo" USING (
          CASE
            WHEN ds_ramo IN ('Escoteiro', 'ESCOTEIRO') THEN 'ESCOTEIRO'::"Ramo"
            WHEN ds_ramo IN ('Lobinho', 'LOBINHO') THEN 'LOBINHO'::"Ramo"
            WHEN ds_ramo IN ('Sênior', 'Senior', 'SENIOR') THEN 'SENIOR'::"Ramo"
            WHEN ds_ramo IN ('Pioneiro', 'PIONEIRO') THEN 'PIONEIRO'::"Ramo"
            ELSE 'ESCOTEIRO'::"Ramo"
          END
        ),
        ALTER COLUMN "ds_ramo" SET DEFAULT 'ESCOTEIRO'::"Ramo";
    `);

    // 5. Normalizar ds_ramo em tabelas de catálogo
    console.log('5. Convertendo ds_ramo em tabelas de catálogo...');
    await client.query(`
      ALTER TABLE "pn_eixos" ALTER COLUMN "ds_ramo" DROP DEFAULT;
      ALTER TABLE "pn_eixos" ALTER COLUMN "ds_ramo" TYPE "Ramo" USING (UPPER("ds_ramo")::"Ramo");
      ALTER TABLE "pn_eixos" ALTER COLUMN "ds_ramo" SET DEFAULT 'ESCOTEIRO'::"Ramo";

      ALTER TABLE "pn_blocos" ALTER COLUMN "ds_ramo" DROP DEFAULT;
      ALTER TABLE "pn_blocos" ALTER COLUMN "ds_ramo" TYPE "Ramo" USING (UPPER("ds_ramo")::"Ramo");
      ALTER TABLE "pn_blocos" ALTER COLUMN "ds_ramo" SET DEFAULT 'ESCOTEIRO'::"Ramo";

      ALTER TABLE "pa_areas_desenvolvimento" ALTER COLUMN "ds_ramo" DROP DEFAULT;
      ALTER TABLE "pa_areas_desenvolvimento" ALTER COLUMN "ds_ramo" TYPE "Ramo" USING (UPPER("ds_ramo")::"Ramo");
      ALTER TABLE "pa_areas_desenvolvimento" ALTER COLUMN "ds_ramo" SET DEFAULT 'ESCOTEIRO'::"Ramo";

      ALTER TABLE "pa_caminhos" ALTER COLUMN "ds_ramo" DROP DEFAULT;
      ALTER TABLE "pa_caminhos" ALTER COLUMN "ds_ramo" TYPE "Ramo" USING (UPPER("ds_ramo")::"Ramo");
      ALTER TABLE "pa_caminhos" ALTER COLUMN "ds_ramo" SET DEFAULT 'ESCOTEIRO'::"Ramo";

      ALTER TABLE "pa_competencias" ALTER COLUMN "ds_ramo" DROP DEFAULT;
      ALTER TABLE "pa_competencias" ALTER COLUMN "ds_ramo" TYPE "Ramo" USING (UPPER("ds_ramo")::"Ramo");
      ALTER TABLE "pa_competencias" ALTER COLUMN "ds_ramo" SET DEFAULT 'ESCOTEIRO'::"Ramo";

      ALTER TABLE "pa_atividades" ALTER COLUMN "ds_ramo" DROP DEFAULT;
      ALTER TABLE "pa_atividades" ALTER COLUMN "ds_ramo" TYPE "Ramo" USING (UPPER("ds_ramo")::"Ramo");
      ALTER TABLE "pa_atividades" ALTER COLUMN "ds_ramo" SET DEFAULT 'ESCOTEIRO'::"Ramo";
    `);

    // 6. Copiar dados legados para as novas tabelas
    console.log('6. Copiando dados das tabelas legadas...');

    // 6.1 progressoes_escoteiro -> progressao_paxtu
    const cp1 = await client.query(`
      INSERT INTO "progressao_paxtu" ("id", "cd_associado", "caminhos", "updated_at")
      SELECT "id", "cd_associado", "caminhos", "updated_at"
      FROM "progressoes_escoteiro"
      ON CONFLICT ("cd_associado") DO UPDATE
      SET "caminhos" = EXCLUDED."caminhos", "updated_at" = EXCLUDED."updated_at";
    `);
    console.log(`- Copiados ${cp1.rowCount} registros para progressao_paxtu.`);

    // 6.2 escoteiro_pa_atividades -> progressao_pa
    const cp2 = await client.query(`
      INSERT INTO "progressao_pa" ("id", "cd_associado", "atividade_id", "fl_check_jovem", "fl_check_escotista", "dt_check_jovem", "dt_check_escotista", "created_at")
      SELECT
        "id",
        "cd_associado",
        "atividade_id",
        "fl_check_jovem",
        "fl_check_escotista",
        CASE
          WHEN dt_check_jovem IS NULL OR TRIM(dt_check_jovem) = '' THEN NULL
          WHEN dt_check_jovem ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_DATE(SUBSTRING(dt_check_jovem FROM 1 FOR 10), 'DD/MM/YYYY')
          WHEN dt_check_jovem ~ '^\\d{4}-\\d{2}-\\d{2}' THEN TO_DATE(SUBSTRING(dt_check_jovem FROM 1 FOR 10), 'YYYY-MM-DD')
          ELSE NULL
        END,
        CASE
          WHEN dt_check_escotista IS NULL OR TRIM(dt_check_escotista) = '' THEN NULL
          WHEN dt_check_escotista ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_DATE(SUBSTRING(dt_check_escotista FROM 1 FOR 10), 'DD/MM/YYYY')
          WHEN dt_check_escotista ~ '^\\d{4}-\\d{2}-\\d{2}' THEN TO_DATE(SUBSTRING(dt_check_escotista FROM 1 FOR 10), 'YYYY-MM-DD')
          ELSE NULL
        END,
        "created_at"
      FROM "escoteiro_pa_atividades"
      ON CONFLICT ("cd_associado", "atividade_id") DO NOTHING;
    `);
    console.log(`- Copiados ${cp2.rowCount} registros para progressao_pa.`);

    // 6.3 escoteiro_pa_especialidades -> progressao_especialidade_pa
    const cp3 = await client.query(`
      INSERT INTO "progressao_especialidade_pa" ("id", "cd_associado", "especialidade_id", "cd_especialidade", "ds_especialidade", "nr_nivel", "dt_nivel", "qtd_itens_concluidos", "itens_detalhados", "updated_at")
      SELECT
        "id",
        "cd_associado",
        "especialidade_id",
        "cd_especialidade",
        "ds_especialidade",
        "nr_nivel",
        CASE
          WHEN dt_nivel IS NULL OR TRIM(dt_nivel) = '' THEN NULL
          WHEN dt_nivel ~ '^\\d{2}/\\d{2}/\\d{4}' THEN TO_DATE(SUBSTRING(dt_nivel FROM 1 FOR 10), 'DD/MM/YYYY')
          WHEN dt_nivel ~ '^\\d{4}-\\d{2}-\\d{2}' THEN TO_DATE(SUBSTRING(dt_nivel FROM 1 FOR 10), 'YYYY-MM-DD')
          ELSE NULL
        END,
        "qtd_itens_concluidos",
        "itens_detalhados",
        "updated_at"
      FROM "escoteiro_pa_especialidades"
      ON CONFLICT ("cd_associado", "cd_especialidade") DO NOTHING;
    `);
    console.log(`- Copiados ${cp3.rowCount} registros para progressao_especialidade_pa.`);

    // 6.4 escoteiro_pn_acoes -> progressao_pn
    const cp4 = await client.query(`
      INSERT INTO "progressao_pn" ("id", "cd_associado", "acao_id", "origem", "fl_concluido", "dt_conclusao", "cd_escotista_avaliador", "ds_observacao", "created_at")
      SELECT
        "id",
        "cd_associado",
        "acao_id",
        'EQUIVALENCIA_AUTOMATICA'::"OrigemConquista",
        "fl_concluido",
        "dt_conclusao",
        "cd_escotista_avaliador",
        "ds_observacao",
        "created_at"
      FROM "escoteiro_pn_acoes"
      ON CONFLICT ("cd_associado", "acao_id") DO NOTHING;
    `);
    console.log(`- Copiados ${cp4.rowCount} registros para progressao_pn.`);

    // 6.5 escoteiro_pn_blocos_status -> progressao_blocos
    const cp5 = await client.query(`
      INSERT INTO "progressao_blocos" ("id", "cd_associado", "bloco_id", "fl_concluido", "nr_fixas_concluidas", "nr_variaveis_concluidas", "pct_conclusao", "dt_conclusao_bloco", "updated_at")
      SELECT
        "id",
        "cd_associado",
        "bloco_id",
        "fl_concluido",
        "nr_fixas_concluidas",
        "nr_variaveis_concluidas",
        "pct_conclusao",
        "dt_conclusao_bloco",
        "updated_at"
      FROM "escoteiro_pn_blocos_status"
      ON CONFLICT ("cd_associado", "bloco_id") DO NOTHING;
    `);
    console.log(`- Copiados ${cp5.rowCount} registros para progressao_blocos.`);

    // 7. Validar integridade
    console.log('7. Validando integridade das contagens...');
    const v1 = await client.query('SELECT count(*) FROM progressao_paxtu');
    const v2 = await client.query('SELECT count(*) FROM progressao_pa');
    const v3 = await client.query('SELECT count(*) FROM progressao_especialidade_pa');
    const v4 = await client.query('SELECT count(*) FROM progressao_pn');
    const v5 = await client.query('SELECT count(*) FROM progressao_blocos');

    console.log(`Total em progressao_paxtu: ${v1.rows[0].count}`);
    console.log(`Total em progressao_pa: ${v2.rows[0].count}`);
    console.log(`Total em progressao_especialidade_pa: ${v3.rows[0].count}`);
    console.log(`Total em progressao_pn: ${v4.rows[0].count}`);
    console.log(`Total em progressao_blocos: ${v5.rows[0].count}`);

    // Atualizar sequências das novas tabelas
    await client.query(`
      SELECT setval(pg_get_serial_sequence('progressao_paxtu', 'id'), COALESCE(MAX(id), 1)) FROM "progressao_paxtu";
      SELECT setval(pg_get_serial_sequence('progressao_pa', 'id'), COALESCE(MAX(id), 1)) FROM "progressao_pa";
      SELECT setval(pg_get_serial_sequence('progressao_especialidade_pa', 'id'), COALESCE(MAX(id), 1)) FROM "progressao_especialidade_pa";
      SELECT setval(pg_get_serial_sequence('progressao_pn', 'id'), COALESCE(MAX(id), 1)) FROM "progressao_pn";
      SELECT setval(pg_get_serial_sequence('progressao_blocos', 'id'), COALESCE(MAX(id), 1)) FROM "progressao_blocos";
    `);

    // 8. Adicionar Foreign Keys e Restrições
    console.log('8. Adicionando Foreign Keys e Índices do Prisma...');
    await client.query(`
      -- Foreign Keys
      ALTER TABLE "progressao_paxtu"
        ADD CONSTRAINT "progressao_paxtu_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE;

      ALTER TABLE "progressao_pa"
        ADD CONSTRAINT "progressao_pa_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE,
        ADD CONSTRAINT "progressao_pa_atividade_id_fkey" FOREIGN KEY ("atividade_id") REFERENCES "pa_atividades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

      ALTER TABLE "progressao_especialidade_pa"
        ADD CONSTRAINT "progressao_especialidade_pa_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE,
        ADD CONSTRAINT "progressao_especialidade_pa_especialidade_id_fkey" FOREIGN KEY ("especialidade_id") REFERENCES "pa_especialidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

      ALTER TABLE "progressao_pn"
        ADD CONSTRAINT "progressao_pn_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE,
        ADD CONSTRAINT "progressao_pn_acao_id_fkey" FOREIGN KEY ("acao_id") REFERENCES "pn_acoes_educativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

      ALTER TABLE "progressao_blocos"
        ADD CONSTRAINT "progressao_blocos_cd_associado_fkey" FOREIGN KEY ("cd_associado") REFERENCES "associados"("cd_associado") ON DELETE CASCADE ON UPDATE CASCADE,
        ADD CONSTRAINT "progressao_blocos_bloco_id_fkey" FOREIGN KEY ("bloco_id") REFERENCES "pn_blocos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

      -- Índices adicionais
      CREATE INDEX IF NOT EXISTS "associados_ds_ramo_ds_categoria_idx" ON "associados"("ds_ramo", "ds_categoria");
    `);

    // 9. Drop das tabelas legadas
    console.log('9. Removendo tabelas legadas...');
    await client.query(`
      DROP TABLE IF EXISTS "atividades_escoteiro" CASCADE;
      DROP TABLE IF EXISTS "escoteiro_pa_atividades" CASCADE;
      DROP TABLE IF EXISTS "escoteiro_pa_especialidades" CASCADE;
      DROP TABLE IF EXISTS "escoteiro_pn_acoes" CASCADE;
      DROP TABLE IF EXISTS "escoteiro_pn_blocos_status" CASCADE;
      DROP TABLE IF EXISTS "progressoes_escoteiro" CASCADE;
    `);

    await client.query('COMMIT');
    console.log('✅ Migração e Sanitização concluídas com sucesso e commit efetuado!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro na migração — ROLLBACK executado:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
