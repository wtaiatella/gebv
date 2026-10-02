import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export async function seedCatalogoPaMultiRamo() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERRO: Defina DATABASE_URL no .env');
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('⚜️  SEED DO CATÁLOGO DO PROGRAMA ANTIGO (PA) - MULTI-RAMO');
  console.log('    Ramos: LOBINHO, ESCOTEIRO, SENIOR, PIONEIRO');
  console.log('='.repeat(70));

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    const catalogoPath = path.join(process.cwd(), 'data', 'catalogo', 'pa_catalogo_multiramo.json');
    const rawData = await readFile(catalogoPath, 'utf8');
    const catalogo = JSON.parse(rawData);

    await client.query('BEGIN');

    let totalCaminhos = 0;
    let totalCompetencias = 0;
    let totalAtividades = 0;

    for (const [ramoKey, ramoData] of Object.entries(catalogo)) {
      const dsRamo = ramoData.ramo; // 'LOBINHO', 'ESCOTEIRO', 'SENIOR', 'PIONEIRO'
      console.log(`\n📌 Semeando Ramo: ${dsRamo}...`);

      // 1. Caminhos
      const caminhoIdMap = new Map(); // cd_caminho_paxtu -> db id
      for (const cam of ramoData.caminhos) {
        const cdCaminho = String(cam.cd_caminho_paxtu);
        const nmCaminho = cam.nm_caminho;

        const res = await client.query(
          `INSERT INTO pa_caminhos (ds_ramo, cd_caminho_paxtu, nm_caminho)
           VALUES ($1, $2, $3)
           ON CONFLICT (ds_ramo, cd_caminho_paxtu) DO UPDATE SET nm_caminho = EXCLUDED.nm_caminho
           RETURNING id`,
          [dsRamo, cdCaminho, nmCaminho]
        );
        caminhoIdMap.set(cdCaminho, res.rows[0].id);
        totalCaminhos++;
      }
      console.log(`   ✓ ${caminhoIdMap.size} caminhos inseridos/atualizados.`);

      // 2. Competências (Carrega existentes para evitar duplicação)
      const existingComps = await client.query(
        `SELECT id, cd_competencia_paxtu, caminho_id, ds_competencia FROM pa_competencias WHERE ds_ramo = $1`,
        [dsRamo]
      );
      const compMap = new Map();
      for (const row of existingComps.rows) {
        if (row.cd_competencia_paxtu) {
          compMap.set(`code_${row.cd_competencia_paxtu}`, row.id);
        }
        compMap.set(`cam_${row.caminho_id}_${row.ds_competencia}`, row.id);
      }

      for (const comp of ramoData.competencias) {
        const cdCaminho = String(comp.cd_caminho_paxtu);
        const caminhoDbId = caminhoIdMap.get(cdCaminho) || null;
        const cdComp = String(comp.cd_competencia_paxtu || '');
        const dsComp = comp.ds_competencia;

        let compDbId = compMap.get(`code_${cdComp}`) || compMap.get(`cam_${caminhoDbId}_${dsComp}`);
        if (!compDbId) {
          const res = await client.query(
            `INSERT INTO pa_competencias (ds_ramo, caminho_id, cd_competencia_paxtu, ds_competencia)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [dsRamo, caminhoDbId, cdComp || null, dsComp]
          );
          compDbId = res.rows[0].id;
          if (cdComp) compMap.set(`code_${cdComp}`, compDbId);
          compMap.set(`cam_${caminhoDbId}_${dsComp}`, compDbId);
          totalCompetencias++;
        }
      }
      console.log(`   ✓ Competências consolidadas (Total mapeado: ${compMap.size}).`);

      // 3. Atividades
      let ativCount = 0;
      for (const atv of ramoData.atividades) {
        const cdCaminho = String(atv.cd_caminho_paxtu);
        const cdAtividade = String(atv.cd_atividade_paxtu);
        const cdComp = String(atv.cd_competencia_paxtu || '');
        const caminhoDbId = caminhoIdMap.get(cdCaminho) || null;

        let compDbId = compMap.get(`code_${cdComp}`) || compMap.get(`code_${cdCaminho}`);
        if (!compDbId) {
          // Fallback para primeira competência do caminho
          for (const [k, v] of compMap.entries()) {
            if (k.startsWith(`cam_${caminhoDbId}_`)) {
              compDbId = v;
              break;
            }
          }
        }

        // Se ainda não houver competência, cria uma genérica de caminho
        if (!compDbId) {
          const res = await client.query(
            `INSERT INTO pa_competencias (ds_ramo, caminho_id, cd_competencia_paxtu, ds_competencia)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [dsRamo, caminhoDbId, `caminho_${cdCaminho}`, `Competência Geral do Caminho ${cdCaminho}`]
          );
          compDbId = res.rows[0].id;
          compMap.set(`code_${cdCaminho}`, compDbId);
        }

        const identificacao = atv.identificacao || `${dsRamo.slice(0, 1)}-${cdCaminho}-${cdAtividade}`;
        const nrOrdenacao = atv.nr_ordenacao ?? null;

        await client.query(
          `INSERT INTO pa_atividades (
             ds_ramo, competencia_id, cd_atividade_paxtu, cd_caminho_paxtu, identificacao, ds_atividade, nr_ordenacao
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (ds_ramo, cd_caminho_paxtu, cd_atividade_paxtu) DO UPDATE SET
             competencia_id = EXCLUDED.competencia_id,
             identificacao = EXCLUDED.identificacao,
             ds_atividade = EXCLUDED.ds_atividade,
             nr_ordenacao = EXCLUDED.nr_ordenacao`,
          [dsRamo, compDbId, cdAtividade, cdCaminho, identificacao, atv.ds_atividade, nrOrdenacao]
        );
        ativCount++;
        totalAtividades++;
      }
      console.log(`   ✓ ${ativCount} atividades semeadas com sucesso.`);
    }

    await client.query('COMMIT');
    console.log('\n' + '='.repeat(70));
    console.log('🎉 SEED DO PROGRAMA ANTIGO CONCLUÍDO COM SUCESSO!');
    console.log(`Total de Caminhos: ${totalCaminhos}`);
    console.log(`Total de Atividades no Banco: ${totalAtividades}`);
    console.log('='.repeat(70));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Falha ao semear catálogo PA multi-ramo:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Executa direto se invocado por linha de comando
if (process.argv[1]?.endsWith('seed-catalogo-pa-multiramo.mjs')) {
  seedCatalogoPaMultiRamo().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
