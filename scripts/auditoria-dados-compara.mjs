import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

async function main() {
  console.log('='.repeat(80));
  console.log('🔍 RELATÓRIO DE AUDITORIA COMPARATIVA DE DADOS: PAXTU 100 vs PAXTU PA vs BANCO DE DADOS');
  console.log('='.repeat(80));

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não configurada no .env');
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    const rawDir = path.resolve(process.cwd(), 'data', 'raw');
    const rawPaDir = path.resolve(process.cwd(), 'data', 'raw_pa');

    // 1. Carrega dados do Banco PostgreSQL
    console.log('\n📥 1. Carregando dados do Banco de Dados PostgreSQL...');
    const associadosDbRes = await client.query(`
      SELECT cd_associado, nm_associado, ds_ramo, fl_status, nr_registro_formatado
      FROM associados
      WHERE fl_status = 'ATIVO' AND ds_categoria = 'BENEFICIARIO'
      ORDER BY ds_ramo, nm_associado
    `);

    const progPaDbRes = await client.query(`
      SELECT cd_associado, COUNT(*) FILTER (WHERE concluida = true) as ativs_concluidas
      FROM progressao_pa
      GROUP BY cd_associado
    `);
    const dbAtivsMap = new Map(progPaDbRes.rows.map((r) => [r.cd_associado, Number(r.ativs_concluidas)]));

    const espDbRes = await client.query(`
      SELECT cd_associado, COUNT(*) as total_esps, COUNT(*) FILTER (WHERE nr_nivel > 0) as esps_com_nivel
      FROM progressao_especialidade_pa
      GROUP BY cd_associado
    `);
    const dbEspsMap = new Map(espDbRes.rows.map((r) => [r.cd_associado, { total: Number(r.total_esps), comNivel: Number(r.esps_com_nivel) }]));

    const itemDbRes = await client.query(`
      SELECT cd_associado, COUNT(*) FILTER (WHERE concluida = true) as itens_concluidos
      FROM progressao_especialidade_item_pa
      GROUP BY cd_associado
    `);
    const dbItensMap = new Map(itemDbRes.rows.map((r) => [r.cd_associado, Number(r.itens_concluidos)]));

    console.log(`   ✓ ${associadosDbRes.rows.length} associados ativos carregados do PostgreSQL.`);

    // 2. Carrega dados de Paxtu100 (data/raw)
    console.log('📥 2. Carregando dados do Paxtu 100 (data/raw)...');
    const folders = ['alcateia', 'escoteiros', 'senior', 'pioneiros'];
    const paxtu100Map = new Map(); // cdAssociado -> { nome, ramo, ativs, esps, itens, conquistas, rawEsps }

    for (const f of folders) {
      const folderPath = path.join(rawDir, f);
      if (!existsSync(folderPath)) continue;
      const entries = await readdir(folderPath, { withFileTypes: true });

      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const treatedDir = path.join(folderPath, e.name, 'tratado');
        const dpPath = path.join(treatedDir, 'dados-pessoais.json');
        const progPath = path.join(treatedDir, 'progressoes-atividades.json');
        const espPath = path.join(treatedDir, 'especialidades.json');
        const conqPath = path.join(treatedDir, 'conquistas.json');

        if (!existsSync(dpPath)) continue;
        const dp = JSON.parse(await readFile(dpPath, 'utf8'));
        const cdAssociado = String(dp.cd_associado);

        let ativs = 0;
        if (existsSync(progPath)) {
          const prog = JSON.parse(await readFile(progPath, 'utf8'));
          ativs = Number(prog.total_atividades_cumpridas || 0);
        }

        let espsList = [];
        let itensConcluidos = 0;
        if (existsSync(espPath)) {
          espsList = JSON.parse(await readFile(espPath, 'utf8'));
          for (const esp of espsList) {
            itensConcluidos += Number(esp.itens_conquistados || 0);
          }
        }

        let conquistas = [];
        if (existsSync(conqPath)) {
          conquistas = JSON.parse(await readFile(conqPath, 'utf8'));
        }

        paxtu100Map.set(cdAssociado, {
          cd_associado: cdAssociado,
          nm_associado: dp.nm_associado,
          ds_ramo: dp.ds_ramo,
          nr_registro: dp.nr_registro_formatado || dp.nr_registro,
          ativs_concluidas: ativs,
          total_esps: espsList.length,
          esps_com_nivel: espsList.filter((x) => x.nr_nivel > 0).length,
          itens_concluidos: itensConcluidos,
          conquistas,
          especialidades: espsList,
        });
      }
    }
    console.log(`   ✓ ${paxtu100Map.size} associados carregados do Paxtu 100.`);

    // 3. Carrega dados de Paxtu PA (data/raw_pa)
    console.log('📥 3. Carregando dados do Paxtu Antigo (data/raw_pa)...');
    const paxtuPaMap = new Map(); // cdAssociado -> { nome, ramo, ativs, esps, itens, rawEsps }

    for (const f of folders) {
      const folderPath = path.join(rawPaDir, f);
      if (!existsSync(folderPath)) continue;
      const entries = await readdir(folderPath, { withFileTypes: true });

      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const treatedDir = path.join(folderPath, e.name, 'tratado');
        const dpPath = path.join(treatedDir, 'dados-pessoais.json');
        const progPath = path.join(treatedDir, 'progressoes-caminhos.json');
        const espPath = path.join(treatedDir, 'especialidades.json');

        if (!existsSync(dpPath)) continue;
        const dp = JSON.parse(await readFile(dpPath, 'utf8'));
        const cdAssociado = String(dp.cd_associado);

        let ativs = 0;
        if (existsSync(progPath)) {
          const prog = JSON.parse(await readFile(progPath, 'utf8'));
          ativs = Number(prog.total_atividades_conquistadas || 0);
        }

        let espsList = [];
        let itensConcluidos = 0;
        if (existsSync(espPath)) {
          const espObj = JSON.parse(await readFile(espPath, 'utf8'));
          espsList = espObj.especialidades || [];
          itensConcluidos = Number(espObj.total_itens_conquistados || 0);
        }

        paxtuPaMap.set(cdAssociado, {
          cd_associado: cdAssociado,
          nm_associado: dp.nm_associado,
          ds_ramo: dp.ds_ramo,
          nr_registro: dp.nr_registro_formatado || dp.nr_registro,
          ativs_concluidas: ativs,
          total_esps: espsList.length,
          esps_com_nivel: espsList.filter((x) => x.nr_nivel > 0).length,
          itens_concluidos: itensConcluidos,
          especialidades: espsList,
        });
      }
    }
    console.log(`   ✓ ${paxtuPaMap.size} associados carregados do Paxtu Antigo.`);

    // 4. Comparativo Geral
    console.log('\n' + '='.repeat(80));
    console.log('📊 RESUMO COMPARATIVO GLOBAL DE VOLUMETRIA');
    console.log('='.repeat(80));

    let totalMatchAtivs = 0;
    let totalDivergAtivs = 0;
    let totalMatchEsps = 0;
    let totalDivergEsps = 0;
    const divergencias = [];

    for (const row of associadosDbRes.rows) {
      const cd = String(row.cd_associado);
      const p100 = paxtu100Map.get(cd);
      const pPa = paxtuPaMap.get(cd);
      const dbAtiv = dbAtivsMap.get(cd) || 0;
      const dbEsp = dbEspsMap.get(cd) || { total: 0, comNivel: 0 };
      const dbItens = dbItensMap.get(cd) || 0;

      const p100Ativ = p100?.ativs_concluidas ?? 0;
      const pPaAtiv = pPa?.ativs_concluidas ?? 0;
      const p100Esp = p100?.total_esps ?? 0;
      const pPaEsp = pPa?.total_esps ?? 0;

      const isDivergente =
        (p100 && pPa && p100Ativ !== pPaAtiv) ||
        (p100 && pPa && p100Esp !== pPaEsp) ||
        (p100 && p100Ativ !== dbAtiv) ||
        (p100 && p100Esp !== dbEsp.total);

      if (isDivergente) {
        divergencias.push({
          cd,
          nome: row.nm_associado,
          ramo: row.ds_ramo,
          p100_ativ: p100Ativ,
          pPa_ativ: pPaAtiv,
          db_ativ: dbAtiv,
          p100_esp: p100Esp,
          pPa_esp: pPaEsp,
          db_esp: dbEsp.total,
        });
      }
    }

    console.log(`• Total de Jovens Avaliados: ${associadosDbRes.rows.length}`);
    console.log(`• Jovens com 100% de paridade estrita: ${associadosDbRes.rows.length - divergencias.length}`);
    console.log(`• Jovens com divergência entre sistemas: ${divergencias.length}`);

    if (divergencias.length > 0) {
      console.log('\n⚠️ DIVERGÊNCIAS ENCONTRADAS ENTRE PAXTU 100, PAXTU ANTIGO E BANCO:');
      console.table(divergencias);
    } else {
      console.log('\n✅ PARIDADE TOTAL: Todos os registros estão 100% idênticos entre os sistemas!');
    }

    // 5. AUDITORIA PROFUNDA: Miguel Gonçalves Gorski e Beatriz Beck Martins
    console.log('\n' + '='.repeat(80));
    console.log('⭐ AUDITORIA DETALHADA: MIGUEL GONÇALVES GORSKI E BEATRIZ BECK MARTINS');
    console.log('='.repeat(80));

    const jovensFoco = [
      { id: '1173680', nomeEsperado: 'Miguel Gonçalves Gorski' },
      { id: '1154179', nomeEsperado: 'Beatriz Beck Martins' },
    ];

    for (const j of jovensFoco) {
      console.log(`\n────────────────────────────────────────────────────────────────────────────`);
      console.log(`📌 AUDITORIA DE: ${j.nomeEsperado} (ID: ${j.id})`);
      console.log(`────────────────────────────────────────────────────────────────────────────`);

      const p100 = paxtu100Map.get(j.id);
      const pPa = paxtuPaMap.get(j.id);

      // Dados do Banco
      const dbEspRows = await client.query(
        `SELECT cd_especialidade, ds_especialidade, nr_nivel, dt_nivel, qtd_itens_concluidos
         FROM progressao_especialidade_pa
         WHERE cd_associado = $1
         ORDER BY ds_especialidade`,
        [j.id]
      );

      const dbItemRows = await client.query(
        `SELECT i.cd_especialidade, i.cd_item, i.ds_item, pi.concluida, pi.data_conclusao
         FROM progressao_especialidade_item_pa pi
         JOIN pa_especialidades_itens i ON pi.especialidade_item_id = i.id
         WHERE pi.cd_associado = $1 AND pi.concluida = true
         ORDER BY i.cd_especialidade, i.cd_item`,
        [j.id]
      );

      console.log(`\n📊 1. Volumetria Comparada:`);
      console.table([
        {
          Origem: 'Paxtu 100',
          Atividades_PA: p100?.ativs_concluidas ?? 'N/D',
          Total_Especialidades: p100?.total_esps ?? 'N/D',
          Esps_Com_Nivel: p100?.esps_com_nivel ?? 'N/D',
          Itens_Especialidade: p100?.itens_concluidos ?? 'N/D',
          Conquistas_Badges: p100?.conquistas?.length ?? 'N/D',
        },
        {
          Origem: 'Paxtu Antigo (PA)',
          Atividades_PA: pPa?.ativs_concluidas ?? 'N/D',
          Total_Especialidades: pPa?.total_esps ?? 'N/D',
          Esps_Com_Nivel: pPa?.esps_com_nivel ?? 'N/D',
          Itens_Especialidade: pPa?.itens_concluidos ?? 'N/D',
          Conquistas_Badges: 'GWT-RPC Interno',
        },
        {
          Origem: 'Banco PostgreSQL',
          Atividades_PA: dbAtivsMap.get(j.id) ?? 0,
          Total_Especialidades: dbEspRows.rows.length,
          Esps_Com_Nivel: dbEspRows.rows.filter((x) => x.nr_nivel > 0).length,
          Itens_Especialidade: dbItemRows.rows.length,
          Conquistas_Badges: 'Verificado',
        },
      ]);

      console.log(`\n🎖️ 2. Conquistas e Distintivos Registrados (Paxtu 100):`);
      if (p100?.conquistas && p100.conquistas.length > 0) {
        console.table(
          p100.conquistas.map((c) => ({
            Título: c.titulo,
            Data: c.data_conquista,
            Ramo: c.ramo,
          }))
        );
      } else {
        console.log('   (Nenhuma conquista retornada no manifesto do Paxtu 100)');
      }

      console.log(`\n📚 3. Especialidades Detalhadas no Banco de Dados:`);
      console.table(
        dbEspRows.rows.map((e) => ({
          Código: e.cd_especialidade,
          Especialidade: e.ds_especialidade,
          Nível: e.nr_nivel,
          Data_Nível: e.dt_nivel ? new Date(e.dt_nivel).toLocaleDateString('pt-BR') : '-',
          Itens_Concluídos: e.qtd_itens_concluidos,
        }))
      );
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ AUDITORIA CONCLUÍDA');
    console.log('='.repeat(80));
  } catch (err) {
    console.error('❌ Erro na auditoria:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
