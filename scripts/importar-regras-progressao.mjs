import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Script Oficial de Importação e Parsing Canônico das Regras de Equivalência
 * Converte as 448 regras curriculares da UEB para o schema recursivo DetalhesRegra
 * Saída: data/catalogo/pn_equivalencia_regras.json
 */
async function main() {
  console.log('🚀 Iniciando processamento canônico das 448 regras de equivalência...');

  const baseDir = path.join(process.cwd(), 'data', 'catalogo');
  const [rawPa, rawPn, rawEquiv] = await Promise.all([
    readFile(path.join(baseDir, 'pa_catalogo.json'), 'utf-8'),
    readFile(path.join(baseDir, 'pn_catalogo.json'), 'utf-8'),
    readFile(path.join(baseDir, 'equivalencias.json'), 'utf-8'),
  ]);

  const paCatalogo = JSON.parse(rawPa);
  const pnCatalogo = JSON.parse(rawPn);
  const equivCatalogo = JSON.parse(rawEquiv);

  // Mapeia atividades de PA por código (PT-XX e RT-XX)
  const paAtividadesMap = new Map();
  for (const item of (paCatalogo.pistas_items || [])) {
    const ueb = String(item.cd_ueb).replace(/\D/g, '');
    if (ueb) {
      paAtividadesMap.set(`PT-${ueb}`, {
        tipo: 'Pista',
        cd_ueb: ueb,
        identificacao: `PT-${ueb}`,
        ds_atividade: item.ds_atividade || '',
      });
    }
  }
  for (const item of (paCatalogo.rumo_items || [])) {
    const ueb = String(item.cd_ueb).replace(/\D/g, '');
    if (ueb) {
      paAtividadesMap.set(`RT-${ueb}`, {
        tipo: 'Rumo',
        cd_ueb: ueb,
        identificacao: `RT-${ueb}`,
        ds_atividade: item.ds_atividade || '',
      });
    }
  }

  const regrasEstruturadas = [];
  let countSemEquiv = 0;
  let countProgressoes = 0;
  let countEspecialidade = 0;
  let countTodas = 0;
  let countQntMinima = 0;
  let count15EspPn = 0;

  for (const r of equivCatalogo.regras) {
    const dsAcao = r.ds_acao_c || '';
    const is15AcoesPn = dsAcao.startsWith('Conquistar ao menos uma das seguintes especialidades');

    let operacao = 'SEM_EQUIVALENCIA';
    let detalhesRegra = null;
    let descricaoOrigem = r.label_f_h || '';
    let requerValidacaoManual = false;

    // Caso 1: As 15 ações de especialidades do Novo Programa (US4 / G-4)
    if (is15AcoesPn) {
      operacao = 'SEM_EQUIVALENCIA';
      detalhesRegra = { tipo: 'SEM_EQUIVALENCIA' };
      descricaoOrigem = 'Especialidades do Novo Programa (concedidas automaticamente por progressão PN)';
      requerValidacaoManual = false;
      count15EspPn++;
      countSemEquiv++;
    }
    // Caso 2: Especialidades do Programa Antigo (sem pistas e sem rumo)
    else if (r.refs_especialidades?.length > 0 && (!r.refs_pistas_ueb?.length && !r.refs_rumo_ueb?.length)) {
      const esps = r.refs_especialidades;
      const nivelMin = r.nivel_min_especialidade || 1;

      if (esps.length === 1) {
        operacao = 'ESPECIALIDADE';
        detalhesRegra = {
          tipo: 'ESPECIALIDADE',
          nm_especialidade: esps[0],
          nivel_minimo: nivelMin,
        };
        countEspecialidade++;
      } else {
        operacao = 'QNT_MINIMA';
        detalhesRegra = {
          tipo: 'QNT_MINIMA',
          quantidade_minima: 1,
          blocos: esps.map((nome) => ({
            tipo: 'ESPECIALIDADE',
            nm_especialidade: nome,
            nivel_minimo: nivelMin,
          })),
        };
        countQntMinima++;
      }
      descricaoOrigem = `Especialidade (Nível ${nivelMin}+): ${esps.slice(0, 4).join(', ')}${esps.length > 4 ? ` e mais ${esps.length - 4}` : ''}`;
    }
    // Caso 3: Atividades de PA (Pistas e/ou Rumo)
    else if ((r.refs_pistas_ueb?.length || 0) + (r.refs_rumo_ueb?.length || 0) > 0) {
      const subItens = [];

      for (const p of (r.refs_pistas_ueb || [])) {
        const key = `PT-${String(p).replace(/\D/g, '')}`;
        const ativ = paAtividadesMap.get(key) || { tipo: 'Pista', cd_ueb: p, identificacao: key, ds_atividade: '' };
        subItens.push({
          tipo: 'PROGRESSOES',
          item: {
            pa_atividade_id: 0,
            identificacao: ativ.identificacao,
            ds_atividade: ativ.ds_atividade,
          },
        });
      }

      for (const rm of (r.refs_rumo_ueb || [])) {
        const key = `RT-${String(rm).replace(/\D/g, '')}`;
        const ativ = paAtividadesMap.get(key) || { tipo: 'Rumo', cd_ueb: rm, identificacao: key, ds_atividade: '' };
        subItens.push({
          tipo: 'PROGRESSOES',
          item: {
            pa_atividade_id: 0,
            identificacao: ativ.identificacao,
            ds_atividade: ativ.ds_atividade,
          },
        });
      }

      for (const esp of (r.refs_especialidades || [])) {
        subItens.push({
          tipo: 'ESPECIALIDADE',
          nm_especialidade: esp,
          nivel_minimo: r.nivel_min_especialidade || 1,
        });
      }

      if (subItens.length === 1 && subItens[0].tipo === 'PROGRESSOES') {
        operacao = 'PROGRESSOES';
        detalhesRegra = subItens[0];
        descricaoOrigem = subItens[0].item.identificacao;
        countProgressoes++;
      } else {
        const minCount = r.min_count || 1;
        if (minCount > 1 || r.tp_regra === 'OR') {
          operacao = 'QNT_MINIMA';
          detalhesRegra = {
            tipo: 'QNT_MINIMA',
            quantidade_minima: minCount,
            blocos: subItens,
          };
          countQntMinima++;
        } else {
          operacao = 'TODAS';
          detalhesRegra = {
            tipo: 'TODAS',
            blocos: subItens,
          };
          countTodas++;
        }
      }
    }
    // Caso 4: Sem equivalência
    else {
      operacao = 'SEM_EQUIVALENCIA';
      detalhesRegra = { tipo: 'SEM_EQUIVALENCIA' };
      descricaoOrigem = 'Sem equivalência mapeada';
      requerValidacaoManual = true;
      countSemEquiv++;
    }

    regrasEstruturadas.push({
      chave: r.chave,
      eixo: r.eixo,
      bloco: r.bloco,
      tipo_acao: r.tipo_acao,
      excel_row: r.excel_row,
      ds_acao: dsAcao,
      operacao,
      descricao_origem: descricaoOrigem || 'Sem relação',
      fl_requer_validacao_manual: requerValidacaoManual,
      detalhes_regra: detalhesRegra,
    });
  }

  const outputPayload = {
    versao: '2.0.0-recursivo',
    gerado_em: new Date().toISOString(),
    total_regras: regrasEstruturadas.length,
    estatisticas: {
      total: regrasEstruturadas.length,
      progressoes: countProgressoes,
      especialidade: countEspecialidade,
      todas: countTodas,
      qnt_minima: countQntMinima,
      sem_equivalencia: countSemEquiv,
      acoes_especialidade_pn_desacopladas: count15EspPn,
    },
    regras: regrasEstruturadas,
  };

  const outputPath = path.join(baseDir, 'pn_equivalencia_regras.json');
  await writeFile(outputPath, JSON.stringify(outputPayload, null, 2), 'utf-8');

  console.log(`✓ Processamento concluído com sucesso: ${regrasEstruturadas.length} regras estruturadas.`);
  console.log(`  - PROGRESSOES (Itens únicos PA): ${countProgressoes}`);
  console.log(`  - ESPECIALIDADE (Única): ${countEspecialidade}`);
  console.log(`  - QNT_MINIMA (Alternativas / Mínimo N): ${countQntMinima}`);
  console.log(`  - TODAS (Conjuntas E): ${countTodas}`);
  console.log(`  - SEM_EQUIVALENCIA (Desvinculadas): ${countSemEquiv} (incluindo ${count15EspPn} de Especialidades PN)`);
  console.log(`✓ Arquivo canônico salvo em: ${outputPath}`);
}

main().catch((err) => {
  console.error('❌ Erro no processamento:', err);
  process.exit(1);
});
