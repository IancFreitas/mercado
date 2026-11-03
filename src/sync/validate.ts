/**
 * Validação de operações recebidas (do servidor ou de backups).
 * Dados remotos são tratados como não confiáveis.
 */
import { isSyncEntity, type SyncOp } from '../domain/types';
import { isValidHlc } from './hlc';
import { MAX_OP_BYTES } from './transport';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_RE = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;

export function isUuid(x: unknown): x is string {
  return typeof x === 'string' && UUID_RE.test(x);
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
}

export function validateOp(raw: unknown): SyncOp {
  if (!isPlainObject(raw)) throw new Error('op: não é objeto');
  const { opId, householdId, entity, entityId, hlc, deviceId, fields, base } = raw;
  if (!isUuid(opId)) throw new Error('op: opId inválido');
  if (!isUuid(householdId)) throw new Error('op: householdId inválido');
  if (!isSyncEntity(entity)) throw new Error('op: entidade desconhecida');
  if (!isUuid(entityId)) throw new Error('op: entityId inválido');
  if (!isValidHlc(hlc)) throw new Error('op: hlc inválido');
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) throw new Error('op: deviceId inválido');
  if (!isPlainObject(fields) || !isPlainObject(base)) throw new Error('op: fields/base inválidos');
  for (const k of Object.keys(fields)) {
    if (!FIELD_RE.test(k) || k === 'id' || k === 'householdId') throw new Error(`op: campo proibido ${k}`);
    const v = fields[k];
    const t = typeof v;
    if (!(v === null || t === 'string' || t === 'number' || t === 'boolean' || isPlainObject(v) || Array.isArray(v))) {
      throw new Error(`op: valor inválido em ${k}`);
    }
    if (t === 'number' && !Number.isFinite(v)) throw new Error(`op: número inválido em ${k}`);
  }
  for (const [k, v] of Object.entries(base)) {
    if (!(k in fields)) throw new Error('op: base sem campo correspondente');
    if (v !== null && !isValidHlc(v)) throw new Error('op: base inválida');
  }
  if (new TextEncoder().encode(JSON.stringify(fields) + JSON.stringify(base)).length > MAX_OP_BYTES) throw new Error('op: muito grande');
  // O nó do HLC deve ser o próprio aparelho (QA-19; mesma regra no servidor).
  if (hlc.split(':')[2] !== deviceId) throw new Error('op: nó do HLC difere do aparelho');
  const op: SyncOp = {
    opId,
    householdId,
    entity,
    entityId,
    hlc,
    deviceId,
    fields: { ...fields },
    base: { ...(base as Record<string, string | null>) },
  };
  if (typeof raw.seq === 'number') op.seq = raw.seq;
  if (typeof raw.userId === 'string') op.userId = raw.userId;
  if (entity === 'households' && entityId !== householdId) throw new Error('op: Casa inconsistente');
  return op;
}
