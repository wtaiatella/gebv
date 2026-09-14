import { readFile } from 'node:fs/promises';
import path from 'node:path';
import prisma from '@/app/lib/prisma';
import { normalizeRamo, ramoToDisplayName, Ramo as RamoEnum } from '@/app/lib/ramo';

export type Associado = {
  cd_associado: string;
  nm_associado: string;
  dsCategoria?: string;
  dsRamo?: string;
  dt_nascimento?: string;
  nr_registro?: string;
  nr_registro_formatado?: string;
  nr_grupo?: string;
  nr_grupo_regiao?: string;
  ds_cidade?: string;
  ds_bairro?: string;
  ds_endereco?: string;
  nr_residencia?: string;
  ds_complemento?: string;
  ds_cep?: string;
  nm_estado?: string;
  ds_telefone_cel?: string;
  ds_telefone_res?: string;
  ds_email?: string;
  ds_ano_ingresso?: string;
  ds_escolaridade?: string;
  ds_profissao?: string;
  flStatus?: string;
  dt_validade?: string;
  [key: string]: any;
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

export type Ramo = 'Escoteiro' | 'Lobinho' | 'Sênior' | 'Pioneiro' | RamoEnum;

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

export async function getEscoteiros(ramoInput: string | Ramo = 'Escoteiro'): Promise<Escoteiro[]> {
  const ramoEnum = normalizeRamo(String(ramoInput));
  const ramoDisplay = ramoToDisplayName(ramoEnum);

  if (process.env.DATABASE_URL) {
    try {
      // 1. Busca associados com backup paxtu, progressoes_pa e especialidades
      const associadosDb = await prisma.associado.findMany({
        where: {
          ds_categoria: 'BENEFICIARIO',
          ds_ramo: ramoEnum,
          fl_status: 'ATIVO',
        },
        include: {
          progressao_paxtu: true,
          progressoes_pa: true,
          progressoes_especialidades: {
            include: {
              especialidade: true,
            },
            orderBy: [{ nr_nivel: 'desc' }, { ds_especialidade: 'asc' }],
          },
        },
        orderBy: {
          nm_associado: 'asc',
        },
      });

      // 2. Busca catálogo oficial de caminhos e atividades do Programa Antigo (PA)
      const caminhosCatalogoDb = await prisma.paCaminho.findMany({
        where: { ds_ramo: ramoEnum },
        include: {
          competencias: {
            include: {
              area: true,
              atividades: {
                orderBy: { id: 'asc' },
              },
            },
            orderBy: { id: 'asc' },
          },
        },
        orderBy: { id: 'asc' },
      });

      // 3. Busca catálogo de itens oficiais de todas as especialidades
      const itensCatalogoDb = await prisma.paEspecialidadeItem.findMany({
        orderBy: [
          { cd_especialidade: 'asc' },
          { id: 'asc' },
        ],
      });

      const catalogoItensMap = new Map<string, { cd_item: string; ds_item: string }[]>();
      for (const item of itensCatalogoDb) {
        if (!catalogoItensMap.has(item.cd_especialidade)) {
          catalogoItensMap.set(item.cd_especialidade, []);
        }
        catalogoItensMap.get(item.cd_especialidade)!.push({
          cd_item: item.cd_item,
          ds_item: item.ds_item,
        });
      }

      if (associadosDb.length > 0) {
        return associadosDb.map((r) => {
          const rawDados =
            typeof r.dados_cadastrais_completos === 'object' && r.dados_cadastrais_completos
              ? (r.dados_cadastrais_completos as Record<string, any>)
              : {};

          const dtNascStr = r.dt_nascimento
            ? r.dt_nascimento.toISOString().split('T')[0]
            : rawDados.dt_nascimento || '';

          const associado: Associado = {
            ...rawDados,
            cd_associado: String(r.cd_associado),
            nm_associado: r.nm_associado || rawDados.nm_associado || `Associado ${r.cd_associado}`,
            dsCategoria: 'Beneficiário',
            dsRamo: ramoDisplay,
            nr_registro_formatado: r.nr_registro_formatado || rawDados.nr_registro_formatado || '',
            dt_nascimento: dtNascStr,
            ds_email: r.ds_email || rawDados.ds_email || '',
            ds_telefone_cel: r.ds_telefone_cel || rawDados.ds_telefone_cel || '',
            flStatus: 'S',
          };

          // Monta caminhos a partir do catálogo oficial ordenado do banco de dados
          let caminhos: Caminho[] = [];
          if (caminhosCatalogoDb.length > 0) {
            const dbPaMap = new Map<number, (typeof r.progressoes_pa)[0]>();
            for (const p of r.progressoes_pa || []) {
              dbPaMap.set(p.atividade_id, p);
            }

            const paxtuMap = new Map<string, any>();
            const caminhosPaxtuRaw = Array.isArray(r.progressao_paxtu?.caminhos)
              ? (r.progressao_paxtu.caminhos as any[])
              : [];

            for (const c of caminhosPaxtuRaw) {
              const cdCam = c.data?.[0]?.cdCaminho || '';
              for (const a of c.data || []) {
                if (a.cdAtividade) paxtuMap.set(String(a.cdAtividade), a);
                if (a.cdUeb) {
                  paxtuMap.set(`${cdCam}_${a.cdUeb}`, a);
                  paxtuMap.set(String(a.cdUeb), a);
                }
                if (a.dsAtividade) {
                  paxtuMap.set(a.dsAtividade.trim().toLowerCase(), a);
                }
              }
            }

            caminhos = caminhosCatalogoDb.map((camDb) => {
              const atividades: Atividade[] = [];

              for (const compDb of camDb.competencias) {
                for (const ativDb of compDb.atividades) {
                  const pDb = dbPaMap.get(ativDb.id);
                  const pPaxtu =
                    (ativDb.cd_atividade_paxtu && paxtuMap.get(String(ativDb.cd_atividade_paxtu))) ||
                    paxtuMap.get(`${camDb.cd_caminho_paxtu}_${ativDb.cd_ueb}`) ||
                    paxtuMap.get(ativDb.ds_atividade.trim().toLowerCase());

                  const isEscotista = Boolean(
                    pDb?.fl_check_escotista ||
                    pPaxtu?.checkEscotista === 'confirmadoEscotista' ||
                    pPaxtu?.checkEscotista === 'S' ||
                    pPaxtu?.checkEscotista === '1' ||
                    pPaxtu?.checkEscotista === 'true'
                  );

                  const isJovem = Boolean(
                    isEscotista ||
                    pDb?.fl_check_jovem ||
                    pPaxtu?.checkJovem === 'feitoJovem' ||
                    pPaxtu?.checkJovem === 'S' ||
                    pPaxtu?.checkJovem === '1' ||
                    pPaxtu?.checkJovem === 'true' ||
                    Boolean(pPaxtu?.dtCheckJovem)
                  );

                  const dtDb = pDb?.dt_check_escotista || pDb?.dt_check_jovem;
                  const dtStr = dtDb
                    ? dtDb.toISOString().split('T')[0]
                    : (pPaxtu?.dtCheckEscotista || pPaxtu?.dtCheckJovem || pPaxtu?.dtAtividade || undefined);

                  atividades.push({
                    cdCaminho: camDb.cd_caminho_paxtu || String(camDb.id),
                    cdCompetencia: String(compDb.id),
                    cdAtividade: String(ativDb.cd_atividade_paxtu || ativDb.id),
                    cdUeb: ativDb.cd_ueb,
                    cdOrdenacao: String(ativDb.nr_ordenacao),
                    identificacao: ativDb.identificacao || undefined,
                    dsAtividade: ativDb.ds_atividade,
                    dsDesenvolvimento: compDb.area?.nm_area || compDb.ds_competencia || 'Geral',
                    checkEscotista: isEscotista ? 'confirmadoEscotista' : undefined,
                    checkJovem: isJovem ? 'feitoJovem' : undefined,
                    dtCheckEscotista: isEscotista ? dtStr : undefined,
                    dtCheckJovem: isJovem ? dtStr : undefined,
                    dtAtividade: dtStr,
                  });
                }
              }

              return {
                totalCount: atividades.length,
                data: atividades,
              };
            });
          } else {
            caminhos = Array.isArray(r.progressao_paxtu?.caminhos)
              ? (r.progressao_paxtu.caminhos as unknown as Caminho[])
              : [];
          }

          const especialidades: EscoteiroEspecialidade[] = r.progressoes_especialidades.map((esp) => {
            const catItens = catalogoItensMap.get(esp.cd_especialidade) || [];
            const conqList = Array.isArray(esp.itens_detalhados) ? (esp.itens_detalhados as any[]) : [];
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
                  flCheckEscotista ||
                  checkJovemVal === 'feitoJovem' ||
                  checkJovemVal === 'S' ||
                  checkJovemVal === '1' ||
                  checkJovemVal === 'true';

                const flConquistado = flCheckEscotista;
                const dtNivelStr = esp.dt_nivel ? esp.dt_nivel.toISOString().split('T')[0] : undefined;
                const dateVal = (flCheckEscotista || flCheckJovem)
                  ? (conq?.dt_item || conq?.dtItem || (flConquistado ? dtNivelStr : undefined) || undefined)
                  : undefined;

                return {
                  cd_item: cat.cd_item,
                  ds_item: cat.ds_item || conq?.ds_item || conq?.dsItem || `Item ${cat.cd_item}`,
                  fl_conquistado: flConquistado,
                  fl_check_escotista: flCheckEscotista,
                  fl_check_jovem: flCheckJovem,
                  dt_item: dateVal,
                  nr_nivel: conq?.nr_nivel || conq?.nrNivel || esp.nr_nivel,
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
                  flCheckEscotista ||
                  checkJovemVal === 'feitoJovem' ||
                  checkJovemVal === 'S' ||
                  checkJovemVal === '1' ||
                  checkJovemVal === 'true';

                const dtNivelStr = esp.dt_nivel ? esp.dt_nivel.toISOString().split('T')[0] : undefined;
                const dateVal = (flCheckEscotista || flCheckJovem)
                  ? (conq.dt_item || conq.dtItem || dtNivelStr || undefined)
                  : undefined;

                return {
                  cd_item: String(conq.cd_item || conq.cdItem || idx + 1),
                  ds_item: conq.ds_item || conq.dsItem || `Item ${conq.cd_item || idx + 1}`,
                  fl_conquistado: flCheckEscotista,
                  fl_check_escotista: flCheckEscotista,
                  fl_check_jovem: flCheckJovem,
                  dt_item: dateVal,
                  nr_nivel: conq.nr_nivel || conq.nrNivel || esp.nr_nivel,
                  check_escotista: flCheckEscotista ? 'confirmadoEscotista' : undefined,
                  check_jovem: flCheckJovem ? 'feitoJovem' : undefined,
                };
              });
            }

            const concluidosCount = mergedItens.filter((it) => it.fl_check_escotista).length;

            return {
              cd_especialidade: esp.cd_especialidade,
              ds_especialidade: esp.ds_especialidade,
              nr_nivel: esp.nr_nivel,
              dt_nivel: esp.dt_nivel ? esp.dt_nivel.toISOString().split('T')[0] : undefined,
              qtd_itens_concluidos: concluidosCount || esp.qtd_itens_concluidos,
              total_itens: catItens.length || esp.especialidade?.total_itens || mergedItens.length,
              itens: mergedItens,
            };
          });

          return {
            associado,
            progressao: caminhos,
            especialidades,
          };
        });
      }
    } catch (dbErr) {
      console.warn('[data] Falha ao consultar PostgreSQL/Prisma, recorrendo ao fallback JSON local:', dbErr);
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
                flCheckEscotista ||
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
    .filter((a) => a.dsCategoria === 'Beneficiário' && (!a.dsRamo || a.dsRamo === ramoDisplay))
    .map((associado) => ({
      associado,
      progressao: progressaoPorId.get(associado.cd_associado)?.caminhos ?? [],
      especialidades: espPorId.get(associado.cd_associado) ?? [],
    }))
    .sort((a, b) => a.associado.nm_associado.localeCompare(b.associado.nm_associado, 'pt-BR'));
}
