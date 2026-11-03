/**
 * Merge determinístico por campo (LWW-register map) com detecção de conflitos.
 *
 * Propriedades garantidas (cobertas por testes):
 * - Comutativo e idempotente: aplicar o mesmo conjunto de operações em qualquer
 *   ordem, quantas vezes for, produz o mesmo estado em todos os dispositivos.
 * - Sem perda silenciosa: quando duas edições concorrentes tocam o mesmo campo
 *   com valores diferentes, o valor perdedor é preservado em um ConflictRecord
 *   (com id determinístico, igual em todos os aparelhos).
 */
import type { ConflictRecord, HlcString, SyncOp } from '../domain/types';
import { compare, parse } from './hlc';

export type AnyRecord = Record<string, unknown> & { id: string; householdId: string; _v: Record<string, HlcString> };

/** Campos que nunca podem ser alterados por uma operação. */
const PROTECTED_FIELDS = new Set(['id', 'householdId', '_v']);

/** Metadados/campos derivados: seguem LWW mas não geram alerta de conflito. */
const NO_CONFLICT_FIELDS = new Set(['updatedBy', 'normName']);

export interface ApplyResult {
  record: AnyRecord;
  changed: boolean;
  conflicts: ConflictRecord[];
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function conflictId(entityId: string, field: string, loserHlc: string): string {
  return `${entityId}|${field}|${loserHlc}`;
}

/**
 * Aplica uma operação a um registro (ou cria o registro, se inexistente).
 * Não muta a entrada.
 */
export function applyOp(current: AnyRecord | undefined, op: SyncOp, nowIso: string): ApplyResult {
  if (current && current.householdId !== op.householdId) {
    // Defesa em profundidade: jamais misturar dados de Casas diferentes.
    throw new Error('Operação de outra Casa rejeitada');
  }
  const record: AnyRecord = current
    ? { ...current, _v: { ...current._v } }
    : { id: op.entityId, householdId: op.householdId, _v: {} };
  const conflicts: ConflictRecord[] = [];
  let changed = !current;

  for (const [field, value] of Object.entries(op.fields)) {
    if (PROTECTED_FIELDS.has(field)) continue;
    const curHlc = record._v[field];
    const curVal = record[field];
    const base = op.base[field] ?? null;

    if (curHlc === op.hlc) continue; // eco da própria operação / reaplicação

    const opWins = curHlc === undefined || compare(op.hlc, curHlc) > 0;
    // Concorrência: o autor da operação não estava vendo a versão atual.
    // Edições do mesmo dispositivo são sempre sequenciais, nunca concorrentes.
    // base === hlc marca uma operação de "replay" (restauração de backup): nunca é conflito.
    const concurrent =
      base !== op.hlc &&
      !NO_CONFLICT_FIELDS.has(field) &&
      curHlc !== undefined &&
      base !== curHlc &&
      !(base !== null && compare(base, curHlc) > 0) &&
      parse(curHlc).node !== parse(op.hlc).node;

    if (concurrent && !sameValue(curVal, value)) {
      const winner = opWins ? { v: value, h: op.hlc } : { v: curVal, h: curHlc! };
      const loser = opWins ? { v: curVal, h: curHlc! } : { v: value, h: op.hlc };
      conflicts.push({
        id: conflictId(op.entityId, field, loser.h),
        householdId: op.householdId,
        entity: op.entity,
        entityId: op.entityId,
        field,
        winnerValue: winner.v,
        winnerHlc: winner.h,
        loserValue: loser.v,
        loserHlc: loser.h,
        detectedAt: nowIso,
        resolved: false,
      });
    }

    if (opWins) {
      record[field] = value;
      record._v[field] = op.hlc;
      changed = true;
    }
  }
  return { record, changed, conflicts };
}

/**
 * Mescla dois snapshots completos do mesmo registro (usado na restauração de
 * backup): para cada campo, vence a versão HLC maior.
 */
export function mergeRecords(a: AnyRecord | undefined, b: AnyRecord): AnyRecord {
  if (!a) return { ...b, _v: { ...b._v } };
  if (a.householdId !== b.householdId || a.id !== b.id) throw new Error('Registros incompatíveis');
  const out: AnyRecord = { ...a, _v: { ...a._v } };
  for (const [field, hlc] of Object.entries(b._v)) {
    if (PROTECTED_FIELDS.has(field)) continue;
    const cur = out._v[field];
    if (cur === undefined || compare(hlc, cur) > 0) {
      out[field] = b[field];
      out._v[field] = hlc;
    }
  }
  return out;
}
