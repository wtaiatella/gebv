import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extrairEspecialidadesPnDaAcao(ds_acao) {
  if (!ds_acao) return null;
  const match = ds_acao.match(
    /Conquistar (?:ao menos uma das seguintes|a seguinte|as seguintes)?\s*(?:especialidades?|insígnias?|especialidades? ou insígnias?|insígnias? ou especialidades?|especialidades?\/insígnias?)\s*no nível\s*(\d)\+:\s*(.+)$/i
  );
  if (!match) return null;
  const nivel_exigido = parseInt(match[1], 10) || 1;
  const rawList = match[2];
  const protectedList = rawList
    .replace(/Reduzir,\s*Reciclar,\s*Reutilizar/gi, 'Reduzir###COMMA###Reciclar###COMMA###Reutilizar')
    .replace(/Reduzir,\s*Reciclar e Reutilizar/gi, 'Reduzir###COMMA###Reciclar e Reutilizar');
  const especialidades = protectedList
    .split(',')
    .map((s) => s.replace(/###COMMA###/g, ', ').trim())
    .filter((s) => s.length > 0);
  return { nivel_exigido, especialidades };
}

async function seedPnSenior() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ ERRO: Defina DATABASE_URL no .env');
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('🧭 SEED CATÁLOGO NOVO PROGRAMA (PN) — RAMO SÊNIOR');
  console.log('='.repeat(80));

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    const baseDir = path.join(process.cwd(), 'data', 'catalogo');
    const catPath = path.join(baseDir, 'pn_catalogo_senior.json');
    const reqPath = path.join(baseDir, 'pn_equivalencia_regras_senior.json');

    console.log(`\n1. Lendo catálogo gerado em:`);
    console.log(`   - ${catPath}`);
    console.log(`   - ${reqPath}`);

    const [catRaw, reqRaw] = await Promise.all([
      readFile(catPath, 'utf-8'),
      readFile(reqPath, 'utf-8'),
    ]);

    const catalogo = JSON.parse(catRaw);
    const equivalencias = JSON.parse(reqRaw);

    // Guardrails de integridade
    if (!catalogo.eixos || catalogo.eixos.length !== 4) {
      throw new Error(`ABORTADO: Esperado 4 eixos para o Ramo Sênior. Encontrados: ${catalogo.eixos?.length}`);
    }
    if (!catalogo.blocos || catalogo.blocos.length !== 18) {
      throw new Error(`ABORTADO: Esperado 18 blocos para o Ramo Sênior. Encontrados: ${catalogo.blocos?.length}`);
    }
    if (!catalogo.acoes || catalogo.acoes.length !== 249) {
      throw new Error(`ABORTADO: Total de ações (${catalogo.acoes?.length}) diferente do esperado (249).`);
    }
    if (equivalencias.regras.length !== catalogo.acoes.length) {
      throw new Error(`ABORTADO: Regras (${equivalencias.regras.length}) não coincidem 1:1 com ações (${catalogo.acoes.length}).`);
    }

    console.log(`\n✓ Guardrails validados: ${catalogo.eixos.length} eixos, ${catalogo.blocos.length} blocos e ${catalogo.acoes.length} ações.`);

    await client.query('BEGIN');
    const dsRamo = 'SENIOR';

    console.log(`\n2. Limpando catálogo anterior do PN para o ramo ${dsRamo}...`);
    await client.query(`
      DELETE FROM pn_equivalencia_regras 
      WHERE acao_pn_id IN (SELECT id FROM pn_acoes_educativas WHERE ds_ramo = $1)
    `, [dsRamo]);

    await client.query(`DELETE FROM pn_acoes_educativas WHERE ds_ramo = $1`, [dsRamo]);
    await client.query(`DELETE FROM pn_blocos WHERE ds_ramo = $1`, [dsRamo]);

    console.log(`3. Populando Eixos do PN (pn_eixos) para ${dsRamo}...`);
    for (let i = 0; i < catalogo.eixos.length; i++) {
      const nmEixo = catalogo.eixos[i];
      await client.query(
        `INSERT INTO pn_eixos (ds_ramo, nm_eixo, nr_ordem)
         VALUES ($1, $2, $3)
         ON CONFLICT (ds_ramo, nm_eixo) DO UPDATE SET nr_ordem = EXCLUDED.nr_ordem`,
        [dsRamo, nmEixo, i + 1]
      );
    }

    const eixosRes = await client.query(`SELECT id, nm_eixo FROM pn_eixos WHERE ds_ramo = $1`, [dsRamo]);
    const eixoMap = new Map(eixosRes.rows.map((r) => [r.nm_eixo.toLowerCase(), r.id]));

    console.log(`4. Populando 18 Blocos do PN (pn_blocos) para ${dsRamo}...`);
    for (const b of catalogo.blocos) {
      const eixoId = eixoMap.get(b.eixo.toLowerCase());
      if (!eixoId) {
        throw new Error(`Eixo não encontrado no mapa: ${b.eixo}`);
      }

      await client.query(
        `INSERT INTO pn_blocos (
           ds_ramo, eixo_id, nm_bloco, ds_intencionalidade,
           nr_acoes_fixas_obrigatorias, nr_acoes_variaveis_exigidas, nr_ordem
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (eixo_id, nm_bloco) DO UPDATE SET
           ds_ramo = EXCLUDED.ds_ramo,
           ds_intencionalidade = EXCLUDED.ds_intencionalidade,
           nr_acoes_fixas_obrigatorias = EXCLUDED.nr_acoes_fixas_obrigatorias,
           nr_acoes_variaveis_exigidas = EXCLUDED.nr_acoes_variaveis_exigidas,
           nr_ordem = EXCLUDED.nr_ordem`,
        [
          dsRamo,
          eixoId,
          b.bloco,
          b.ds_intencionalidade || '',
          b.nr_acoes_fixas_obrigatorias || 0,
          b.nr_acoes_variaveis_exigidas || 0,
          b.nr_ordem || 0,
        ]
      );
    }

    const blocosRes = await client.query(`SELECT id, nm_bloco FROM pn_blocos WHERE ds_ramo = $1`, [dsRamo]);
    const blocoMap = new Map(blocosRes.rows.map((r) => [r.nm_bloco.toLowerCase(), r.id]));

    console.log(`\n4.1. Garantindo integridade de pn_especialidades para todas as especialidades e insígnias do Sênior...`);
    const eixosGeraisRes = await client.query(`SELECT id, nm_eixo FROM pn_eixos WHERE ds_ramo = 'ESCOTEIRO' ORDER BY id`);
    const eixosGeraisMap = new Map(eixosGeraisRes.rows.map((r) => [r.nm_eixo.toLowerCase(), r.id]));

    let totalEspInseridas = 0;
    for (const ac of catalogo.acoes) {
      const parsed = extrairEspecialidadesPnDaAcao(ac.ds_acao);
      if (!parsed) continue;

      const nomesParaVerificar = [...parsed.especialidades];
      if (nomesParaVerificar.includes('Reduzir, Reciclar, Reutilizar') && !nomesParaVerificar.includes('Reduzir, Reciclar e Reutilizar')) {
        nomesParaVerificar.push('Reduzir, Reciclar e Reutilizar');
      }

      for (const espNome of nomesParaVerificar) {
        const checkRes = await client.query(
          `SELECT id FROM pn_especialidades WHERE LOWER(ds_especialidade) = LOWER($1)`,
          [espNome]
        );

        if (checkRes.rows.length === 0) {
          const s = slugify(espNome);
          const eixoRefId = eixosGeraisMap.get(ac.eixo.toLowerCase()) || eixoMap.get(ac.eixo.toLowerCase()) || null;

          await client.query(
            `INSERT INTO pn_especialidades (
               cd_especialidade, ds_especialidade, slug, eixo_id, ramo, total_itens, meta_nivel_1, meta_nivel_2
             )
             VALUES ($1, $2, $3, $4, 'SENIOR_PIONEIRO', 0, 1, 1)
             ON CONFLICT (slug) DO UPDATE SET ds_especialidade = EXCLUDED.ds_especialidade`,
            [s, espNome, s, eixoRefId]
          );
          totalEspInseridas++;
          console.log(`   + Especialidade/Insígnia cadastrada em pn_especialidades: "${espNome}" (slug: ${s})`);
        }
      }
    }
    console.log(`✓ Verificação de especialidades concluída (+${totalEspInseridas} novas cadastradas).`);

    console.log(`\n5. Populando ${catalogo.acoes.length} Ações Educativas (pn_acoes_educativas) para ${dsRamo}...`);
    const acoesInseridas = [];

    for (let i = 0; i < catalogo.acoes.length; i++) {
      const ac = catalogo.acoes[i];
      const blocoId = blocoMap.get(ac.bloco.toLowerCase());
      if (!blocoId) {
        throw new Error(`Bloco não encontrado no mapa para a ação: ${ac.bloco}`);
      }

      let tpAcao = 'VARIAVEL';
      if (ac.tp_acao === 'Fixa') tpAcao = 'FIXA';
      else if (ac.tp_acao === 'Substitutiva') tpAcao = 'SUBSTITUTIVA';
      else if (ac.tp_acao === 'PA' || ac.modalidade === 'PA') tpAcao = 'PA';

      let modalidade = 'BASICO';
      if (ac.modalidade === 'Ar') modalidade = 'AR';
      else if (ac.modalidade === 'Mar') modalidade = 'MAR';

      const acRes = await client.query(
        `INSERT INTO pn_acoes_educativas (
           ds_ramo, bloco_id, tp_acao, modalidade, ds_acao, regra_qtd_texto, nr_ordem
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          dsRamo,
          blocoId,
          tpAcao,
          modalidade,
          ac.ds_acao,
          ac.regra_qtd_texto || null,
          i + 1,
        ]
      );

      const acId = acRes.rows[0].id;
      acoesInseridas.push({
        id: acId,
        chave: ac.chave,
        blocoId,
        tpAcao,
        modalidade,
        dsAcao: ac.ds_acao,
      });
    }

    console.log(`6. Populando Regras de Equivalência para as ${acoesInseridas.length} ações...`);
    
    // Mapeamento de PA atividades por identificacao para enriquecimento do detalhes_regra
    const paAtivRes = await client.query(`SELECT id, identificacao FROM pa_atividades WHERE ds_ramo = $1`, [dsRamo]);
    const paAtivIdMap = new Map(paAtivRes.rows.map((r) => [r.identificacao, r.id]));

    function enrichDetalhesRegra(dr) {
      if (!dr) return dr;
      if (dr.tipo === 'PROGRESSOES' && dr.item) {
        const ativId = paAtivIdMap.get(dr.item.identificacao);
        if (ativId) dr.item.pa_atividade_id = ativId;
      }
      return dr;
    }

    const regrasPorChave = new Map(
      equivalencias.regras.map((r) => [r.chave, r])
    );

    let countProg = 0;
    let countSemEq = 0;
    for (const ac of acoesInseridas) {
      const directRegra = regrasPorChave.get(ac.chave);
      const operacao = directRegra?.operacao || 'SEM_EQUIVALENCIA';
      const descricaoOrigem = directRegra?.descricao_origem || 'Sem equivalência mapeada';
      const flRequerValidacaoManual = directRegra?.fl_requer_validacao_manual !== undefined ? directRegra.fl_requer_validacao_manual : true;
      const detalhesRegra = enrichDetalhesRegra(
        directRegra?.detalhes_regra
          ? JSON.parse(JSON.stringify(directRegra.detalhes_regra))
          : { tipo: operacao }
      );

      if (operacao === 'PROGRESSOES') countProg++;
      else countSemEq++;

      await client.query(
        `INSERT INTO pn_equivalencia_regras (
           acao_pn_id, operacao, descricao_origem, fl_requer_validacao_manual, detalhes_regra
         )
         VALUES ($1, $2::"OperacaoEquivalencia", $3, $4, $5)`,
        [
          ac.id,
          operacao,
          descricaoOrigem,
          flRequerValidacaoManual,
          JSON.stringify(detalhesRegra),
        ]
      );
    }
    console.log(`   ✓ Regras inseridas: ${countProg} PROGRESSOES (PA), ${countSemEq} SEM_EQUIVALENCIA.`);

    await client.query('COMMIT');

    console.log('\n' + '='.repeat(80));
    console.log('🎉 SEED DO NOVO PROGRAMA (RAMO SÊNIOR) CONCLUÍDO COM SUCESSO!');
    console.log('='.repeat(80));
    console.log(`• Ramo: ${dsRamo}`);
    console.log(`• Eixos cadastrados: ${catalogo.eixos.length}`);
    console.log(`• Blocos estruturados: ${catalogo.blocos.length}`);
    console.log(`• Ações educativas cadastradas: ${acoesInseridas.length}`);
    console.log(`• Regras de equivalência inicializadas: ${acoesInseridas.length}`);
    console.log('='.repeat(80));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro durante o seed do PN Sênior:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seedPnSenior().catch((err) => {
  console.error(err);
  process.exit(1);
});
