/**
 * Servidor de sincronização em memória.
 *
 * Reproduz as regras do backend Supabase (supabase/migrations) para testes
 * automatizados e para o modo de demonstração local:
 * - autenticação por token → usuário;
 * - autorização por associação à Casa (equivalente às políticas RLS);
 * - sequência total por Casa; push idempotente por opId;
 * - convites com código de uso limitado e expiração.
 *
 * NÃO é usado em produção para dados reais entre aparelhos.
 */
import type { SyncOp } from '../domain/types';
import { ForbiddenError, MAX_OPS_PER_PUSH, NetworkError, type SyncTransport } from './transport';
import { validateOp } from './validate';
import { MAX_DRIFT_MS, parse } from './hlc';

interface Invite {
  codeHash: string;
  householdId: string;
  expiresAt: number;
  usesLeft: number;
  revoked: boolean;
}

export class MemorySyncServer {
  private seq = 0;
  private ops: (SyncOp & { seq: number; userId: string })[] = [];
  /** Unicidade por Casa: `${householdId}|${opId}` (QA-07). */
  private opIds = new Set<string>();
  private members = new Map<string, Set<string>>(); // householdId → userIds
  private invites: Invite[] = [];
  online = true;

  constructor(private readonly now: () => number = () => Date.now()) {}

  isMember(householdId: string, userId: string): boolean {
    return this.members.get(householdId)?.has(userId) ?? false;
  }

  createHousehold(userId: string, householdId: string): void {
    if (this.members.has(householdId)) throw new ForbiddenError('Casa já existe');
    this.members.set(householdId, new Set([userId]));
  }

  createInvite(userId: string, householdId: string, code: string, ttlMs = 48 * 3600_000): void {
    if (!this.isMember(householdId, userId)) throw new ForbiddenError();
    this.invites.push({ codeHash: code, householdId, expiresAt: this.now() + ttlMs, usesLeft: 1, revoked: false });
  }

  acceptInvite(userId: string, code: string): string {
    const inv = this.invites.find((i) => i.codeHash === code);
    if (!inv || inv.revoked || inv.usesLeft <= 0 || inv.expiresAt < this.now()) throw new ForbiddenError('Convite inválido');
    inv.usesLeft--;
    this.members.get(inv.householdId)!.add(userId);
    return inv.householdId;
  }

  removeMember(householdId: string, userId: string): void {
    this.members.get(householdId)?.delete(userId);
  }

  push(userId: string, householdId: string, ops: SyncOp[]): { accepted: string[] } {
    if (!this.online) throw new NetworkError();
    if (!this.isMember(householdId, userId)) throw new ForbiddenError();
    if (ops.length > MAX_OPS_PER_PUSH) throw new Error('Lote muito grande');
    // Mesmas regras de push_ops: rejeição POR OPERAÇÃO, nunca do lote inteiro (QA-08).
    const accepted: string[] = [];
    for (const raw of ops) {
      let op: SyncOp;
      try {
        op = validateOp(raw);
      } catch {
        continue;
      }
      if (op.householdId !== householdId) continue;
      if (parse(op.hlc).ms > this.now() + MAX_DRIFT_MS) continue; // QA-05
      const key = `${householdId}|${op.opId}`;
      if (!this.opIds.has(key)) {
        this.opIds.add(key);
        this.ops.push({ ...op, seq: ++this.seq, userId });
      }
      accepted.push(op.opId);
    }
    return { accepted };
  }

  pull(userId: string, householdId: string, since: number, limit: number): { ops: SyncOp[]; hasMore: boolean } {
    if (!this.online) throw new NetworkError();
    if (!this.isMember(householdId, userId)) throw new ForbiddenError();
    const all = this.ops.filter((o) => o.householdId === householdId && o.seq > since);
    return { ops: structuredClone(all.slice(0, limit)), hasMore: all.length > limit };
  }

  /** Apenas para testes: total de operações armazenadas por Casa. */
  countOps(householdId: string): number {
    return this.ops.filter((o) => o.householdId === householdId).length;
  }

  transportFor(userId: string): SyncTransport {
    return {
      push: async (hid, ops) => this.push(userId, hid, structuredClone(ops)),
      pull: async (hid, since, limit) => this.pull(userId, hid, since, limit),
    };
  }
}
