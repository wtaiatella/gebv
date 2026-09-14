import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { query, withTransaction } from '@/app/lib/db/pool';
import { fetchAllAssociados, fetchProgressao, fetchEspecialidadesCompletasAssociado } from '@/app/lib/paxtu/client';
import type { Associado, Caminho } from '@/app/lib/data';
import { processarTransicaoAssociado } from './transicao-service';

let isSyncInProgress = false;

export async function logSync(
  tipo: 'lote_escoteiro' | 'individual',
  status: 'sucesso' | 'erro' | 'parcial',
  cd_associado: string | null,
  detalhes: any,
  duration_ms: number
): Promise<number> {
  const res = await query<{ id: number }>(
    `INSERT INTO sync_logs (tipo, status, cd_associado, detalhes, duration_ms)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tipo, status, cd_associado, JSON.stringify(detalhes), duration_ms]
  );
  return res.rows[0]?.id ?? 0;
}

export async function upsertAssociado(client: any, a: Associado): Promise<void> {
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
      a.cd_associado,
      a.nr_registro_formatado || null,
      a.nm_associado,
      a.dsCategoria,
      a.dsRamo || null,
      a.flStatus || null,
      a.dt_nascimento || null,
      a.ds_email || null,
      a.ds_telefone_cel || null,
      JSON.stringify(a),
    ]
  );
}

export async function upsertEspecialidadesAssociado(
  client: any,
  cd_associado: string,
  especialidades: any[]
): Promise<void> {
  if (!especialidades || especialidades.length === 0) return;

  const espDbRes = await client.query(`SELECT id, cd_especialidade FROM pa_especialidades`);
  const espDbMap = new Map(espDbRes.rows.map((r: any) => [String(r.cd_especialidade), r.id]));

  for (const esp of especialidades) {
    const rawCdEsp = esp.cd_especialidade || esp.cdEspecialidade;
    if (!rawCdEsp || rawCdEsp === 'undefined') continue;
    const cdEsp = String(rawCdEsp);
    const espId = espDbMap.get(cdEsp) || null;
    const dsEsp = esp.ds_especialidade || esp.dsEspecialidade || `Especialidade ${cdEsp}`;
    const nrNivel = Number(esp.nr_nivel ?? esp.nrNivel ?? 0);
    const dtNivel = esp.dt_nivel || esp.dtNivel || null;
    const qtdItens = Number(esp.qtd_itens_concluidos ?? esp.qtdItensConcluidos ?? (esp.itens_conquistados ? esp.itens_conquistados.length : (esp.itens_detalhados ? esp.itens_detalhados.length : 0)));
    const itensJson = JSON.stringify(esp.itens_conquistados || esp.itens_detalhados || []);

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
      [cd_associado, espId, cdEsp, dsEsp, nrNivel, dtNivel, qtdItens, itensJson]
    );
  }
}

export async function upsertProgressaoEscoteiro(
  client: any,
  cd_associado: string,
  caminhos: Caminho[],
  ds_ramo: string = 'Escoteiro'
): Promise<void> {
  // 1. Salva o JSON bruto como backup e auditoria histórica
  await client.query(
    `INSERT INTO progressoes_escoteiro (cd_associado, caminhos, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (cd_associado) DO UPDATE SET
       caminhos = EXCLUDED.caminhos,
       updated_at = CURRENT_TIMESTAMP`,
    [cd_associado, JSON.stringify(caminhos)]
  );

  // 2. Mapeamento de id de pa_atividades por (caminho_paxtu, ueb, ramo)
  const atvRes = await client.query(
    `SELECT a.id, c.cd_caminho_paxtu, a.cd_ueb
     FROM pa_atividades a
     JOIN pa_competencias comp ON a.competencia_id = comp.id
     JOIN pa_caminhos c ON comp.caminho_id = c.id
     WHERE a.ds_ramo = $1`,
    [ds_ramo]
  );
  const atvMap = new Map<string, number>(
    atvRes.rows.map((r: any) => [`${r.cd_caminho_paxtu}_${r.cd_ueb}`, r.id])
  );

  // 3. Desmembra cada atividade da UEB e faz UPSERT direto em escoteiro_pa_atividades
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
              cd_associado,
              atvDbId,
              flJovem,
              flEscotista,
              atv.dtCheckJovem || null,
              atv.dtCheckEscotista || null,
            ]
          );
        }
      }
    }
  }
}

export async function syncAssociado(cd_associado: string) {
  const start = Date.now();
  try {
    const [caminhos, especialidades] = await Promise.all([
      fetchProgressao(cd_associado),
      fetchEspecialidadesCompletasAssociado(cd_associado),
    ]);

    await withTransaction(async (client) => {
      // Garante que o associado existe no banco antes de inserir a progressão (satisfaz a FK)
      const resCheck = await client.query(
        'SELECT cd_associado FROM associados WHERE cd_associado = $1',
        [cd_associado]
      );

      if (resCheck.rows.length === 0) {
        // Tenta encontrar o associado nos arquivos locais pré-existentes
        let associado: Associado | undefined;
        try {
          const filePath = path.join(process.cwd(), 'data', 'associados.json');
          const raw = await readFile(filePath, 'utf-8');
          const list = JSON.parse(raw) as Associado[];
          associado = list.find((a) => a.cd_associado === cd_associado);
        } catch {
          // ignora erro de leitura local
        }

        if (associado) {
          await upsertAssociado(client, associado);
        } else {
          // Cria registro base mínimo para não violar a chave estrangeira
          await client.query(
            `INSERT INTO associados (
              cd_associado, nm_associado, ds_categoria, ds_ramo, dados_cadastrais_completos
            ) VALUES ($1, $2, 'Beneficiário', 'Escoteiro', '{}'::jsonb)
            ON CONFLICT (cd_associado) DO NOTHING`,
            [cd_associado, `Associado ${cd_associado}`]
          );
        }
      }

      await upsertProgressaoEscoteiro(client, cd_associado, caminhos);
      await upsertEspecialidadesAssociado(client, cd_associado, especialidades);
    });

    const duration = Date.now() - start;
    const logId = await logSync('individual', 'sucesso', cd_associado, { 
      caminhosCount: caminhos.length,
      especialidadesCount: especialidades.length,
    }, duration);

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
  ds_ramo: string = 'Escoteiro',
  onProgress?: (event: SyncProgressEvent) => void
) {
  if (isSyncInProgress) {
    throw new Error('Sincronização em massa já está em andamento. Aguarde a conclusão.');
  }

  isSyncInProgress = true;
  const start = Date.now();

  try {
    onProgress?.({
      type: 'init',
      message: 'Conectando ao Paxtu...',
      percent: 5,
    });

    onProgress?.({
      type: 'fetch_members',
      message: `Buscando membros do grupo no Paxtu...`,
      percent: 15,
    });

    const associados = await fetchAllAssociados();

    // Normaliza ramo para filtragem
    const targetRamo = ds_ramo.trim().toLowerCase();
    const membros = associados.filter((a) => {
      const catMatch = a.dsCategoria?.toLowerCase() === 'beneficiário' || a.dsCategoria?.toLowerCase() === 'beneficiario';
      if (!catMatch) return false;
      const statusRaw = (a.flStatus || a.fl_status || 'S').trim().toUpperCase();
      const isInactive = statusRaw === 'N' || statusRaw === 'I' || statusRaw === 'INATIVO' || statusRaw === 'FALSE' || statusRaw === '0' || statusRaw === 'DESLIGADO';
      if (isInactive) return false;
      const r = a.dsRamo?.toLowerCase() || '';
      return (
        r === targetRamo ||
        (targetRamo === 'escoteiro' && r.includes('escoteir')) ||
        (targetRamo === 'lobinho' && r.includes('lobinh')) ||
        (targetRamo === 'sênior' && (r.includes('senior') || r.includes('sênior'))) ||
        (targetRamo === 'pioneiro' && r.includes('pion'))
      );
    });

    let sucessos = 0;
    let falhas = 0;
    const erros: { cd_associado: string; error: string }[] = [];

    // Salva associados primeiro
    await withTransaction(async (client) => {
      for (const a of associados) {
        await upsertAssociado(client, a);
      }

      // Inativa no banco associados do ramo que não constam na lista ativa retornada pelo Paxtu
      const activeIds = membros.map((m) => String(m.cd_associado));
      if (activeIds.length > 0) {
        await client.query(
          `UPDATE associados 
           SET fl_status = 'Inativo', updated_at = CURRENT_TIMESTAMP 
           WHERE ds_ramo = $1 AND cd_associado != ALL($2::text[])`,
          [ds_ramo, activeIds]
        );
      }
    });

    const total = membros.length;

    if (total === 0) {
      const doneEvent: SyncProgressEvent = {
        type: 'done',
        message: `Nenhum membro encontrado no ramo "${ds_ramo}" no Paxtu.`,
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

    const CONCURRENCY = 3;
    let completed = 0;

    for (let i = 0; i < total; i += CONCURRENCY) {
      const chunk = membros.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (m) => {
          try {
            const [caminhos, especialidades] = await Promise.all([
              fetchProgressao(m.cd_associado, ds_ramo),
              fetchEspecialidadesCompletasAssociado(m.cd_associado),
            ]);
            await withTransaction(async (client) => {
              await upsertProgressaoEscoteiro(client, m.cd_associado, caminhos, ds_ramo);
              await upsertEspecialidadesAssociado(client, m.cd_associado, especialidades);
            });
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
    }


    const duration = Date.now() - start;
    const status = falhas === 0 ? 'sucesso' : sucessos > 0 ? 'parcial' : 'erro';

    const logId = await logSync(
      'lote_escoteiro',
      status,
      null,
      { ramo: ds_ramo, total, sucessos, falhas, erros },
      duration
    );

    const doneEvent: SyncProgressEvent = {
      type: 'done',
      message: `Sincronização concluída: ${sucessos} jovem(ns) atualizado(s).`,
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

export async function syncEscoteiro(onProgress?: (event: SyncProgressEvent) => void) {
  return syncRamo('Escoteiro', onProgress);
}
