import { Ramo } from '@prisma/client';

export { Ramo };

/**
 * Normaliza qualquer variação de string de ramo ('Sênior', 'senior', 'SENIOR', 'Escoteiro', etc.)
 * para o enum Ramo oficial.
 * Retorna null caso a entrada não corresponda a nenhum dos 4 ramos oficiais (ex: adultos, dirigentes).
 */
export function normalizeRamo(input: string | null | undefined): Ramo {
  const normalized = normalizeRamoOrNull(input);
  if (!normalized) {
    throw new Error(`Ramo inválido: "${input}". Ramos permitidos: LOBINHO, ESCOTEIRO, SENIOR, PIONEIRO.`);
  }
  return normalized;
}

export function normalizeRamoOrNull(input: string | null | undefined): Ramo | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  // Remove espaços extras e converte para minúsculo sem acentos
  const cleaned = input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  switch (cleaned) {
    case 'lobinho':
      return Ramo.LOBINHO;
    case 'escoteiro':
      return Ramo.ESCOTEIRO;
    case 'senior':
      return Ramo.SENIOR;
    case 'pioneiro':
      return Ramo.PIONEIRO;
    default:
      return null;
  }
}

/**
 * Retorna o branch_id correspondente no Paxtu 100
 * 1 = Escoteiro, 2 = Lobinho, 3 = Sênior, 4 = Pioneiro
 */
export function ramoToBranchId(ramo: Ramo): number {
  switch (ramo) {
    case Ramo.ESCOTEIRO:
      return 1;
    case Ramo.LOBINHO:
      return 2;
    case Ramo.SENIOR:
      return 3;
    case Ramo.PIONEIRO:
      return 4;
  }
}

/**
 * Converte branch_id do Paxtu 100 para o enum Ramo
 */
export function branchIdToRamo(branchId: number): Ramo {
  switch (branchId) {
    case 1:
      return Ramo.ESCOTEIRO;
    case 2:
      return Ramo.LOBINHO;
    case 3:
      return Ramo.SENIOR;
    case 4:
      return Ramo.PIONEIRO;
    default:
      throw new Error(`branch_id desconhecido no Paxtu 100: ${branchId}`);
  }
}

/**
 * Retorna o rótulo legível em formato capitalizado com acento
 */
export function ramoToDisplayName(ramo: Ramo): string {
  switch (ramo) {
    case Ramo.LOBINHO:
      return 'Lobinho';
    case Ramo.ESCOTEIRO:
      return 'Escoteiro';
    case Ramo.SENIOR:
      return 'Sênior';
    case Ramo.PIONEIRO:
      return 'Pioneiro';
  }
}
