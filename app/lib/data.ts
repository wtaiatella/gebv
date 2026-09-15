import prisma from '@/app/lib/prisma';
import { normalizeRamo, ramoToDisplayName, Ramo as RamoEnum } from '@/app/lib/ramo';
import { DataAccessError } from '@/app/lib/errors';

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

export type GetEscoteirosResult = {
  escoteiros: Escoteiro[];
  catalogoDisponivel: boolean;
};

export async function getEscoteiros(
  ramoInput: string | Ramo = 'Escoteiro'
): Promise<GetEscoteirosResult> {
  if (!process.env.DATABASE_URL) {
    throw new DataAccessError(
      'DATABASE_URL não configurada — leitura de domínio requer conexão com o PostgreSQL.'
    );
  }

  const ramoEnum = normalizeRamo(String(ramoInput));
  const ramoDisplay = ramoToDisplayName(ramoEnum);

  try {
    // 1. Busca associados com progressoes_pa, progressoes_especialidades e progressoes_especialidades_itens
    const associadosDb = await prisma.associado.findMany({
      where: {
        ds_categoria: 'BENEFICIARIO',
        ds_ramo: ramoEnum,
        fl_status: 'ATIVO',
      },
      include: {
        progressoes_pa: true,
        progressoes_especialidades: {
          include: {
            especialidade: true,
          },
          orderBy: [{ nr_nivel: 'desc' }, { ds_especialidade: 'asc' }],
        },
        progressoes_especialidades_itens: true,
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

    const catalogoItensMap = new Map<string, { id: number; cd_item: string; ds_item: string }[]>();
    for (const item of itensCatalogoDb) {
      if (!catalogoItensMap.has(item.cd_especialidade)) {
        catalogoItensMap.set(item.cd_especialidade, []);
      }
      catalogoItensMap.get(item.cd_especialidade)!.push({
        id: item.id,
        cd_item: item.cd_item,
        ds_item: item.ds_item,
      });
    }

    const catalogoDisponivel = caminhosCatalogoDb.length > 0;

    const escoteiros: Escoteiro[] = associadosDb.map((r) => {
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
      if (catalogoDisponivel) {
        const dbPaMap = new Map<number, (typeof r.progressoes_pa)[0]>();
        for (const p of r.progressoes_pa || []) {
          dbPaMap.set(p.atividade_id, p);
        }

        caminhos = caminhosCatalogoDb.map((camDb) => {
          const atividades: Atividade[] = [];

          for (const compDb of camDb.competencias) {
            for (const ativDb of compDb.atividades) {
              const pDb = dbPaMap.get(ativDb.id);

              const isEscotista = Boolean(pDb?.fl_check_escotista);
              const isJovem = Boolean(isEscotista || pDb?.fl_check_jovem);
              const dtDb = pDb?.dt_check_escotista || pDb?.dt_check_jovem;
              const dtStr = dtDb ? dtDb.toISOString().split('T')[0] : undefined;

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
      }

      // Monta especialidades e itens a partir das tabelas relacionais
      const itensAssociadoMap = new Map<number, (typeof r.progressoes_especialidades_itens)[0]>();
      for (const it of r.progressoes_especialidades_itens || []) {
        itensAssociadoMap.set(it.especialidade_item_id, it);
      }

      const especialidades: EscoteiroEspecialidade[] = r.progressoes_especialidades.map((esp) => {
        const catItens = catalogoItensMap.get(esp.cd_especialidade) || [];

        const mergedItens: ItemEspecialidade[] = catItens.map((cat) => {
          const relItem = itensAssociadoMap.get(cat.id);
          const flCheckEscotista = Boolean(relItem?.fl_check_escotista);
          const flCheckJovem = Boolean(flCheckEscotista || relItem?.fl_check_jovem);
          const flConquistado = flCheckEscotista;
          const dtItem = relItem?.dt_check_escotista || relItem?.dt_check_jovem;
          const dtNivelStr = esp.dt_nivel ? esp.dt_nivel.toISOString().split('T')[0] : undefined;
          const dtStr = dtItem
            ? dtItem.toISOString().split('T')[0]
            : (flConquistado ? dtNivelStr : undefined);

          return {
            cd_item: cat.cd_item,
            ds_item: cat.ds_item || `Item ${cat.cd_item}`,
            fl_conquistado: flConquistado,
            fl_check_escotista: flCheckEscotista,
            fl_check_jovem: flCheckJovem,
            dt_item: dtStr,
            nr_nivel: esp.nr_nivel,
            check_escotista: flCheckEscotista ? 'confirmadoEscotista' : undefined,
            check_jovem: flCheckJovem ? 'feitoJovem' : undefined,
          };
        });

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

    return {
      escoteiros,
      catalogoDisponivel,
    };
  } catch (dbErr) {
    if (dbErr instanceof DataAccessError) {
      throw dbErr;
    }
    throw new DataAccessError('Falha ao consultar PostgreSQL via Prisma.', dbErr);
  }
}
