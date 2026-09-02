import { query, withTransaction } from '@/app/lib/db/pool';
import { fetchAllAssociados, fetchProgressao } from '@/app/lib/paxtu/client';
import type { Associado, Caminho } from '@/app/lib/data';

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

export async function upsertProgressaoEscoteiro(
  client: any,
  cd_associado: string,
  caminhos: Caminho[]
): Promise<void> {
  await client.query(
    `INSERT INTO progressoes_escoteiro (cd_associado, caminhos, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (cd_associado) DO UPDATE SET
       caminhos = EXCLUDED.caminhos,
       updated_at = CURRENT_TIMESTAMP`,
    [cd_associado, JSON.stringify(caminhos)]
  );

  // Normaliza atividades
  await client.query(`DELETE FROM atividades_escoteiro WHERE cd_associado = $1`, [cd_associado]);

  for (const caminho of caminhos) {
    if (!caminho.data) continue;
    for (const atv of caminho.data) {
      await client.query(
        `INSERT INTO atividades_escoteiro (
          cd_associado, cd_caminho, cd_competencia, ds_atividade,
          ds_desenvolvimento, check_jovem, check_escotista,
          dt_check_jovem, dt_check_escotista, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
        [
          cd_associado,
          atv.cdCaminho || null,
          atv.cdCompetencia || null,
          atv.dsAtividade || null,
          atv.dsDesenvolvimento || null,
          atv.checkJovem || null,
          atv.checkEscotista || null,
          atv.dtCheckJovem || null,
          atv.dtCheckEscotista || null,
        ]
      );
    }
  }
}

export async function syncAssociado(cd_associado: string) {
  const start = Date.now();
  try {
    const caminhos = await fetchProgressao(cd_associado);

    await withTransaction(async (client) => {
      await upsertProgressaoEscoteiro(client, cd_associado, caminhos);
    });

    const duration = Date.now() - start;
    const logId = await logSync('individual', 'sucesso', cd_associado, { caminhosCount: caminhos.length }, duration);

    return { success: true, cd_associado, duration_ms: duration, log_id: logId };
  } catch (err: any) {
    const duration = Date.now() - start;
    await logSync('individual', 'erro', cd_associado, { error: err.message }, duration);
    throw err;
  }
}

export async function syncEscoteiro() {
  if (isSyncInProgress) {
    throw new Error('Sincronização em massa já está em andamento. Aguarde a conclusão.');
  }

  isSyncInProgress = true;
  const start = Date.now();

  try {
    const associados = await fetchAllAssociados();
    const escoteiros = associados.filter(
      (a) => a.dsCategoria === 'Beneficiário' && a.dsRamo === 'Escoteiro'
    );

    let sucessos = 0;
    let falhas = 0;
    const erros: { cd_associado: string; error: string }[] = [];

    // Salva associados primeiro
    await withTransaction(async (client) => {
      for (const a of associados) {
        await upsertAssociado(client, a);
      }
    });

    for (const e of escoteiros) {
      try {
        const caminhos = await fetchProgressao(e.cd_associado);
        await withTransaction(async (client) => {
          await upsertProgressaoEscoteiro(client, e.cd_associado, caminhos);
        });
        sucessos++;
      } catch (err: any) {
        falhas++;
        erros.push({ cd_associado: e.cd_associado, error: err.message });
      }
    }

    const duration = Date.now() - start;
    const status = falhas === 0 ? 'sucesso' : sucessos > 0 ? 'parcial' : 'erro';

    const logId = await logSync(
      'lote_escoteiro',
      status,
      null,
      { total: escoteiros.length, sucessos, falhas, erros },
      duration
    );

    return {
      success: status !== 'erro',
      log_id: logId,
      total_processados: escoteiros.length,
      sucessos,
      falhas,
      duration_ms: duration,
      status,
    };
  } finally {
    isSyncInProgress = false;
  }
}
