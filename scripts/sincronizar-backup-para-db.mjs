import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const RAMO_MAP = {
  alcateia: 'LOBINHO',
  escoteiros: 'ESCOTEIRO',
  senior: 'SENIOR',
  pioneiros: 'PIONEIRO',
};

async function main() {
  console.log('='.repeat(70));
  console.log('🔄 SINCRONIZAÇÃO COMPLETA: BACKUP RAW -> POSTGRESQL (TODOS OS RAMOS)');
  console.log('='.repeat(70));

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não configurada no .env');
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    const rawDir = path.resolve(process.cwd(), 'data', 'raw');

    // 1. Carrega catálogo de atividades para resolução rápida
    console.log('\n📚 1. Carregando catálogo relacional de atividades e especialidades...');
    const ativRes = await client.query(`
      SELECT id, ds_ramo, cd_caminho_paxtu, cd_atividade_paxtu, identificacao
      FROM pa_atividades
    `);

    // Map: ds_ramo + '_' + cd_caminho_paxtu + '_' + cd_atividade_paxtu -> id
    const ativMap = new Map();
    // Map: ds_ramo + '_' + cd_atividade_paxtu -> id
    const ativCodeMap = new Map();
    // Map: ds_ramo + '_' + identificacao -> id
    const ativIdentMap = new Map();

    for (const row of ativRes.rows) {
      if (row.cd_caminho_paxtu && row.cd_atividade_paxtu) {
        ativMap.set(`${row.ds_ramo}_${row.cd_caminho_paxtu}_${row.cd_atividade_paxtu}`, row.id);
      }
      if (row.cd_atividade_paxtu) {
        ativCodeMap.set(`${row.ds_ramo}_${row.cd_atividade_paxtu}`, row.id);
      }
      if (row.identificacao) {
        ativIdentMap.set(`${row.ds_ramo}_${row.identificacao}`, row.id);
      }
    }
    console.log(`   ✓ ${ativRes.rows.length} atividades de catálogo mapeadas.`);

    // 2. Carrega catálogo de especialidades e itens
    const espRes = await client.query(`SELECT id, cd_especialidade FROM pa_especialidades`);
    const espMap = new Map(espRes.rows.map((r) => [String(r.cd_especialidade), r.id]));

    const itemRes = await client.query(`SELECT id, cd_especialidade, cd_item FROM pa_especialidades_itens`);
    const itemMap = new Map(itemRes.rows.map((r) => [`${r.cd_especialidade}_${r.cd_item}`, r.id]));
    console.log(`   ✓ ${espRes.rows.length} especialidades e ${itemRes.rows.length} itens mapeados.`);

    // 3. Itera pelas pastas dos ramos
    const folders = ['alcateia', 'escoteiros', 'senior', 'pioneiros'];
    let totalJovens = 0;
    let totalAtividadesUpsert = 0;
    let totalEspecialidadesUpsert = 0;
    let totalItensUpsert = 0;

    for (const folder of folders) {
      const ramoFolder = path.join(rawDir, folder);
      if (!existsSync(ramoFolder)) continue;

      const dsRamo = RAMO_MAP[folder];
      const entries = await readdir(ramoFolder, { withFileTypes: true });
      const youthDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

      console.log(`\n📂 Ramo ${dsRamo} (${folder}): ${youthDirs.length} jovens para sincronizar.`);

      for (const yDir of youthDirs) {
        const fullDir = path.join(ramoFolder, yDir);
        const tratadoDir = path.join(fullDir, 'tratado');
        const dadosPessoaisPath = path.join(tratadoDir, 'dados-pessoais.json');
        const progressoesPath = path.join(tratadoDir, 'progressoes-atividades.json');
        const especialidadesPath = path.join(tratadoDir, 'especialidades.json');

        if (!existsSync(dadosPessoaisPath)) continue;

        const dadosPessoaisRaw = await readFile(dadosPessoaisPath, 'utf8');
        const dadosPessoais = JSON.parse(dadosPessoaisRaw);
        const cdAssociado = String(dadosPessoais.cd_associado);
        const nmAssociado = dadosPessoais.nm_associado || `Associado ${cdAssociado}`;

        // Upsert Associado
        const dtNasc = dadosPessoais.dt_nascimento ? new Date(dadosPessoais.dt_nascimento) : null;
        const validDtNasc = dtNasc && !isNaN(dtNasc.getTime()) ? dtNasc : null;

        await client.query(
          `INSERT INTO associados (
             cd_associado, nm_associado, nr_registro_formatado, ds_categoria, ds_ramo,
             fl_status, dt_nascimento, ds_email, ds_telefone_cel, dados_cadastrais_completos
           )
           VALUES ($1, $2, $3, $4, $5::"Ramo", $6, $7, $8, $9, $10)
           ON CONFLICT (cd_associado) DO UPDATE SET
             nm_associado = EXCLUDED.nm_associado,
             nr_registro_formatado = EXCLUDED.nr_registro_formatado,
             ds_ramo = EXCLUDED.ds_ramo,
             fl_status = EXCLUDED.fl_status,
             dt_nascimento = EXCLUDED.dt_nascimento,
             ds_email = EXCLUDED.ds_email,
             ds_telefone_cel = EXCLUDED.ds_telefone_cel,
             dados_cadastrais_completos = EXCLUDED.dados_cadastrais_completos`,
          [
            cdAssociado,
            nmAssociado,
            dadosPessoais.nr_registro_formatado || dadosPessoais.nr_registro || null,
            dadosPessoais.ds_categoria === 'Escotista' ? 'ESCOTISTA' : 'BENEFICIARIO',
            dsRamo,
            'ATIVO',
            validDtNasc,
            dadosPessoais.ds_email || null,
            dadosPessoais.ds_telefone_cel || null,
            JSON.stringify(dadosPessoais),
          ]
        );
        totalJovens++;

        // Upsert Progressao PA (Atividades)
        if (existsSync(progressoesPath)) {
          const progRaw = await readFile(progressoesPath, 'utf8');
          const prog = JSON.parse(progRaw);
          const caminhos = prog.caminhos || [];

          for (const cam of caminhos) {
            const cId = String(cam.caminho_id || '');
            const atvs = cam.atividades || [];

            for (const atv of atvs) {
              const code = String(atv.codigo || atv.id || '');
              const atvDbId =
                ativMap.get(`${dsRamo}_${cId}_${code}`) ||
                ativCodeMap.get(`${dsRamo}_${code}`) ||
                ativIdentMap.get(`${dsRamo}_${code}`);

              if (atvDbId) {
                const isConcluida = Boolean(atv.concluida);
                const statusEsc = atv.status_escotista || (isConcluida ? 'confirmadoEscotista' : null);
                const dt = atv.data_conclusao ? new Date(atv.data_conclusao) : null;
                const validDt = dt && !isNaN(dt.getTime()) ? dt : null;

                await client.query(
                  `INSERT INTO progressao_pa (cd_associado, atividade_id, concluida, status_escotista, data_conclusao)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (cd_associado, atividade_id) DO UPDATE SET
                     concluida = EXCLUDED.concluida,
                     status_escotista = EXCLUDED.status_escotista,
                     data_conclusao = EXCLUDED.data_conclusao`,
                  [cdAssociado, atvDbId, isConcluida, statusEsc, validDt]
                );
                totalAtividadesUpsert++;
              }
            }
          }
        }

        // Upsert Especialidades & Itens
        if (existsSync(especialidadesPath)) {
          const espRaw = await readFile(especialidadesPath, 'utf8');
          const esps = JSON.parse(espRaw);

          for (const esp of esps) {
            const cdEsp = String(esp.cd_especialidade);
            const espDbId = espMap.get(cdEsp) || null;
            const dsEsp = esp.ds_especialidade || `Especialidade ${cdEsp}`;
            const nrNivel = parseInt(esp.nr_nivel, 10) || 0;
            const dtNivel = esp.dt_nivel ? new Date(esp.dt_nivel) : null;
            const validDtNivel = dtNivel && !isNaN(dtNivel.getTime()) ? dtNivel : null;
            const itens = esp.itens || [];
            const qtdItens = esp.itens_conquistados ?? itens.filter((i) => i.concluido).length;

            await client.query(
              `INSERT INTO progressao_especialidade_pa (
                 cd_associado, especialidade_id, cd_especialidade, ds_especialidade,
                 nr_nivel, dt_nivel, qtd_itens_concluidos, itens_detalhados
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (cd_associado, cd_especialidade) DO UPDATE SET
                 especialidade_id = EXCLUDED.especialidade_id,
                 ds_especialidade = EXCLUDED.ds_especialidade,
                 nr_nivel = EXCLUDED.nr_nivel,
                 dt_nivel = EXCLUDED.dt_nivel,
                 qtd_itens_concluidos = EXCLUDED.qtd_itens_concluidos,
                 itens_detalhados = EXCLUDED.itens_detalhados`,
              [cdAssociado, espDbId, cdEsp, dsEsp, nrNivel, validDtNivel, qtdItens, JSON.stringify(itens)]
            );
            totalEspecialidadesUpsert++;

            // Itens individuais
            for (const it of itens) {
              const cdItem = String(it.cd_item);
              const itemId = itemMap.get(`${cdEsp}_${cdItem}`);
              if (!itemId) continue;

              const isConcluido = Boolean(it.concluido || it.dt_item);
              const dtItem = it.dt_item ? new Date(it.dt_item) : null;
              const validDtItem = dtItem && !isNaN(dtItem.getTime()) ? dtItem : null;

              await client.query(
                `INSERT INTO progressao_especialidade_item_pa (
                   cd_associado, especialidade_item_id, concluida, data_conclusao
                 )
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (cd_associado, especialidade_item_id) DO UPDATE SET
                   concluida = EXCLUDED.concluida,
                   data_conclusao = EXCLUDED.data_conclusao`,
                [cdAssociado, itemId, isConcluido, isConcluido ? validDtItem : null]
              );
              totalItensUpsert++;
            }
          }
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ SINCRONIZAÇÃO COMPLETA DO BANCO DE DADOS FINALIZADA COM SUCESSO!');
    console.log(`• Total de Associados sincronizados: ${totalJovens}`);
    console.log(`• Total de Atividades de Progressão inseridas/atualizadas: ${totalAtividadesUpsert}`);
    console.log(`• Total de Especialidades inseridas/atualizadas: ${totalEspecialidadesUpsert}`);
    console.log(`• Total de Itens de Especialidade inseridos/atualizados: ${totalItensUpsert}`);
    console.log('='.repeat(70));
  } catch (err) {
    console.error('❌ Erro na sincronização:', err);
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
