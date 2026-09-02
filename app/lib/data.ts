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

export type Escoteiro = {
  associado: Associado;
  progressao: Caminho[];
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

      if (resAssociados.rows.length > 0) {
        const progMap = new Map(resProgressoes.rows.map((p) => [p.cd_associado, p.caminhos]));
        return resAssociados.rows.map((r) => {
          const associado = (r as any).dados_cadastrais_completos as Associado;
          return {
            associado,
            progressao: progMap.get(associado.cd_associado) ?? [],
          };
        });
      }
    } catch (dbErr) {
      console.warn('[data] Falha ao consultar PostgreSQL, recorrendo ao fallback JSON local:', dbErr);
    }
  }

  // Fallback para os arquivos JSON locais pré-existentes
  const [associados, progressoes] = await Promise.all([
    readJson<Associado[]>('data/associados.json'),
    readJson<ProgressaoRecord[]>('data/progressoes.json'),
  ]);

  const progressaoPorId = new Map(progressoes.map((p) => [p.cd_associado, p]));

  return associados
    .filter((a) => a.dsCategoria === 'Beneficiário' && (!a.dsRamo || a.dsRamo === ramo))
    .map((associado) => ({
      associado,
      progressao: progressaoPorId.get(associado.cd_associado)?.caminhos ?? [],
    }))
    .sort((a, b) => a.associado.nm_associado.localeCompare(b.associado.nm_associado, 'pt-BR'));
}
