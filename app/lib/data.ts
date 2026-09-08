import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type Associado = {
  cd_associado: string;
  nm_associado: string;
  dsCategoria: string;
  dsRamo: string;
  dt_nascimento: string;
  nr_registro: string;
  nr_grupo: string;
  nr_grupo_regiao: string;
  ds_cidade: string;
  ds_bairro: string;
  ds_endereco: string;
  nr_residencia: string;
  ds_complemento: string;
  ds_cep: string;
  nm_estado: string;
  ds_telefone_cel: string;
  ds_telefone_res: string;
  ds_email: string;
  ds_ano_ingresso: string;
  ds_escolaridade: string;
  ds_profissao: string;
  flStatus: string;
  dt_validade: string;
  [key: string]: string | undefined;
};

export type Atividade = {
  dsAtividade?: string;
  cdCaminho?: string;
  cdCompetencia?: string;
  dsDesenvolvimento?: string;
  checkJovem?: string;
  checkEscotista?: string;
  dtCheckJovem?: string;
  dtCheckEscotista?: string;
  dtAtividade?: string;
  [key: string]: string | undefined;
};

export type Caminho = {
  totalCount: number;
  data: Atividade[];
};

export type ProgressaoRecord = {
  cd_associado: string;
  nome: string;
  caminhos?: Caminho[];
  error?: string;
};

export type ItemEspecialidade = {
  cd_item: string;
  ds_item: string;
  fl_conquistado: boolean;
  dt_item?: string;
  nr_nivel?: number;
  fl_check_escotista: boolean;
  fl_check_jovem: boolean;
  check_escotista?: string;
  check_jovem?: string;
};

export type EscoteiroEspecialidade = {
  cd_especialidade: string;
  ds_especialidade: string;
  nr_nivel: number;
  dt_nivel?: string;
  qtd_itens_concluidos: number;
  total_itens?: number;
  itens: ItemEspecialidade[];
};

export type Escoteiro = {
  associado: Associado;
  progressao: Caminho[];
  especialidades?: EscoteiroEspecialidade[];
};

import { query } from '@/app/lib/db/pool';

async function readJson<T>(relativePath: string): Promise<T> {
  try {
    const filePath = path.join(process.cwd(), relativePath);
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[data] File not found or invalid: ${relativePath}, returning empty fallback.`);
    return [] as unknown as T;
  }
}

export type Ramo = 'Escoteiro' | 'Lobinho' | 'Sênior' | 'Pioneiro';

export async function getEscoteiros(ramo: Ramo = 'Escoteiro'): Promise<Escoteiro[]> {
  // Tenta consultar do PostgreSQL
  if (process.env.DATABASE_URL) {
    try {
      const resAssociados = await query<Associado>(
        `SELECT dados_cadastrais_completos
         FROM associados
         WHERE ds_categoria = 'Beneficiário' AND ds_ramo = $1
         ORDER BY nm_associado ASC`,
        [ramo]
      );

      const resProgressoes = await query<{ cd_associado: string; caminhos: Caminho[] }>(
        `SELECT cd_associado, caminhos FROM progressoes_escoteiro`
      );

      // Busca catálogo de itens oficiais de todas as especialidades
      const resItensCatalogo = await query<{
        cd_especialidade: string;
        cd_item: string;
        ds_item: string;
      }>(
        `SELECT cd_especialidade, cd_item, ds_item
         FROM pa_especialidades_itens
         ORDER BY cd_especialidade, CAST(cd_item AS INT) ASC`
      );

      const catalogoItensMap = new Map<string, { cd_item: string; ds_item: string }[]>();
      for (const item of resItensCatalogo.rows) {
        if (!catalogoItensMap.has(item.cd_especialidade)) {
          catalogoItensMap.set(item.cd_especialidade, []);
        }
        catalogoItensMap.get(item.cd_especialidade)!.push({
          cd_item: item.cd_item,
          ds_item: item.ds_item,
        });
      }

      const resEspecialidades = await query<{
        cd_associado: string;
        cd_especialidade: string;
        ds_especialidade: string;
        nr_nivel: number;
        dt_nivel: string | null;
        qtd_itens_concluidos: number;
        itens_detalhados: any[];
        total_itens: number | null;
      }>(
        `SELECT e.cd_associado, e.cd_especialidade, e.ds_especialidade, e.nr_nivel, e.dt_nivel,
                e.qtd_itens_concluidos, e.itens_detalhados, p.total_itens
         FROM escoteiro_pa_especialidades e
         LEFT JOIN pa_especialidades p ON e.especialidade_id = p.id OR e.cd_especialidade = p.cd_especialidade
         WHERE e.cd_especialidade IS NOT NULL AND e.cd_especialidade != 'undefined'
         ORDER BY e.nr_nivel DESC, e.ds_especialidade ASC`
      );

      if (resAssociados.rows.length > 0) {
        const progMap = new Map(resProgressoes.rows.map((p) => [p.cd_associado, p.caminhos]));
        
        const espMap = new Map<string, EscoteiroEspecialidade[]>();
        for (const row of resEspecialidades.rows) {
          if (!espMap.has(row.cd_associado)) {
            espMap.set(row.cd_associado, []);
          }

          const catItens = catalogoItensMap.get(row.cd_especialidade) || [];
          const conqList = Array.isArray(row.itens_detalhados) ? row.itens_detalhados : [];
          const conqMap = new Map<string, any>();

          for (const conq of conqList) {
            const code = String(conq.cd_item || conq.cdItem || conq.cdOrdenacao || '');
            if (code) {
              conqMap.set(code, conq);
            }
          }

          let mergedItens: ItemEspecialidade[] = [];
          if (catItens.length > 0) {
            mergedItens = catItens.map((cat) => {
              const conq = conqMap.get(String(cat.cd_item));
              
              const checkEscotistaVal = conq ? (conq.check_escotista || conq.checkEscotista || '') : '';
              const flCheckEscotista =
                checkEscotistaVal === 'confirmadoEscotista' ||
                checkEscotistaVal === 'S' ||
                checkEscotistaVal === '1' ||
                checkEscotistaVal === 'true';

              const checkJovemVal = conq ? (conq.check_jovem || conq.checkJovem || '') : '';
              const flCheckJovem =
                checkJovemVal === 'feitoJovem' ||
                checkJovemVal === 'S' ||
                checkJovemVal === '1' ||
                checkJovemVal === 'true' ||
                Boolean(conq?.dt_item || conq?.dtItem);

              const flConquistado = flCheckEscotista;

              return {
                cd_item: cat.cd_item,
                ds_item: cat.ds_item || conq?.ds_item || conq?.dsItem || `Item ${cat.cd_item}`,
                fl_conquistado: flConquistado,
                fl_check_escotista: flCheckEscotista,
                fl_check_jovem: flCheckJovem,
                dt_item: conq?.dt_item || conq?.dtItem || (flConquistado ? row.dt_nivel || undefined : undefined),
                nr_nivel: conq?.nr_nivel || conq?.nrNivel || row.nr_nivel,
                check_escotista: flCheckEscotista ? 'confirmadoEscotista' : undefined,
                check_jovem: flCheckJovem ? 'feitoJovem' : undefined,
              };
            });
          } else {
            mergedItens = conqList.map((conq, idx) => {
              const checkEscotistaVal = conq.check_escotista || conq.checkEscotista || '';
              const flCheckEscotista =
                checkEscotistaVal === 'confirmadoEscotista' ||
                checkEscotistaVal === 'S' ||
                checkEscotistaVal === '1' ||
                checkEscotistaVal === 'true';

              const checkJovemVal = conq.check_jovem || conq.checkJovem || '';
              const flCheckJovem =
                checkJovemVal === 'feitoJovem' ||
                checkJovemVal === 'S' ||
                checkJovemVal === '1' ||
                checkJovemVal === 'true' ||
                Boolean(conq.dt_item || conq.dtItem);

              return {
                cd_item: String(conq.cd_item || conq.cdItem || idx + 1),
                ds_item: conq.ds_item || conq.dsItem || `Item ${conq.cd_item || idx + 1}`,
                fl_conquistado: flCheckEscotista,
                fl_check_escotista: flCheckEscotista,
                fl_check_jovem: flCheckJovem,
                dt_item: conq.dt_item || conq.dtItem || row.dt_nivel || undefined,
                nr_nivel: conq.nr_nivel || conq.nrNivel || row.nr_nivel,
                check_escotista: flCheckEscotista ? 'confirmadoEscotista' : undefined,
                check_jovem: flCheckJovem ? 'feitoJovem' : undefined,
              };
            });
          }

          const concluidosCount = mergedItens.filter((it) => it.fl_check_escotista).length;

          espMap.get(row.cd_associado)!.push({
            cd_especialidade: row.cd_especialidade,
            ds_especialidade: row.ds_especialidade,
            nr_nivel: row.nr_nivel,
            dt_nivel: row.dt_nivel || undefined,
            qtd_itens_concluidos: concluidosCount || row.qtd_itens_concluidos,
            total_itens: catItens.length || row.total_itens || mergedItens.length,
            itens: mergedItens,
          });
        }

        return resAssociados.rows.map((r) => {
          const associado = (r as any).dados_cadastrais_completos as Associado;
          return {
            associado,
            progressao: progMap.get(associado.cd_associado) ?? [],
            especialidades: espMap.get(associado.cd_associado) ?? [],
          };
        });
      }
    } catch (dbErr) {
      console.warn('[data] Falha ao consultar PostgreSQL, recorrendo ao fallback JSON local:', dbErr);
    }
  }

  // Fallback para os arquivos JSON locais pré-existentes
  const [associados, progressoes, espsAssociados, catalogoEsps] = await Promise.all([
    readJson<Associado[]>('data/associados.json'),
    readJson<ProgressaoRecord[]>('data/progressoes.json'),
    readJson<any[]>('data/pa_especialidades_associados.json'),
    readJson<any[]>('data/pa_especialidades_catalogo.json'),
  ]);

  const catalogoFallbackMap = new Map<string, any>();
  if (Array.isArray(catalogoEsps)) {
    for (const esp of catalogoEsps) {
      if (esp.cd_especialidade) {
        catalogoFallbackMap.set(String(esp.cd_especialidade), esp);
      }
    }
  }

  const progressaoPorId = new Map(progressoes.map((p) => [p.cd_associado, p]));
  const espPorId = new Map<string, EscoteiroEspecialidade[]>();

  if (Array.isArray(espsAssociados)) {
    for (const assoc of espsAssociados) {
      if (assoc.cd_associado && Array.isArray(assoc.especialidades)) {
        const list: EscoteiroEspecialidade[] = [];
        for (const e of assoc.especialidades) {
          if (!e.cd_especialidade || e.cd_especialidade === 'undefined') continue;
          const cdEsp = String(e.cd_especialidade);
          const catEsp = catalogoFallbackMap.get(cdEsp);
          const conqList = e.itens_conquistados || e.itens_detalhados || [];
          const conqMap = new Map<string, any>();
          for (const c of conqList) {
            const code = String(c.cd_item || c.cdItem || '');
            if (code) conqMap.set(code, c);
          }

          let itens: ItemEspecialidade[] = [];
          if (catEsp && Array.isArray(catEsp.itens) && catEsp.itens.length > 0) {
            itens = catEsp.itens.map((catItem: any) => {
              const conq = conqMap.get(String(catItem.cd_item));

              const checkEscotistaVal = conq ? (conq.check_escotista || conq.checkEscotista || '') : '';
              const flCheckEscotista =
                checkEscotistaVal === 'confirmadoEscotista' ||
                checkEscotistaVal === 'S' ||
                checkEscotistaVal === '1' ||
                checkEscotistaVal === 'true';

              const checkJovemVal = conq ? (conq.check_jovem || conq.checkJovem || '') : '';
              const flCheckJovem =
                checkJovemVal === 'feitoJovem' ||
                checkJovemVal === 'S' ||
                checkJovemVal === '1' ||
                checkJovemVal === 'true' ||
                Boolean(conq?.dt_item || conq?.dtItem);

              const flConquistado = flCheckEscotista;

              return {
                cd_item: String(catItem.cd_item),
                ds_item: catItem.ds_item || conq?.ds_item || '',
                fl_conquistado: flConquistado,
                fl_check_escotista: flCheckEscotista,
                fl_check_jovem: flCheckJovem,
                dt_item: conq?.dt_item || (flConquistado ? e.dt_nivel : undefined),
                nr_nivel: conq?.nr_nivel || e.nr_nivel,
                check_escotista: flCheckEscotista ? 'confirmadoEscotista' : undefined,
                check_jovem: flCheckJovem ? 'feitoJovem' : undefined,
              };
            });
          } else {
            itens = conqList.map((c: any, idx: number) => {
              const checkEscotistaVal = c.check_escotista || c.checkEscotista || '';
              const flCheckEscotista =
                checkEscotistaVal === 'confirmadoEscotista' ||
                checkEscotistaVal === 'S' ||
                checkEscotistaVal === '1' ||
                checkEscotistaVal === 'true';

              const checkJovemVal = c.check_jovem || c.checkJovem || '';
              const flCheckJovem =
                checkJovemVal === 'feitoJovem' ||
                checkJovemVal === 'S' ||
                checkJovemVal === '1' ||
                checkJovemVal === 'true' ||
                Boolean(c.dt_item || c.dtItem);

              return {
                cd_item: String(c.cd_item || idx + 1),
                ds_item: c.ds_item || `Item ${c.cd_item || idx + 1}`,
                fl_conquistado: flCheckEscotista,
                fl_check_escotista: flCheckEscotista,
                fl_check_jovem: flCheckJovem,
                dt_item: c.dt_item || e.dt_nivel,
                nr_nivel: c.nr_nivel || e.nr_nivel,
                check_escotista: flCheckEscotista ? 'confirmadoEscotista' : undefined,
                check_jovem: flCheckJovem ? 'feitoJovem' : undefined,
              };
            });
          }

          const concluidosCount = itens.filter((it) => it.fl_check_escotista).length;

          list.push({
            cd_especialidade: cdEsp,
            ds_especialidade: e.ds_especialidade,
            nr_nivel: e.nr_nivel || 0,
            dt_nivel: e.dt_nivel,
            qtd_itens_concluidos: concluidosCount || e.qtd_itens_concluidos,
            total_itens: catEsp?.total_itens || itens.length,
            itens,
          });
        }
        espPorId.set(String(assoc.cd_associado), list);
      }
    }
  }

  return associados
    .filter((a) => a.dsCategoria === 'Beneficiário' && (!a.dsRamo || a.dsRamo === ramo))
    .map((associado) => ({
      associado,
      progressao: progressaoPorId.get(associado.cd_associado)?.caminhos ?? [],
      especialidades: espPorId.get(associado.cd_associado) ?? [],
    }))
    .sort((a, b) => a.associado.nm_associado.localeCompare(b.associado.nm_associado, 'pt-BR'));
}


