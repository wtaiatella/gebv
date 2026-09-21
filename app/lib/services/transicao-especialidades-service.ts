import prisma from '@/app/lib/prisma';
import { normalizeRamo, Ramo as RamoEnum } from '@/app/lib/ramo';

export interface TransicaoEspecialidadeResultado {
  cd_associado: string;
  especialidades_processadas: number;
  itens_concedidos: number;
  niveis_concedidos: number;
}

export interface EspecialidadeTransicaoItem {
  id: number;
  tipo_equivalencia?: string;
  equivalencias_regras: {
    pa_item_id: number;
  }[];
}

export interface EspecialidadeTransicao {
  id: number;
  meta_nivel_1: number | null;
  meta_nivel_2: number | null;
  itens: EspecialidadeTransicaoItem[];
}

/**
 * Executa a transição pontual de especialidades de um associado.
 * Aplica estritamente a Regra de Ouro Simétrica (ADR-5):
 * Qualquer registro com origem = MANUAL_CHEFE (seja true ou false) é preservado integralmente.
 */
export async function transicionarEspecialidadesAssociado(
  cd_associado: string,
  catalogoPreCarregado?: EspecialidadeTransicao[]
): Promise<TransicaoEspecialidadeResultado> {
  return await prisma.$transaction(async (tx) => {
    // 1. Busca associado e identifica o ramo
    const assoc = await tx.associado.findUnique({
      where: { cd_associado },
      select: { cd_associado: true, ds_ramo: true },
    });
    if (!assoc) {
      throw new Error(`Associado ${cd_associado} não encontrado.`);
    }

    const ramoNormalizado = assoc.ds_ramo ? normalizeRamo(assoc.ds_ramo) : RamoEnum.ESCOTEIRO;
    const isSeniorOuPioneiro =
      ramoNormalizado === RamoEnum.SENIOR || ramoNormalizado === RamoEnum.PIONEIRO;

    // Se for Sênior ou Pioneiro, o currículo não possui transição automática
    const pnRamoEnum = isSeniorOuPioneiro ? 'SENIOR_PIONEIRO' : 'LOBINHO_ESCOTEIRO';

    // 2. Busca itens PA conquistados pelo jovem
    const paItensConquistados = await tx.progressaoEspecialidadeItemPa.findMany({
      where: {
        cd_associado,
        concluida: true,
      },
      select: {
        especialidade_item_id: true,
        data_conclusao: true,
      },
    });

    const paConquistadosMap = new Map<number, Date | null>();
    for (const it of paItensConquistados) {
      paConquistadosMap.set(it.especialidade_item_id, it.data_conclusao);
    }

    // 3. Busca itens PN já persistidos para o associado (para verificar MANUAL_CHEFE)
    const pnItensExistentes = await tx.progressaoEspecialidadeItemPn.findMany({
      where: { cd_associado },
      select: {
        id: true,
        especialidade_item_id: true,
        concluida: true,
        origem: true,
        data_conclusao: true,
      },
    });

    const pnExistentesMap = new Map<number, (typeof pnItensExistentes)[0]>();
    for (const it of pnItensExistentes) {
      pnExistentesMap.set(it.especialidade_item_id, it);
    }

    // 4. Busca catálogo de especialidades PN (ou usa o pré-carregado pela seção)
    const pnEspecialidades =
      catalogoPreCarregado ||
      (await tx.pnEspecialidade.findMany({
        where: {
          OR: [{ ramo: pnRamoEnum as any }, { ramo: null }],
        },
        select: {
          id: true,
          meta_nivel_1: true,
          meta_nivel_2: true,
          itens: {
            select: {
              id: true,
              tipo_equivalencia: true,
              equivalencias_regras: {
                where: { fl_aprovado: true },
                select: {
                  pa_item_id: true,
                },
              },
            },
          },
        },
      }));

    let totalItensConcedidos = 0;
    let totalNiveisConcedidos = 0;

    for (const esp of pnEspecialidades) {
      let concluidosCount = 0;
      let ultimaDataConclusao: Date | null = null;

      for (const item of esp.itens) {
        const existente = pnExistentesMap.get(item.id);

        // REGRA DE OURO SIMÉTRICA (ADR-5):
        // Se foi editado manualmente pelo chefe, o valor é SOBERANO (tanto true quanto false)
        if (existente && existente.origem === 'MANUAL_CHEFE') {
          if (existente.concluida) {
            concluidosCount++;
            if (existente.data_conclusao) {
              ultimaDataConclusao = existente.data_conclusao;
            }
          }
          continue;
        }

        // Avalia equivalência automática por semântica TODAS (AND) ou AO_MENOS_UMA (OR)
        let itemSatisfeito = false;
        let dataConclusaoPa: Date | null = null;

        if (item.equivalencias_regras.length > 0) {
          if (item.tipo_equivalencia === 'AO_MENOS_UMA') {
            for (const regra of item.equivalencias_regras) {
              if (paConquistadosMap.has(regra.pa_item_id)) {
                itemSatisfeito = true;
                dataConclusaoPa = paConquistadosMap.get(regra.pa_item_id) || null;
                break; // Semântica OR: basta 1 item PA conquistado
              }
            }
          } else {
            // Default: 'TODAS' (AND) - exige que todos os itens PA das regras homologadas estejam cumpridos
            const todasCumpridas = item.equivalencias_regras.every((regra: { pa_item_id: number }) =>
              paConquistadosMap.has(regra.pa_item_id)
            );

            if (todasCumpridas) {
              itemSatisfeito = true;
              // Herda a maior data de conclusão entre os itens PA cumpridos
              let maxDate: Date | null = null;
              for (const regra of item.equivalencias_regras) {
                const dt = paConquistadosMap.get(regra.pa_item_id);
                if (dt && (!maxDate || dt > maxDate)) {
                  maxDate = dt;
                }
              }
              dataConclusaoPa = maxDate;
            }
          }
        }

        if (itemSatisfeito) {
          concluidosCount++;
          if (dataConclusaoPa) {
            ultimaDataConclusao = dataConclusaoPa;
          }

          // Se não estava marcado como concluído automaticamente, grava/atualiza
          if (!existente || !existente.concluida) {
            await tx.progressaoEspecialidadeItemPn.upsert({
              where: {
                cd_associado_especialidade_item_id: {
                  cd_associado,
                  especialidade_item_id: item.id,
                },
              },
              create: {
                cd_associado,
                especialidade_item_id: item.id,
                concluida: true,
                data_conclusao: dataConclusaoPa,
                origem: 'EQUIVALENCIA_AUTOMATICA',
              },
              update: {
                concluida: true,
                data_conclusao: dataConclusaoPa,
                origem: 'EQUIVALENCIA_AUTOMATICA',
              },
            });
            totalItensConcedidos++;
          }
        } else {
          // Se estava marcado como automático e não cumpre mais, reverte
          if (existente && existente.origem === 'EQUIVALENCIA_AUTOMATICA' && existente.concluida) {
            await tx.progressaoEspecialidadeItemPn.update({
              where: { id: existente.id },
              data: {
                concluida: false,
                data_conclusao: null,
              },
            });
          }
        }
      }

      // Calcula e concede Nível 1 ou Nível 2
      const meta1 = esp.meta_nivel_1 ?? 4;
      const meta2 = esp.meta_nivel_2 ?? 8;

      let novoNivel = 0;
      let flConcluido = false;

      if (concluidosCount >= meta2) {
        novoNivel = 2;
        flConcluido = true;
      } else if (concluidosCount >= meta1) {
        novoNivel = 1;
        flConcluido = false;
      }

      if (novoNivel > 0) {
        totalNiveisConcedidos++;
      }

      if (concluidosCount > 0 || novoNivel > 0) {
        await tx.progressaoEspecialidadePn.upsert({
          where: {
            cd_associado_especialidade_id: {
              cd_associado,
              especialidade_id: esp.id,
            },
          },
          create: {
            cd_associado,
            especialidade_id: esp.id,
            nr_nivel: novoNivel,
            fl_concluido: flConcluido,
            qtd_itens_concluidos: concluidosCount,
            dt_conquista: novoNivel > 0 ? ultimaDataConclusao || new Date() : null,
            origem: 'EQUIVALENCIA_AUTOMATICA',
          },
          update: {
            nr_nivel: novoNivel,
            fl_concluido: flConcluido,
            qtd_itens_concluidos: concluidosCount,
            dt_conquista: novoNivel > 0 ? ultimaDataConclusao || new Date() : null,
          },
        });
      }
    }

    return {
      cd_associado,
      especialidades_processadas: pnEspecialidades.length,
      itens_concedidos: totalItensConcedidos,
      niveis_concedidos: totalNiveisConcedidos,
    };
  });
}

/**
 * Recalcula a transição de especialidades para todos os beneficiários de uma seção/ramo.
 */
export async function transicionarEspecialidadesSecao(
  ds_ramo: string
): Promise<{
  total_processados: number;
  itens_concedidos: number;
  niveis_concedidos: number;
}> {
  const ramoEnum = normalizeRamo(ds_ramo);
  const isSeniorOuPioneiro =
    ramoEnum === RamoEnum.SENIOR || ramoEnum === RamoEnum.PIONEIRO;
  const pnRamoEnum = isSeniorOuPioneiro ? 'SENIOR_PIONEIRO' : 'LOBINHO_ESCOTEIRO';

  // Pré-carrega o catálogo de especialidades UMA ÚNICA VEZ para toda a seção sem colunas pesadas
  const catalogoSecao = await prisma.pnEspecialidade.findMany({
    where: {
      OR: [{ ramo: pnRamoEnum as any }, { ramo: null }],
    },
    select: {
      id: true,
      meta_nivel_1: true,
      meta_nivel_2: true,
      itens: {
        select: {
          id: true,
          tipo_equivalencia: true,
          equivalencias_regras: {
            where: { fl_aprovado: true },
            select: {
              pa_item_id: true,
            },
          },
        },
      },
    },
  });

  const associados = await prisma.associado.findMany({
    where: {
      ds_ramo: ramoEnum,
      ds_categoria: 'BENEFICIARIO',
      fl_status: 'ATIVO',
    },
    select: { cd_associado: true },
  });

  let totalItens = 0;
  let totalNiveis = 0;

  for (const a of associados) {
    const res = await transicionarEspecialidadesAssociado(a.cd_associado, catalogoSecao);
    totalItens += res.itens_concedidos;
    totalNiveis += res.niveis_concedidos;
  }

  return {
    total_processados: associados.length,
    itens_concedidos: totalItens,
    niveis_concedidos: totalNiveis,
  };
}
