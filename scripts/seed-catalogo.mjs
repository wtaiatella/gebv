import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

async function seedCatalogo() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERRO: Defina DATABASE_URL no .env');
    process.exit(1);
  }

  console.log('Conectando ao PostgreSQL...');
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    console.log('1. Lendo arquivos do catálogo gerados em data/catalogo/ e data/especialidades/...');
    const baseDir = path.join(process.cwd(), 'data', 'catalogo');
    const espPaPath = path.join(process.cwd(), 'data', 'especialidades', 'pa', 'especialidades_pa.json');
    const espPnPath = path.join(process.cwd(), 'data', 'especialidades', 'pn', 'especialidades_pn.json');

    const [rawPa, rawPn, rawEquiv, rawEsps, rawPnEsps] = await Promise.all([
      readFile(path.join(baseDir, 'pa_catalogo.json'), 'utf-8'),
      readFile(path.join(baseDir, 'pn_catalogo.json'), 'utf-8'),
      readFile(path.join(baseDir, 'equivalencias.json'), 'utf-8'),
      readFile(espPaPath, 'utf-8'),
      readFile(espPnPath, 'utf-8'),
    ]);

    const paCatalogo = JSON.parse(rawPa);
    const pnCatalogo = JSON.parse(rawPn);
    const equivCatalogo = JSON.parse(rawEquiv);
    const espsList = JSON.parse(rawEsps);
    const pnEspsList = JSON.parse(rawPnEsps);

    // -------------------------------------------------------------
    // GUARDRAILS DE INTEGRIDADE (ANTI-DESTRUTIVOS)
    // -------------------------------------------------------------
    const MIN_ACOES_ESCOTEIRO = 400;

    // 1. Validação do Catálogo do Programa Antigo (PA)
    if (!paCatalogo.pistas_items || paCatalogo.pistas_items.length === 0 ||
        !paCatalogo.rumo_items || paCatalogo.rumo_items.length === 0) {
      throw new Error('ABORTADO: pa_catalogo.json inválido ou sem itens de Pistas/Rumo.');
    }

    // 2. Validação do Catálogo do Novo Programa (PN)
    if (!pnCatalogo.acoes || pnCatalogo.acoes.length < MIN_ACOES_ESCOTEIRO) {
      throw new Error(`ABORTADO: pn_catalogo.json possui ${pnCatalogo.acoes?.length || 0} ações. Mínimo exigido: ${MIN_ACOES_ESCOTEIRO}.`);
    }

    if (!pnCatalogo.blocos || pnCatalogo.blocos.length !== 18) {
      throw new Error(`ABORTADO: pn_catalogo.json possui ${pnCatalogo.blocos?.length || 0} blocos. Esperado: 18.`);
    }

    for (const b of pnCatalogo.blocos) {
      if (!b.nr_acoes_fixas_obrigatorias && !b.nr_acoes_variaveis_exigidas) {
        throw new Error(`ABORTADO: Bloco "${b.bloco}" possui metas de ações zeradas.`);
      }
    }

    // 3. Validação de Regras de Equivalência (Paridade 1:1 estrita)
    if (!equivCatalogo.regras || equivCatalogo.regras.length !== pnCatalogo.acoes.length) {
      throw new Error(`ABORTADO: equivalencias.json (${equivCatalogo.regras?.length || 0} regras) não coincide 1:1 com ações (${pnCatalogo.acoes.length}).`);
    }

    // 4. Validação do Catálogo de Especialidades (PA e PN)
    const MIN_ESPECIALIDADES_PA = 250; // real atual: 275
    const MIN_ESPECIALIDADES_PN = 180; // real atual: 206

    if (!Array.isArray(espsList) || espsList.length < MIN_ESPECIALIDADES_PA) {
      throw new Error(`ABORTADO: especialidades_pa.json possui ${espsList?.length || 0} especialidades. Mínimo exigido: ${MIN_ESPECIALIDADES_PA}.`);
    }
    for (const esp of espsList) {
      if (!esp.itens || esp.itens.length === 0) {
        throw new Error(`ABORTADO: especialidade PA "${esp.titulo || esp.slug}" possui zero itens.`);
      }
    }

    if (!Array.isArray(pnEspsList) || pnEspsList.length < MIN_ESPECIALIDADES_PN) {
      throw new Error(`ABORTADO: especialidades_pn.json possui ${pnEspsList?.length || 0} especialidades. Mínimo exigido: ${MIN_ESPECIALIDADES_PN}.`);
    }
    for (const esp of pnEspsList) {
      if (!esp.itens || esp.itens.length === 0) {
        throw new Error(`ABORTADO: especialidade PN "${esp.titulo || esp.slug}" possui zero itens.`);
      }
    }

    console.log('✓ Guardrails de integridade de dados validados com sucesso (catálogo 18 blocos + especialidades PA/PN).');

    await client.query('BEGIN');

    // -------------------------------------------------------------
    // 2. Popular Programa Antigo
    // -------------------------------------------------------------
    const dsRamo = 'ESCOTEIRO';
    console.log(`2. Populando tabelas do Programa Antigo (pa_*) para o ramo ${dsRamo}...`);
    
    // Limpeza idempotente do catálogo do Programa Antigo para este ramo
    await client.query(`DELETE FROM pa_atividades WHERE ds_ramo = $1`, [dsRamo]);
    await client.query(`DELETE FROM pa_competencias WHERE ds_ramo = $1`, [dsRamo]);

    // Áreas de desenvolvimento
    for (const area of paCatalogo.areas) {
      await client.query(
        `INSERT INTO pa_areas_desenvolvimento (ds_ramo, nm_area) VALUES ($1, $2)
         ON CONFLICT (ds_ramo, nm_area) DO NOTHING`,
        [dsRamo, area]
      );
    }
    const areasRes = await client.query(`SELECT id, nm_area FROM pa_areas_desenvolvimento WHERE ds_ramo = $1`, [dsRamo]);
    const areaMap = new Map(areasRes.rows.map((r) => [r.nm_area.toLowerCase(), r.id]));

    // Caminhos
    for (const cam of paCatalogo.caminhos) {
      await client.query(
        `INSERT INTO pa_caminhos (ds_ramo, cd_caminho_paxtu, nm_caminho) VALUES ($1, $2, $3)
         ON CONFLICT (ds_ramo, cd_caminho_paxtu) DO UPDATE SET nm_caminho = EXCLUDED.nm_caminho`,
        [dsRamo, cam.cd_caminho_paxtu, cam.nm_caminho]
      );
    }
    const caminhosRes = await client.query(`SELECT id, cd_caminho_paxtu FROM pa_caminhos WHERE ds_ramo = $1`, [dsRamo]);
    const caminhoMap = new Map(caminhosRes.rows.map((r) => [r.cd_caminho_paxtu, r.id]));

    // Competências e Atividades
    const allAntigoItems = [
      ...(paCatalogo.intro_items || []),
      ...paCatalogo.pistas_items,
      ...paCatalogo.rumo_items,
    ];
    const compCache = new Map();

    for (const item of allAntigoItems) {
      const camId = caminhoMap.get(item.cd_caminho_paxtu);
      const areaId = areaMap.get(item.ds_area.toLowerCase()) || null;
      const compKey = `${dsRamo}_${item.cd_caminho_paxtu}_${item.ds_competencia}`;

      let compDbId = compCache.get(compKey);
      if (!compDbId) {
        const compRes = await client.query(
          `INSERT INTO pa_competencias (ds_ramo, caminho_id, area_id, ds_competencia)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [dsRamo, camId, areaId, item.ds_competencia || 'Competência Padrão']
        );
        compDbId = compRes.rows[0].id;
        compCache.set(compKey, compDbId);
      }

      // Procura dados complementares do Paxtu se houver
      const paxtuKey = `${item.cd_caminho_paxtu}_${item.cd_ueb}`;
      const paxtuInfo = paCatalogo.atividades_map[paxtuKey] || {};
      const nrOrd = paxtuInfo.nr_ordenacao || parseInt(item.cd_ueb.replace(/\D/g, ''), 10) || 0;

      // Prefixo por caminho: P- (Período Introdutório), PT- (Pista e Trilha), RT- (Rumo e Travessia)
      let prefixo = '';
      if (item.cd_caminho_paxtu === '4' || (item.cd_ueb && item.cd_ueb.startsWith('P'))) {
        prefixo = 'P-';
      } else if (item.cd_caminho_paxtu === '5') {
        prefixo = 'PT-';
      } else if (item.cd_caminho_paxtu === '6') {
        prefixo = 'RT-';
      } else {
        prefixo = 'AT-';
      }
      const identificacao = `${prefixo}${nrOrd}`;

      await client.query(
        `INSERT INTO pa_atividades (ds_ramo, competencia_id, cd_atividade_paxtu, cd_caminho_paxtu, cd_ueb, identificacao, nr_ordenacao, ds_atividade)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          dsRamo,
          compDbId,
          paxtuInfo.cd_atividade_paxtu || null,
          item.cd_caminho_paxtu || null,
          item.cd_ueb,
          identificacao,
          nrOrd,
          item.ds_atividade,
        ]
      );
    }

    // Backfill garantido de cd_caminho_paxtu para quaisquer linhas existentes
    await client.query(`
      UPDATE pa_atividades a
      SET cd_caminho_paxtu = c.cd_caminho_paxtu
      FROM pa_competencias comp
      JOIN pa_caminhos c ON comp.caminho_id = c.id
      WHERE comp.id = a.competencia_id
        AND a.cd_caminho_paxtu IS NULL
    `);

    console.log('✓ Programa Antigo populado com sucesso.');

    // -------------------------------------------------------------
    // 3. Popular Novo Programa Educativo
    // -------------------------------------------------------------
    console.log(`3. Populando tabelas do Novo Programa (pn_*) para o ramo ${dsRamo}...`);

    // Limpeza idempotente do catálogo do Novo Programa para este ramo
    await client.query(`DELETE FROM pn_equivalencia_regras WHERE acao_pn_id IN (SELECT id FROM pn_acoes_educativas WHERE ds_ramo = $1)`, [dsRamo]);
    await client.query(`DELETE FROM pn_acoes_educativas WHERE ds_ramo = $1`, [dsRamo]);
    await client.query(`DELETE FROM pn_blocos WHERE ds_ramo = $1`, [dsRamo]);
    await client.query(`DELETE FROM pn_eixos WHERE ds_ramo = $1`, [dsRamo]);

    // Eixos
    for (let i = 0; i < pnCatalogo.eixos.length; i++) {
      const nmEixo = pnCatalogo.eixos[i];
      await client.query(
        `INSERT INTO pn_eixos (ds_ramo, nm_eixo, nr_ordem) VALUES ($1, $2, $3)
         ON CONFLICT (ds_ramo, nm_eixo) DO UPDATE SET nr_ordem = EXCLUDED.nr_ordem`,
        [dsRamo, nmEixo, i + 1]
      );
    }
    const eixosRes = await client.query(`SELECT id, nm_eixo FROM pn_eixos WHERE ds_ramo = $1`, [dsRamo]);
    const eixoMap = new Map(eixosRes.rows.map((r) => [r.nm_eixo.toLowerCase(), r.id]));

    // Blocos
    for (const b of pnCatalogo.blocos) {
      // Normalização de nome do eixo
      let eixoId = eixoMap.get(b.eixo.toLowerCase());
      if (!eixoId) {
        if (b.eixo.toLowerCase().includes('saúde') || b.eixo.toLowerCase().includes('saude')) {
          eixoId = eixoMap.get('saúde e bem-estar');
        }
      }

      if (eixoId) {
        await client.query(
          `INSERT INTO pn_blocos (ds_ramo, eixo_id, nm_bloco, ds_intencionalidade, nr_acoes_fixas_obrigatorias, nr_acoes_variaveis_exigidas, nr_ordem)
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
    }

    const blocosRes = await client.query(`SELECT id, nm_bloco FROM pn_blocos WHERE ds_ramo = $1`, [dsRamo]);
    const blocoMap = new Map(blocosRes.rows.map((r) => [r.nm_bloco.toLowerCase(), r.id]));

    // Ações Educativas
    function normalizeText(text) {
      if (!text) return '';
      return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const allDbAcoes = [];
    for (let i = 0; i < pnCatalogo.acoes.length; i++) {
      const ac = pnCatalogo.acoes[i];
      const blocoId = blocoMap.get(ac.bloco.toLowerCase());
      if (blocoId) {
        let tpAcao = 'VARIAVEL';
        if (ac.tp_acao) {
          const t = ac.tp_acao.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (['FIXA', 'VARIAVEL', 'SUBSTITUTIVA', 'PA'].includes(t)) tpAcao = t;
        }
        if (ac.modalidade === 'PA') tpAcao = 'PA';
        if (ac.modalidade === 'Substitutiva') tpAcao = 'SUBSTITUTIVA';

        let mod = 'BASICO';
        if (ac.modalidade) {
          const m = ac.modalidade.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (['AR', 'MAR'].includes(m)) mod = m;
        }

        const acRes = await client.query(
          `INSERT INTO pn_acoes_educativas (ds_ramo, bloco_id, tp_acao, modalidade, ds_acao, regra_qtd_texto, nr_ordem)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            dsRamo,
            blocoId,
            tpAcao,
            mod,
            ac.ds_acao,
            ac.regra_qtd_texto || null,
            i + 1,
          ]
        );
        const acId = acRes.rows[0].id;
        allDbAcoes.push({
          id: acId,
          bloco_id: blocoId,
          bloco_nm: ac.bloco,
          ds_acao: ac.ds_acao,
          norm_acao: normalizeText(ac.ds_acao),
          norm_bloco: normalizeText(ac.bloco),
          chave: ac.chave,
        });
      }
    }

    console.log(`✓ Novo Programa populado com sucesso: ${allDbAcoes.length} ações.`);

    // -------------------------------------------------------------
    // 4. Popular Regras de Equivalência (1:1 com pn_acoes_educativas por chave)
    // -------------------------------------------------------------
    console.log('4. Populando Regras de Equivalência consolidadas por ação (pn_equivalencia_regras)...');
    
    const regrasPorChave = new Map(
      equivCatalogo.regras.map((r) => [r.chave, r])
    );

    for (let i = 0; i < allDbAcoes.length; i++) {
      const acao = allDbAcoes[i];
      const chave = acao.chave;
      const directRegra = regrasPorChave.get(chave);

      if (!directRegra) {
        throw new Error(`ABORTADO: ação "${acao.ds_acao}" (chave ${chave}) não possui regra correspondente em equivalencias.json.`);
      }

      // Pistas, Rumo e Especialidades da regra
      const pistasSet = new Set(directRegra.refs_pistas_ueb || []);
      const rumoSet = new Set(directRegra.refs_rumo_ueb || []);
      const espSet = new Set(directRegra.refs_especialidades || []);
      let minCount = directRegra.min_count || 1;
      const nivelMin = directRegra.nivel_min_especialidade || 1;

      const pistasArr = Array.from(pistasSet);
      const rumoArr = Array.from(rumoSet);
      const espArr = Array.from(espSet);
      const totalOrigens = pistasArr.length + rumoArr.length + espArr.length;

      // Determina Operação e Descrição
      let operacao = directRegra.tp_regra || 'SEM_EQUIVALENCIA';
      let descricaoOrigem = directRegra.label_f_h?.trim() || 'Sem relação';
      let requerValidacaoManual = (operacao === 'SEM_EQUIVALENCIA' || totalOrigens === 0);

      if (espArr.length > 0 && pistasArr.length === 0 && rumoArr.length === 0) {
        operacao = 'ESPECIALIDADES';
        const nivelLabel = ` (Nível ${nivelMin}+)`;
        if (!descricaoOrigem || descricaoOrigem === 'Sem relação') {
          if (espArr.length <= 5) {
            descricaoOrigem = `Especialidade${nivelLabel}: ${espArr.join(', ')}`;
          } else {
            descricaoOrigem = `Especialidade${nivelLabel}: ${espArr.slice(0, 6).join(', ')} e mais ${espArr.length - 6} opções`;
          }
        }
      } else if (totalOrigens > 0) {
        if (minCount > 1) {
          operacao = 'MIN_COUNT';
        } else if (totalOrigens > 1) {
          operacao = 'OR';
        } else {
          operacao = 'DIRETA';
        }

        const descParts = [];
        if (pistasArr.length > 0) descParts.push(`Pista ${pistasArr.join(', ')}`);
        if (rumoArr.length > 0) descParts.push(`Rumo ${rumoArr.join(', ')}`);
        if (espArr.length > 0) descParts.push(`Esp. ${espArr.slice(0, 3).join(', ')}`);

        if (!descricaoOrigem || descricaoOrigem === 'Sem relação') {
          descricaoOrigem = descParts.join(' ou ');
        }
      } else {
        operacao = 'SEM_EQUIVALENCIA';
        descricaoOrigem = 'Sem relação';
        requerValidacaoManual = true;
      }

      // 5. Insere a regra única para a ação
      await client.query(
        `INSERT INTO pn_equivalencia_regras (
          acao_pn_id, operacao, descricao_origem, origem_pistas_ueb,
          origem_rumo_ueb, origem_especialidades, nivel_min_especialidade,
          min_count, fl_requer_validacao_manual, detalhes_regra
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (acao_pn_id) DO UPDATE SET
          operacao = EXCLUDED.operacao,
          descricao_origem = EXCLUDED.descricao_origem,
          origem_pistas_ueb = EXCLUDED.origem_pistas_ueb,
          origem_rumo_ueb = EXCLUDED.origem_rumo_ueb,
          origem_especialidades = EXCLUDED.origem_especialidades,
          nivel_min_especialidade = EXCLUDED.nivel_min_especialidade,
          min_count = EXCLUDED.min_count,
          fl_requer_validacao_manual = EXCLUDED.fl_requer_validacao_manual,
          detalhes_regra = EXCLUDED.detalhes_regra,
          updated_at = CURRENT_TIMESTAMP`,
        [
          acao.id,
          operacao,
          descricaoOrigem,
          pistasArr,
          rumoArr,
          espArr,
          nivelMin,
          minCount,
          requerValidacaoManual,
          JSON.stringify({
            origem_pistas_ueb: pistasArr,
            origem_rumo_ueb: rumoArr,
            origem_especialidades: espArr,
            min_count: minCount,
            nivel_min_especialidade: nivelMin,
            matched_labels: directRegra.label_f_h || '',
          }),
        ]
      );
    }

    const totalRegrasRes = await client.query(`SELECT count(*), operacao FROM pn_equivalencia_regras GROUP BY operacao`);
    console.log('✓ Regras de equivalência consolidadas com sucesso:');
    for (const row of totalRegrasRes.rows) {
      console.log(`  - ${row.operacao}: ${row.count} ações`);
    }

    // -------------------------------------------------------------
    // 5. Popular Associados base
    // -------------------------------------------------------------
    console.log('5. Populando associados a partir de dados locais...');
    try {
      const assocMap = new Map();
      try {
        const rawTodos = await readFile(path.join(process.cwd(), 'data', 'todos_associados_gebv.json'), 'utf-8');
        const listTodos = JSON.parse(rawTodos);
        for (const a of listTodos) {
          if (a.cd_associado) assocMap.set(String(a.cd_associado), a);
        }
      } catch {}

      try {
        const rawAssoc = await readFile(path.join(process.cwd(), 'data', 'associados.json'), 'utf-8');
        const listAssoc = JSON.parse(rawAssoc);
        for (const a of listAssoc) {
          if (a.cd_associado) {
            const existing = assocMap.get(String(a.cd_associado)) || {};
            assocMap.set(String(a.cd_associado), { ...existing, ...a });
          }
        }
      } catch {}

      for (const a of assocMap.values()) {
        if (!a.cd_associado) continue;
        await client.query(
          `INSERT INTO associados (
            cd_associado, nr_registro_formatado, nm_associado, ds_categoria,
            ds_ramo, fl_status, dt_nascimento, ds_email, ds_telefone_cel,
            dados_cadastrais_completos, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
          ON CONFLICT (cd_associado) DO UPDATE SET
            nr_registro_formatado = EXCLUDED.nr_registro_formatado,
            nm_associado = EXCLUDED.nm_associado,
            ds_categoria = EXCLUDED.ds_categoria,
            ds_ramo = EXCLUDED.ds_ramo,
            fl_status = EXCLUDED.fl_status,
            dt_nascimento = EXCLUDED.dt_nascimento,
            ds_email = EXCLUDED.ds_email,
            ds_telefone_cel = EXCLUDED.ds_telefone_cel,
            dados_cadastrais_completos = EXCLUDED.dados_cadastrais_completos,
            updated_at = CURRENT_TIMESTAMP`,
          [
            String(a.cd_associado),
            a.nr_registro_formatado || null,
            a.nm_associado || `Associado ${a.cd_associado}`,
            a.dsCategoria || a.ds_categoria || 'Beneficiário',
            a.dsRamo || a.ds_ramo || 'Escoteiro',
            a.flStatus || a.fl_status || 'S',
            a.dt_nascimento || null,
            a.ds_email || null,
            a.ds_telefone_cel || null,
            JSON.stringify(a),
          ]
        );
      }
      console.log(`✓ ${assocMap.size} associados sincronizados com a tabela associados.`);
    } catch (errAssoc) {
      console.warn('Aviso: Associados não importados:', errAssoc.message);
    }

    // -------------------------------------------------------------
    // 6. Popular Grupos e Catálogo de Especialidades do Programa Antigo (PA)
    // -------------------------------------------------------------
    console.log('6. Populando grupos de Especialidades do Programa Antigo (pa_especialidades_grupos)...');
    const paGrupos = [
      { nm_grupo: 'Ciência e Tecnologia', nr_ordem: 1 },
      { nm_grupo: 'Cultura', nr_ordem: 2 },
      { nm_grupo: 'Desportos', nr_ordem: 3 },
      { nm_grupo: 'Habilidades Escoteiras', nr_ordem: 4 },
      { nm_grupo: 'Serviços', nr_ordem: 5 },
    ];
    const grupoMap = new Map();
    for (const g of paGrupos) {
      const gRes = await client.query(
        `INSERT INTO pa_especialidades_grupos (nm_grupo, nr_ordem)
         VALUES ($1, $2)
         ON CONFLICT (nm_grupo) DO UPDATE SET nr_ordem = EXCLUDED.nr_ordem
         RETURNING id, nm_grupo`,
        [g.nm_grupo, g.nr_ordem]
      );
      grupoMap.set(gRes.rows[0].nm_grupo.toLowerCase(), gRes.rows[0].id);
    }
    console.log(`✓ ${paGrupos.length} grupos de especialidades PA semeados.`);

    console.log('6.1. Populando catálogo de Especialidades do Programa Antigo (pa_especialidades / pa_especialidades_itens)...');
    let totalItensSeed = 0;
    for (const esp of espsList) {
      const grupoId = grupoMap.get((esp.grupo || '').toLowerCase()) || null;
      const imageUrl = esp.imagem_caminho_public || (esp.imagem_arquivo ? `/images/especialidades/pa/${esp.imagem_arquivo}` : null);
      const cdEsp = String(esp.cd_especialidade || `WEB-${esp.slug}`);
      const totalItens = esp.total_itens || (esp.itens ? esp.itens.length : 0);

      const espRes = await client.query(
        `INSERT INTO pa_especialidades (cd_especialidade, ds_especialidade, slug, grupo_id, image_url, total_itens)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (cd_especialidade) DO UPDATE SET
           ds_especialidade = EXCLUDED.ds_especialidade,
           slug = EXCLUDED.slug,
           grupo_id = EXCLUDED.grupo_id,
           image_url = EXCLUDED.image_url,
           total_itens = EXCLUDED.total_itens
         RETURNING id`,
        [cdEsp, esp.titulo, esp.slug, grupoId, imageUrl, totalItens]
      );
      const espId = espRes.rows[0].id;

      for (const item of esp.itens || []) {
        const cdItem = String(item.cd_item || item.nr_item);
        const cleanDsItem = (item.ds_item || '')
          .replace(/!@#BARRA_R#@!!@#BARRA_N#@!|!@#BARRA_N#@!|!@#BARRA_R#@!/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        await client.query(
          `INSERT INTO pa_especialidades_itens (especialidade_id, cd_especialidade, cd_item, ds_item)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (cd_especialidade, cd_item) DO UPDATE SET
             especialidade_id = EXCLUDED.especialidade_id,
             ds_item = EXCLUDED.ds_item`,
          [espId, cdEsp, cdItem, cleanDsItem]
        );
        totalItensSeed++;
      }
    }
    console.log(`✓ ${espsList.length} especialidades e ${totalItensSeed} itens de catálogo PA semeados com sucesso.`);

    // -------------------------------------------------------------
    // 6.2. Popular Catálogo de Especialidades do Programa Novo (pn_especialidades / pn_especialidades_itens)
    // -------------------------------------------------------------
    console.log('6.2. Populando catálogo de Especialidades do Programa Novo (pn_especialidades / pn_especialidades_itens)...');
    const pnEixosRes = await client.query(`SELECT id, nm_eixo FROM pn_eixos`);
    const pnEixoMap = new Map();
    for (const row of pnEixosRes.rows) {
      pnEixoMap.set(row.nm_eixo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''), row.id);
    }

    let totalPnItensSeed = 0;
    for (const esp of pnEspsList) {
      const normArea = (esp.ds_area || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const eixoId = pnEixoMap.get(normArea) || null;
      const imageUrl = esp.imagem_caminho_public || (esp.imagem_arquivo ? `/images/especialidades/pn/${esp.imagem_arquivo}` : null);
      const totalItens = esp.total_itens || (esp.itens ? esp.itens.length : 0);

      const espRes = await client.query(
        `INSERT INTO pn_especialidades (slug, ds_especialidade, cd_especialidade, eixo_id, ramo, imagem_url, total_itens)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO UPDATE SET
           ds_especialidade = EXCLUDED.ds_especialidade,
           cd_especialidade = EXCLUDED.cd_especialidade,
           eixo_id = EXCLUDED.eixo_id,
           ramo = EXCLUDED.ramo,
           imagem_url = EXCLUDED.imagem_url,
           total_itens = EXCLUDED.total_itens,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [esp.slug, esp.titulo || esp.ds_especialidade, esp.cd_especialidade || null, eixoId, esp.ramo || null, imageUrl, totalItens]
      );
      const espId = espRes.rows[0].id;

      await client.query(`DELETE FROM pn_especialidades_itens WHERE especialidade_id = $1`, [espId]);

      for (const item of esp.itens || []) {
        const cdItem = String(item.cd_item || item.nr_item);
        const nrItem = parseInt(item.nr_item || item.cd_item, 10) || null;
        const dsEtapa = item.etapa || item.ds_etapa || null;
        const cleanDsItem = (item.ds_item || '')
          .replace(/!@#BARRA_R#@!!@#BARRA_N#@!|!@#BARRA_N#@!|!@#BARRA_R#@!/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        await client.query(
          `INSERT INTO pn_especialidades_itens (especialidade_id, cd_especialidade, cd_item, nr_item, ds_etapa, ds_item)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [espId, esp.cd_especialidade || null, cdItem, nrItem, dsEtapa, cleanDsItem]
        );
        totalPnItensSeed++;
      }
    }
    console.log(`✓ ${pnEspsList.length} especialidades e ${totalPnItensSeed} itens de catálogo PN semeados com sucesso.`);

    // -------------------------------------------------------------
    // 7. Migrar histórico de progressoes.json para escoteiro_pa_atividades
    // -------------------------------------------------------------
    console.log('7. Migrando histórico dos escoteiros para escoteiro_pa_atividades...');
    try {
      const rawProg = await readFile(path.join(process.cwd(), 'data', 'progressoes.json'), 'utf-8');
      const progList = JSON.parse(rawProg);

      // Mapeamento de atividade_id por (cd_caminho_paxtu, cd_ueb)
      const atvRes = await client.query(`
        SELECT a.id, c.cd_caminho_paxtu, a.cd_ueb
        FROM pa_atividades a
        JOIN pa_competencias comp ON a.competencia_id = comp.id
        JOIN pa_caminhos c ON comp.caminho_id = c.id
      `);
      const atvMap = new Map(atvRes.rows.map((r) => [`${r.cd_caminho_paxtu}_${r.cd_ueb}`, r.id]));

      let checksCount = 0;
      for (const p of progList) {
        const cdAssociado = String(p.cd_associado || '');
        if (!cdAssociado) continue;

        // Garante que o associado existe antes da inserção na tabela de ligação
        await client.query(
          `INSERT INTO associados (cd_associado, nm_associado, ds_categoria, ds_ramo, dados_cadastrais_completos)
           VALUES ($1, $2, 'Beneficiário', 'Escoteiro', '{}'::jsonb)
           ON CONFLICT (cd_associado) DO NOTHING`,
          [cdAssociado, `Associado ${cdAssociado}`]
        );

        for (const cam of p.caminhos || []) {
          for (const atv of cam.data || []) {
            const camId = atv.cdCaminho;
            const ueb = atv.cdUeb;
            const atvDbId = atvMap.get(`${camId}_${ueb}`);

            if (atvDbId) {
              const flJovem = atv.checkJovem === 'feitoJovem' || atv.checkJovem === 'S' || atv.checkJovem === '1' || atv.checkJovem === 'true' || !!atv.dtCheckJovem;
              const flEscotista = atv.checkEscotista === 'confirmadoEscotista' || atv.checkEscotista === 'S' || atv.checkEscotista === '1' || atv.checkEscotista === 'true' || !!atv.dtCheckEscotista;

              if (flJovem || flEscotista) {
                await client.query(
                  `INSERT INTO escoteiro_pa_atividades (
                    cd_associado, atividade_id, fl_check_jovem, fl_check_escotista,
                    dt_check_jovem, dt_check_escotista
                  ) VALUES ($1, $2, $3, $4, $5, $6)
                  ON CONFLICT (cd_associado, atividade_id) DO UPDATE SET
                    fl_check_jovem = EXCLUDED.fl_check_jovem,
                    fl_check_escotista = EXCLUDED.fl_check_escotista,
                    dt_check_jovem = EXCLUDED.dt_check_jovem,
                    dt_check_escotista = EXCLUDED.dt_check_escotista`,
                  [
                    cdAssociado,
                    atvDbId,
                    flJovem,
                    flEscotista,
                    atv.dtCheckJovem || null,
                    atv.dtCheckEscotista || null,
                  ]
                );
                checksCount++;
              }
            }
          }
        }
      }
      console.log(`✓ ${checksCount} checks de atividades importados para escoteiro_pa_atividades.`);
    } catch (errHist) {
      console.warn('Aviso: Histórico inicial de progressoes.json não importado:', errHist.message);
    }

    // -------------------------------------------------------------
    // 8. Migrar histórico de especialidades dos jovens (data/pa_especialidades_associados.json)
    // -------------------------------------------------------------
    console.log('8. Migrando histórico de especialidades dos associados para escoteiro_pa_especialidades...');
    try {
      const rawAssocEsps = await readFile(path.join(process.cwd(), 'data', 'pa_especialidades_associados.json'), 'utf-8');
      const assocEspsList = JSON.parse(rawAssocEsps);

      const espDbRes = await client.query(`SELECT id, cd_especialidade FROM pa_especialidades`);
      const espDbMap = new Map(espDbRes.rows.map((r) => [String(r.cd_especialidade), r.id]));

      let countAssocEsps = 0;
      for (const assoc of assocEspsList) {
        const cdAssociado = String(assoc.cd_associado || '');
        if (!cdAssociado) continue;

        // Garante que o associado existe
        await client.query(
          `INSERT INTO associados (cd_associado, nm_associado, ds_categoria, ds_ramo, dados_cadastrais_completos)
           VALUES ($1, $2, 'Beneficiário', 'Escoteiro', '{}'::jsonb)
           ON CONFLICT (cd_associado) DO NOTHING`,
          [cdAssociado, `Associado ${cdAssociado}`]
        );

        for (const esp of assoc.especialidades || []) {
          const rawCdEsp = esp.cd_especialidade || esp.cdEspecialidade;
          if (!rawCdEsp || rawCdEsp === 'undefined') continue;
          const cdEsp = String(rawCdEsp);
          const espId = espDbMap.get(cdEsp) || null;
          await client.query(
            `INSERT INTO escoteiro_pa_especialidades (
              cd_associado, especialidade_id, cd_especialidade, ds_especialidade,
              nr_nivel, dt_nivel, qtd_itens_concluidos, itens_detalhados, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            ON CONFLICT (cd_associado, cd_especialidade) DO UPDATE SET
              especialidade_id = EXCLUDED.especialidade_id,
              ds_especialidade = EXCLUDED.ds_especialidade,
              nr_nivel = EXCLUDED.nr_nivel,
              dt_nivel = EXCLUDED.dt_nivel,
              qtd_itens_concluidos = EXCLUDED.qtd_itens_concluidos,
              itens_detalhados = EXCLUDED.itens_detalhados,
              updated_at = CURRENT_TIMESTAMP`,
            [
              cdAssociado,
              espId,
              cdEsp,
              esp.ds_especialidade || `Especialidade ${cdEsp}`,
              esp.nr_nivel || 0,
              esp.dt_nivel || null,
              esp.qtd_itens_concluidos || 0,
              JSON.stringify(esp.itens_conquistados || []),
            ]
          );
          countAssocEsps++;
        }
      }
      console.log(`✓ ${countAssocEsps} especialidades de associados migradas para escoteiro_pa_especialidades.`);
    } catch (errAssocEsp) {
      console.warn('Aviso: Histórico de especialidades de associados não importado:', errAssocEsp.message);
    }

    await client.query('COMMIT');
    console.log('★ SEED DO CATÁLOGO, REGRAS E ESPECIALIDADES CONCLUÍDO COM SUCESSO! ★');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ERRO no seed do catálogo:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedCatalogo();

