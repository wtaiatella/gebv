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
  console.log('='.repeat(80));
  console.log('🔄 MERGE "OR" TOTAL: PAXTU 100 + PAXTU ANTIGO (PA) -> POSTGRESQL');
  console.log('   Regra: Se qualquer um dos dois sistemas marcou a atividade/especialidade,');
  console.log('          ela é consolidada como CONCLUÍDA no banco de dados.');
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

    // 1. Mapear catálogo de atividades do banco
    console.log('\n📚 1. Mapeando catálogo completo de atividades (todos os ramos)...');
    const ativRes = await client.query(`
      SELECT id, ds_ramo, cd_caminho_paxtu, cd_atividade_paxtu, identificacao
      FROM pa_atividades
    `);

    // Mapeamentos flexíveis:
    // (ds_ramo, cd_caminho, cd_atividade) -> id
    const ativRamoCamMap = new Map();
    // (cd_caminho, cd_atividade) -> id
    const ativCamMap = new Map();
    // (ds_ramo, cd_atividade) -> id
    const ativRamoCodeMap = new Map();
    // cd_atividade isolado -> id
    const ativCodeMap = new Map();

    for (const r of ativRes.rows) {
      const cCam = String(r.cd_caminho_paxtu || '');
      const cAtv = String(r.cd_atividade_paxtu || '');
      if (cCam && cAtv) {
        ativRamoCamMap.set(`${r.ds_ramo}_${cCam}_${cAtv}`, r.id);
        ativCamMap.set(`${cCam}_${cAtv}`, r.id);
      }
      if (cAtv) {
        ativRamoCodeMap.set(`${r.ds_ramo}_${cAtv}`, r.id);
        ativCodeMap.set(cAtv, r.id);
      }
    }
    console.log(`   ✓ ${ativRes.rows.length} atividades de catálogo prontas.`);

    // 2. Mapear especialidades e itens
    const espRes = await client.query(`SELECT id, cd_especialidade, ds_especialidade FROM pa_especialidades`);
    const espMap = new Map(espRes.rows.map((r) => [String(r.cd_especialidade), r.id]));

    const itemRes = await client.query(`SELECT id, cd_especialidade, cd_item FROM pa_especialidades_itens`);
    const itemMap = new Map(itemRes.rows.map((r) => [`${r.cd_especialidade}_${r.cd_item}`, r.id]));
    console.log(`   ✓ ${espRes.rows.length} especialidades e ${itemRes.rows.length} itens prontos.`);

    // 3. Coleta dados de ambos os backups indexados por cd_associado
    console.log('\n📦 2. Indexando dados de Paxtu 100 e Paxtu Antigo por associado...');

    const folders = ['alcateia', 'escoteiros', 'senior', 'pioneiros'];
    const todosAssociados = new Map(); // cdAssociado -> { dadosPessoais, ramoFolder, p100Prog, pPaProg, p100Esp, pPaEsp }

    // Leitura Paxtu 100
    for (const f of folders) {
      const fDir = path.join(rawDir, f);
      if (!existsSync(fDir)) continue;
      for (const d of await readdir(fDir)) {
        const trDir = path.join(fDir, d, 'tratado');
        const dpPath = path.join(trDir, 'dados-pessoais.json');
        if (!existsSync(dpPath)) continue;

        const dp = JSON.parse(await readFile(dpPath, 'utf8'));
        const cd = String(dp.cd_associado);

        const progPath = path.join(trDir, 'progressoes-atividades.json');
        const espPath = path.join(trDir, 'especialidades.json');
        const conqPath = path.join(trDir, 'conquistas.json');

        const p100Prog = existsSync(progPath) ? JSON.parse(await readFile(progPath, 'utf8')) : null;
        const p100Esp = existsSync(espPath) ? JSON.parse(await readFile(espPath, 'utf8')) : [];
        const p100Conq = existsSync(conqPath) ? JSON.parse(await readFile(conqPath, 'utf8')) : [];
        dp.conquistas = p100Conq;

        todosAssociados.set(cd, {
          cd_associado: cd,
          dadosPessoais: dp,
          ramoFolder: f,
          dsRamo: RAMO_MAP[f],
          p100Prog,
          p100Esp,
          pPaProg: null,
          pPaEsp: [],
        });
      }
    }

    // Leitura Paxtu Antigo
    for (const f of folders) {
      const fDir = path.join(rawPaDir, f);
      if (!existsSync(fDir)) continue;
      for (const d of await readdir(fDir)) {
        const trDir = path.join(fDir, d, 'tratado');
        const dpPath = path.join(trDir, 'dados-pessoais.json');
        if (!existsSync(dpPath)) continue;

        const dp = JSON.parse(await readFile(dpPath, 'utf8'));
        const cd = String(dp.cd_associado);

        const progPath = path.join(trDir, 'progressoes-caminhos.json');
        const espPath = path.join(trDir, 'especialidades.json');

        const pPaProg = existsSync(progPath) ? JSON.parse(await readFile(progPath, 'utf8')) : null;
        let pPaEsp = [];
        if (existsSync(espPath)) {
          const rawE = JSON.parse(await readFile(espPath, 'utf8'));
          pPaEsp = rawE.especialidades || [];
        }

        if (todosAssociados.has(cd)) {
          const entry = todosAssociados.get(cd);
          entry.pPaProg = pPaProg;
          entry.pPaEsp = pPaEsp;
        } else {
          todosAssociados.set(cd, {
            cd_associado: cd,
            dadosPessoais: dp,
            ramoFolder: f,
            dsRamo: RAMO_MAP[f],
            p100Prog: null,
            p100Esp: [],
            pPaProg,
            pPaEsp,
          });
        }
      }
    }

    console.log(`   ✓ ${todosAssociados.size} associados consolidados para o Merge OR.`);

    // 4. Executa o Merge OR no banco de dados
    console.log('\n🚀 3. Executando Merge OR no PostgreSQL...');

    let totalAtividadesConsolidadas = 0;
    let totalEspecialidadesConsolidadas = 0;
    let totalItensConsolidados = 0;
    let atividadesMarcadasP100 = 0;
    let atividadesMarcadasPPa = 0;
    let atividadesMarcadasEmAmbos = 0;
    let atividadesApenasPPa = 0;
    let atividadesApenasP100 = 0;

    for (const [cdAssociado, entry] of todosAssociados.entries()) {
      const dp = entry.dadosPessoais;
      const dsRamo = entry.dsRamo;

      // 4.1 Upsert Associado
      const dtNasc = dp.dt_nascimento ? new Date(dp.dt_nascimento) : null;
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
          dp.nm_associado,
          dp.nr_registro_formatado || dp.nr_registro || null,
          dp.ds_categoria === 'Escotista' ? 'ESCOTISTA' : 'BENEFICIARIO',
          dsRamo,
          'ATIVO',
          validDtNasc,
          dp.ds_email || null,
          dp.ds_telefone_cel || null,
          JSON.stringify(dp),
        ]
      );

      // 4.2 Merge OR de Atividades de Progressão
      // Mapa final: atividadeDbId -> { concluida, status_escotista, data_conclusao, origem }
      const mapaAtividadesOr = new Map();

      // Ingestão do Paxtu 100
      if (entry.p100Prog) {
        for (const cam of entry.p100Prog.caminhos || []) {
          const cId = String(cam.caminho_id || '').replace('caminho_', '');
          for (const atv of cam.atividades || []) {
            const code = String(atv.codigo || atv.id || '');
            const atvDbId =
              ativRamoCamMap.get(`${dsRamo}_${cId}_${code}`) ||
              ativCamMap.get(`${cId}_${code}`) ||
              ativRamoCodeMap.get(`${dsRamo}_${code}`) ||
              ativCodeMap.get(code);

            if (atvDbId) {
              const isConcluida = Boolean(atv.concluida);
              if (isConcluida) {
                atividadesMarcadasP100++;
                mapaAtividadesOr.set(atvDbId, {
                  concluida: true,
                  status_escotista: atv.status_escotista || 'confirmadoEscotista',
                  data_conclusao: atv.data_conclusao ? new Date(atv.data_conclusao) : null,
                  origem: 'p100',
                });
              } else if (!mapaAtividadesOr.has(atvDbId)) {
                mapaAtividadesOr.set(atvDbId, {
                  concluida: false,
                  status_escotista: atv.status_escotista || null,
                  data_conclusao: null,
                  origem: 'p100',
                });
              }
            }
          }
        }
      }

      // Ingestão do Paxtu Antigo (Faz o OR)
      if (entry.pPaProg) {
        for (const cam of entry.pPaProg.caminhos || []) {
          for (const atv of cam.atividades || []) {
            const cId = String(atv.cd_caminho || '');
            const code = String(atv.cd_atividade || '');
            const atvDbId =
              ativCamMap.get(`${cId}_${code}`) ||
              ativRamoCamMap.get(`ESCOTEIRO_${cId}_${code}`) ||
              ativCodeMap.get(code);

            if (atvDbId) {
              const isConcluida = Boolean(atv.fl_check_escotista);
              if (isConcluida) {
                atividadesMarcadasPPa++;
                const existing = mapaAtividadesOr.get(atvDbId);
                if (existing && existing.concluida) {
                  atividadesMarcadasEmAmbos++;
                  // Se data do P100 for nula ou anterior, mantém a mais precisa
                  if (!existing.data_conclusao && atv.dt_check_escotista) {
                    existing.data_conclusao = new Date(atv.dt_check_escotista);
                  }
                } else {
                  if (existing) {
                    atividadesApenasPPa++;
                  }
                  mapaAtividadesOr.set(atvDbId, {
                    concluida: true,
                    status_escotista: atv.check_escotista || 'confirmadoEscotista',
                    data_conclusao: atv.dt_check_escotista ? new Date(atv.dt_check_escotista) : null,
                    origem: 'paxtu_pa',
                  });
                }
              }
            }
          }
        }
      }

      // Salva no banco progressao_pa
      for (const [ativDbId, data] of mapaAtividadesOr.entries()) {
        const validDt = data.data_conclusao && !isNaN(data.data_conclusao.getTime()) ? data.data_conclusao : null;
        await client.query(
          `INSERT INTO progressao_pa (cd_associado, atividade_id, concluida, status_escotista, data_conclusao)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (cd_associado, atividade_id) DO UPDATE SET
             concluida = EXCLUDED.concluida,
             status_escotista = EXCLUDED.status_escotista,
             data_conclusao = EXCLUDED.data_conclusao`,
          [cdAssociado, ativDbId, data.concluida, data.status_escotista, validDt]
        );
        totalAtividadesConsolidadas++;
      }

      // 4.3 Merge OR de Especialidades e Itens
      // Mapa final: cd_especialidade -> { nr_nivel, dt_nivel, ds_especialidade, itensMap }
      const mapaEspsOr = new Map();

      // P100 Especialidades
      for (const esp of entry.p100Esp || []) {
        const cdEsp = String(esp.cd_especialidade);
        const nivel = parseInt(esp.nr_nivel, 10) || 0;
        const dtNivel = esp.dt_nivel ? new Date(esp.dt_nivel) : null;
        const itensMap = new Map();

        for (const it of esp.itens || []) {
          const cdItem = String(it.cd_item);
          itensMap.set(cdItem, {
            cd_item: cdItem,
            concluido: Boolean(it.concluido || it.dt_item),
            dt_item: it.dt_item ? new Date(it.dt_item) : null,
          });
        }

        mapaEspsOr.set(cdEsp, {
          cd_especialidade: cdEsp,
          ds_especialidade: esp.ds_especialidade || `Especialidade ${cdEsp}`,
          nr_nivel: nivel,
          dt_nivel: dtNivel,
          itensMap,
        });
      }

      // Paxtu Antigo Especialidades (Merge OR)
      for (const esp of entry.pPaEsp || []) {
        const cdEsp = String(esp.cd_especialidade);
        const nivel = parseInt(esp.nr_nivel, 10) || 0;
        const dtNivel = esp.dt_nivel ? new Date(esp.dt_nivel) : null;

        if (mapaEspsOr.has(cdEsp)) {
          const existing = mapaEspsOr.get(cdEsp);
          // Fica com o maior nível entre os dois sistemas
          if (nivel > existing.nr_nivel) {
            existing.nr_nivel = nivel;
            existing.dt_nivel = dtNivel;
          }
          // Merge OR dos itens
          for (const it of esp.itens || []) {
            const cdItem = String(it.cd_item);
            const isConcluido = Boolean(it.dt_item);
            const dtItem = it.dt_item ? new Date(it.dt_item) : null;

            if (existing.itensMap.has(cdItem)) {
              const exIt = existing.itensMap.get(cdItem);
              if (!exIt.concluido && isConcluido) {
                exIt.concluido = true;
                exIt.dt_item = dtItem;
              }
            } else {
              existing.itensMap.set(cdItem, {
                cd_item: cdItem,
                concluido: isConcluido,
                dt_item: dtItem,
              });
            }
          }
        } else {
          // Especialidade que só existia no PA
          const itensMap = new Map();
          for (const it of esp.itens || []) {
            const cdItem = String(it.cd_item);
            itensMap.set(cdItem, {
              cd_item: cdItem,
              concluido: Boolean(it.dt_item),
              dt_item: it.dt_item ? new Date(it.dt_item) : null,
            });
          }
          mapaEspsOr.set(cdEsp, {
            cd_especialidade: cdEsp,
            ds_especialidade: esp.ds_especialidade || `Especialidade ${cdEsp}`,
            nr_nivel: nivel,
            dt_nivel: dtNivel,
            itensMap,
          });
        }
      }

      // Salva especialidades e itens no banco
      for (const [cdEsp, espData] of mapaEspsOr.entries()) {
        const espDbId = espMap.get(cdEsp) || null;
        const validDtNivel = espData.dt_nivel && !isNaN(espData.dt_nivel.getTime()) ? espData.dt_nivel : null;
        const itensArray = Array.from(espData.itensMap.values());
        const concluidosCount = itensArray.filter((i) => i.concluido).length;

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
          [cdAssociado, espDbId, cdEsp, espData.ds_especialidade, espData.nr_nivel, validDtNivel, concluidosCount, JSON.stringify(itensArray)]
        );
        totalEspecialidadesConsolidadas++;

        for (const it of itensArray) {
          const itemId = itemMap.get(`${cdEsp}_${it.cd_item}`);
          if (!itemId) continue;

          const validDt = it.dt_item && !isNaN(it.dt_item.getTime()) ? it.dt_item : null;
          await client.query(
            `INSERT INTO progressao_especialidade_item_pa (
               cd_associado, especialidade_item_id, concluida, data_conclusao
             )
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (cd_associado, especialidade_item_id) DO UPDATE SET
               concluida = EXCLUDED.concluida,
               data_conclusao = EXCLUDED.data_conclusao`,
            [cdAssociado, itemId, it.concluido, it.concluido ? validDt : null]
          );
          totalItensConsolidados++;
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('🎉 RESULTADO DO MERGE "OR" CONCLUÍDO COM SUCESSO!');
    console.log('='.repeat(80));
    console.log(`• Total de Associados Processados: ${todosAssociados.size}`);
    console.log(`• Atividades de Progressão inseridas/consolidadas no PostgreSQL: ${totalAtividadesConsolidadas}`);
    console.log(`• Especialidades Consolidadas (com maior nível e união de itens): ${totalEspecialidadesConsolidadas}`);
    console.log(`• Itens de Especialidade Inseridos/Atualizados: ${totalItensConsolidados}`);
    console.log('='.repeat(80));
  } catch (err) {
    console.error('❌ Erro no Merge OR:', err);
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
