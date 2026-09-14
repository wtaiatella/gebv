import prisma from '@/app/lib/prisma';
import {
  fetchAllAssociados,
  fetchProgressao,
  fetchEspecialidadesCompletasAssociado,
} from '@/app/lib/paxtu/client';
import type { Associado, Caminho } from '@/app/lib/data';
import { normalizeRamo, ramoToBranchId, ramoToDisplayName, Ramo as RamoEnum } from '@/app/lib/ramo';

let isSyncInProgress = false;

export async function logSync(
  tipo: string,
  status: string,
  cd_associado: string | null,
  detalhes: any,
  duration_ms: number
): Promise<number> {
  const log = await prisma.syncLog.create({
    data: {
      tipo,
      status,
      cd_associado,
      detalhes,
      duration_ms,
    },
  });
  return log.id;
}

export async function upsertAssociado(a: Associado, ramoPadrao?: RamoEnum): Promise<void> {
  let ramoEnum: RamoEnum | null = null;
  try {
    ramoEnum = a.dsRamo ? normalizeRamo(a.dsRamo) : ramoPadrao ?? null;
  } catch {
    ramoEnum = ramoPadrao ?? null;
  }

  const dtNascimento = a.dt_nascimento ? new Date(a.dt_nascimento) : null;
  const validDt = dtNascimento && !isNaN(dtNascimento.getTime()) ? dtNascimento : null;

  await prisma.associado.upsert({
    where: { cd_associado: String(a.cd_associado) },
    create: {
      cd_associado: String(a.cd_associado),
      nr_registro_formatado: a.nr_registro_formatado || a.nr_registro || null,
      nm_associado: a.nm_associado,
      ds_categoria: a.dsCategoria === 'Escotista' ? 'ESCOTISTA' : 'BENEFICIARIO',
      ds_ramo: ramoEnum,
      fl_status: 'ATIVO',
      dt_nascimento: validDt,
      ds_email: a.ds_email || null,
      ds_telefone_cel: a.ds_telefone_cel || null,
      dados_cadastrais_completos: a as any,
    },
    update: {
      nr_registro_formatado: a.nr_registro_formatado || a.nr_registro || null,
      nm_associado: a.nm_associado,
      ds_categoria: a.dsCategoria === 'Escotista' ? 'ESCOTISTA' : 'BENEFICIARIO',
      ds_ramo: ramoEnum,
      fl_status: 'ATIVO',
      dt_nascimento: validDt,
      ds_email: a.ds_email || null,
      ds_telefone_cel: a.ds_telefone_cel || null,
      dados_cadastrais_completos: a as any,
    },
  });
}

export async function upsertProgressaoPaxtu(
  cd_associado: string,
  caminhos: Caminho[]
): Promise<void> {
  await prisma.progressaoPaxtu.upsert({
    where: { cd_associado },
    create: {
      cd_associado,
      caminhos: caminhos as any,
    },
    update: {
      caminhos: caminhos as any,
    },
  });
}

export async function upsertProgressaoPa(
  cd_associado: string,
  caminhos: Caminho[],
  ramoEnum: RamoEnum
): Promise<void> {
  // 1. Busca catálogo de atividades do ramo para mapeamento de id por (cd_caminho, cd_ueb)
  const atividadesDb = await prisma.paAtividade.findMany({
    where: { ds_ramo: ramoEnum },
    include: {
      competencia: {
        include: {
          caminho: true,
        },
      },
    },
  });

  const atvMap = new Map<string, number>();
  for (const atv of atividadesDb) {
    const caminhoCode = atv.competencia.caminho?.cd_caminho_paxtu || '';
    if (caminhoCode) {
      atvMap.set(`${caminhoCode}_${atv.cd_ueb}`, atv.id);
    }
  }

  for (const caminho of caminhos) {
    if (!caminho.data) continue;
    for (const atv of caminho.data) {
      const camId = atv.cdCaminho;
      const ueb = atv.cdUeb;
      const atvDbId = atvMap.get(`${camId}_${ueb}`);

      if (atvDbId) {
        const flJovem =
          atv.checkJovem === 'feitoJovem' ||
          atv.checkJovem === 'S' ||
          atv.checkJovem === '1' ||
          atv.checkJovem === 'true' ||
          Boolean(atv.dtCheckJovem);

        const flEscotista =
          atv.checkEscotista === 'confirmadoEscotista' ||
          atv.checkEscotista === 'S' ||
          atv.checkEscotista === '1' ||
          atv.checkEscotista === 'true' ||
          Boolean(atv.dtCheckEscotista);

        if (flJovem || flEscotista) {
          const dtJovem = atv.dtCheckJovem ? new Date(atv.dtCheckJovem) : null;
          const dtEscotista = atv.dtCheckEscotista ? new Date(atv.dtCheckEscotista) : null;

          await prisma.progressaoPa.upsert({
            where: {
              cd_associado_atividade_id: {
                cd_associado,
                atividade_id: atvDbId,
              },
            },
            create: {
              cd_associado,
              atividade_id: atvDbId,
              fl_check_jovem: flJovem,
              fl_check_escotista: flEscotista,
              dt_check_jovem: dtJovem && !isNaN(dtJovem.getTime()) ? dtJovem : null,
              dt_check_escotista: dtEscotista && !isNaN(dtEscotista.getTime()) ? dtEscotista : null,
            },
            update: {
              fl_check_jovem: flJovem,
              fl_check_escotista: flEscotista,
              dt_check_jovem: dtJovem && !isNaN(dtJovem.getTime()) ? dtJovem : null,
              dt_check_escotista: dtEscotista && !isNaN(dtEscotista.getTime()) ? dtEscotista : null,
            },
          });
        }
      }
    }
  }
}

export async function upsertEspecialidadesAssociado(
  cd_associado: string,
  especialidades: any[]
): Promise<void> {
  if (!especialidades || especialidades.length === 0) return;

  const catalogoEsps = await prisma.paEspecialidade.findMany({
    select: { id: true, cd_especialidade: true },
  });
  const espMap = new Map<string, number>(catalogoEsps.map((e) => [String(e.cd_especialidade), e.id]));

  for (const esp of especialidades) {
    const rawCdEsp = esp.cd_especialidade || esp.cdEspecialidade;
    if (!rawCdEsp || rawCdEsp === 'undefined') continue;
    const cdEsp = String(rawCdEsp);
    const especialidadeId = espMap.get(cdEsp) || null;
    const dsEsp = esp.ds_especialidade || esp.dsEspecialidade || `Especialidade ${cdEsp}`;
    const nrNivel = Number(esp.nr_nivel ?? esp.nrNivel ?? 0);
    const dtNivel = esp.dt_nivel ? new Date(esp.dt_nivel) : null;
    const validDtNivel = dtNivel && !isNaN(dtNivel.getTime()) ? dtNivel : null;

    const itensList = esp.itens_conquistados || esp.itens_detalhados || [];
    const qtdItens = Number(esp.qtd_itens_concluidos ?? esp.qtdItensConcluidos ?? itensList.length);

    await prisma.progressaoEspecialidadePa.upsert({
      where: {
        cd_associado_cd_especialidade: {
          cd_associado,
          cd_especialidade: cdEsp,
        },
      },
      create: {
        cd_associado,
        especialidade_id: especialidadeId,
        cd_especialidade: cdEsp,
        ds_especialidade: dsEsp,
        nr_nivel: nrNivel,
        dt_nivel: validDtNivel,
        qtd_itens_concluidos: qtdItens,
        itens_detalhados: itensList as any,
      },
      update: {
        especialidade_id: especialidadeId,
        ds_especialidade: dsEsp,
        nr_nivel: nrNivel,
        dt_nivel: validDtNivel,
        qtd_itens_concluidos: qtdItens,
        itens_detalhados: itensList as any,
      },
    });
  }
}

export async function syncAssociado(cd_associado: string, cookie?: string) {
  const start = Date.now();
  try {
    // 1. Verifica se associado existe para identificar o ramo
    const existing = await prisma.associado.findUnique({
      where: { cd_associado },
    });

    const ramoEnum = existing?.ds_ramo || RamoEnum.ESCOTEIRO;
    const branchId = ramoToBranchId(ramoEnum);

    // 2. Busca dados no Paxtu com contexto de sessão
    const [caminhos, especialidades] = await Promise.all([
      fetchProgressao(cd_associado, branchId, cookie),
      fetchEspecialidadesCompletasAssociado(cd_associado, cookie),
    ]);

    // 3. Garante cadastro mínimo do associado
    if (!existing) {
      await prisma.associado.create({
        data: {
          cd_associado,
          nm_associado: `Associado ${cd_associado}`,
          ds_categoria: 'BENEFICIARIO',
          ds_ramo: ramoEnum,
          fl_status: 'ATIVO',
        },
      });
    }

    // 4. Salva dados no banco via Prisma
    await upsertProgressaoPaxtu(cd_associado, caminhos);
    await upsertProgressaoPa(cd_associado, caminhos, ramoEnum);
    await upsertEspecialidadesAssociado(cd_associado, especialidades);

    const duration = Date.now() - start;
    const logId = await logSync(
      'individual',
      'sucesso',
      cd_associado,
      {
        caminhosCount: caminhos.length,
        especialidadesCount: especialidades.length,
      },
      duration
    );

    return {
      success: true,
      cd_associado,
      duration_ms: duration,
      log_id: logId,
      caminhos_count: caminhos.length,
      especialidades_count: especialidades.length,
    };
  } catch (err: any) {
    const duration = Date.now() - start;
    await logSync('individual', 'erro', cd_associado, { error: err.message }, duration);
    throw err;
  }
}

export type SyncProgressEvent = {
  type: 'init' | 'fetch_members' | 'progress' | 'done' | 'error';
  message: string;
  current?: number;
  total?: number;
  nome?: string;
  cd_associado?: string;
  sucessos?: number;
  falhas?: number;
  duration_ms?: number;
  percent?: number;
};

export async function syncRamo(
  ramoInput: string | RamoEnum = 'Escoteiro',
  onProgress?: (event: SyncProgressEvent) => void,
  cookie?: string
) {
  if (isSyncInProgress) {
    throw new Error('Sincronização em massa já está em andamento. Aguarde a conclusão.');
  }

  isSyncInProgress = true;
  const start = Date.now();

  try {
    const ramoEnum = normalizeRamo(String(ramoInput));
    const ramoDisplay = ramoToDisplayName(ramoEnum);
    const branchId = ramoToBranchId(ramoEnum);

    onProgress?.({
      type: 'init',
      message: `Conectando ao Paxtu 100 para seção ${ramoDisplay}...`,
      percent: 5,
    });

    onProgress?.({
      type: 'fetch_members',
      message: `Buscando beneficiários ativos do Ramo ${ramoDisplay}...`,
      percent: 15,
    });

    // 1. Busca beneficiários do ramo via cURL params: branch_id, category=1, status=S
    const associados = await fetchAllAssociados({
      branchId,
      category: 1,
      status: 'S',
      cookie,
    });

    // Filtra membros pertencentes ao ramo
    const membros = associados.filter((a) => {
      try {
        return normalizeRamo(a.dsRamo) === ramoEnum;
      } catch {
        return true; // Se o Paxtu retornou na busca filtrada por branch_id, pertence ao ramo
      }
    });

    let sucessos = 0;
    let falhas = 0;
    const erros: { cd_associado: string; error: string }[] = [];

    // 2. Salva associados e atualiza inativos
    for (const a of membros) {
      await upsertAssociado(a, ramoEnum);
    }

    const activeIds = membros.map((m) => String(m.cd_associado));
    if (activeIds.length > 0) {
      await prisma.associado.updateMany({
        where: {
          ds_ramo: ramoEnum,
          cd_associado: { notIn: activeIds },
        },
        data: {
          fl_status: 'INATIVO',
        },
      });
    }

    const total = membros.length;

    if (total === 0) {
      const doneEvent: SyncProgressEvent = {
        type: 'done',
        message: `Nenhum membro ativo encontrado para o Ramo ${ramoDisplay} no Paxtu 100.`,
        current: 0,
        total: 0,
        percent: 100,
        sucessos: 0,
        falhas: 0,
        duration_ms: Date.now() - start,
      };
      onProgress?.(doneEvent);

      return {
        success: true,
        total_processados: 0,
        sucessos: 0,
        falhas: 0,
        duration_ms: Date.now() - start,
        status: 'sucesso',
      };
    }

    // 3. Controle de concorrência com semáforo: batch de 2 a 3 jovens com delay de 200ms
    const CONCURRENCY = 3;
    let completed = 0;

    for (let i = 0; i < total; i += CONCURRENCY) {
      const chunk = membros.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (m) => {
          try {
            const [caminhos, especialidades] = await Promise.all([
              fetchProgressao(m.cd_associado, branchId, cookie),
              fetchEspecialidadesCompletasAssociado(m.cd_associado, cookie),
            ]);

            await upsertProgressaoPaxtu(m.cd_associado, caminhos);
            await upsertProgressaoPa(m.cd_associado, caminhos, ramoEnum);
            await upsertEspecialidadesAssociado(m.cd_associado, especialidades);

            sucessos++;
          } catch (err: any) {
            falhas++;
            erros.push({ cd_associado: m.cd_associado, error: err.message });
          } finally {
            completed++;
            const percent = Math.round(20 + (completed / total) * 75);
            onProgress?.({
              type: 'progress',
              current: completed,
              total,
              percent,
              nome: m.nm_associado,
              cd_associado: m.cd_associado,
              message: `Sincronizando ${m.nm_associado} (${completed} de ${total})...`,
            });
          }
        })
      );

      // Delay de 200ms entre batches para evitar rate-limit
      if (i + CONCURRENCY < total) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    const duration = Date.now() - start;
    const status = falhas === 0 ? 'sucesso' : sucessos > 0 ? 'parcial' : 'erro';

    const logId = await logSync(
      `lote_${ramoDisplay.toLowerCase()}`,
      status,
      null,
      { ramo: ramoDisplay, total, sucessos, falhas, erros },
      duration
    );

    const doneEvent: SyncProgressEvent = {
      type: 'done',
      message: `Sincronização concluída: ${sucessos} jovem(ns) do Ramo ${ramoDisplay} sincronizado(s).`,
      current: total,
      total,
      percent: 100,
      sucessos,
      falhas,
      duration_ms: duration,
    };
    onProgress?.(doneEvent);

    return {
      success: status !== 'erro',
      log_id: logId,
      total_processados: total,
      sucessos,
      falhas,
      duration_ms: duration,
      status,
    };
  } finally {
    isSyncInProgress = false;
  }
}
