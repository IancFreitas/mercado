import type { SyncOp } from '../domain/types';

/**
 * Camada de transporte desacoplada. O motor de sincronização só conhece esta
 * interface; a implementação pode ser Supabase, um servidor em memória (testes)
 * ou outro backend no futuro.
 */
export interface SyncTransport {
  /** Envia operações. Deve ser idempotente por opId. Retorna os opIds aceitos. */
  push(householdId: string, ops: SyncOp[]): Promise<{ accepted: string[] }>;
  /** Busca operações com seq > sinceSeq, em ordem crescente de seq. */
  pull(householdId: string, sinceSeq: number, limit: number): Promise<{ ops: SyncOp[]; hasMore: boolean }>;
}

export class ForbiddenError extends Error {
  constructor(msg = 'Acesso negado a esta Casa') {
    super(msg);
    this.name = 'ForbiddenError';
  }
}

export class NetworkError extends Error {
  constructor(msg = 'Sem conexão com o servidor') {
    super(msg);
    this.name = 'NetworkError';
  }
}

export const MAX_OPS_PER_PUSH = 200;
/**
 * Limite de fields+base em JSON no cliente. O servidor aceita até 16 KiB do
 * texto jsonb (que inclui espaços extras) — a margem 2× evita divergência (QA-09).
 */
export const MAX_OP_BYTES = 8 * 1024;
