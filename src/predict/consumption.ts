/**
 * Previsão de consumo (Fase 3): funções PURAS, sem I/O. O tempo (`now`) é injetado.
 *
 * Ideia: transformar o histórico de movimentos de UM produto em "amostras de taxa"
 * (unidades por dia) e usar a MEDIANA das últimas amostras — simples, explicável e robusta.
 *
 * Amostras (por compra, olhando a janela até a compra seguinte):
 *  (a) 'direto'   : estoque chegou a zero depois da compra (Acabou / baixas) → qtd do lote / dias até zerar;
 *  (b) 'consumo'  : houve "Usei" registrado na janela → consumido / dias;
 *  (c) 'assumido' : nenhum registro na janela → assume que o lote acabou na recompra (confiança limitada).
 * Recompra NÃO significa estoque zerado: se houve "ainda tem", ajuste ou descarte na janela, e nada
 * mais, a janela não gera amostra (não dá para saber quanto sobrou).
 */
import type { MovementKind, Unit } from '../domain/types';
import { stockOf } from '../pantry/pantry';

export const TZ = 'America/Sao_Paulo';
const DAY = 86_400_000;
const MAX_SAMPLES = 6;

export interface MovementLike {
  kind: MovementKind;
  delta: number;
  at: string;
  id?: string;
  deleted?: boolean;
}

export type Confidence = 'baixa' | 'media' | 'alta';
export const CONFIDENCE_LABEL: Record<Confidence, string> = { baixa: 'baixa', media: 'média', alta: 'alta' };

export interface ForecastOptions {
  unit?: Unit;
}

export interface Forecast {
  status: 'sem_dados' | 'poucos_dados' | 'ok';
  ratePerDay?: number;
  typicalQty?: number;
  typicalIntervalDays?: number;
  stockEstimate?: number;
  /** ISO. */
  depletionDate?: string;
  /** Dias até acabar (0 se já deveria ter acabado). */
  daysLeft?: number;
  confidence: Confidence;
  samples: number;
  explanation: string;
}

interface Batch {
  t: number;
  qty: number;
  /** Estoque logo depois da compra (inclui sobra anterior registrada). */
  stockAfter: number;
}
interface Sample {
  rate: number;
  kind: 'direto' | 'consumo' | 'assumido';
  /** Índice do lote que originou a amostra. */
  batch: number;
}

const fmtDay = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });

/** "dd/mm" no fuso de São Paulo. */
export function formatDayMonth(ms: number): string {
  return fmtDay.format(new Date(ms));
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function cv(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean <= 0) return 0;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(v) / mean;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

function fmtNum(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: n < 10 ? 2 : 1 });
}
function fmtQtyUnit(n: number, unit: Unit | undefined): string {
  const u = !unit ? '' : unit === 'l' ? ' L' : ` ${unit}`;
  return `${fmtNum(n)}${u}`;
}

function empty(status: Forecast['status'], explanation: string, samples = 0, stockEstimate?: number): Forecast {
  return { status, confidence: 'baixa', samples, explanation, ...(stockEstimate !== undefined ? { stockEstimate } : {}) };
}

export function forecastConsumption(movementsIn: MovementLike[], nowIn: Date | number | string, opts: ForecastOptions = {}): Forecast {
  const now = new Date(nowIn).getTime();
  const unit = opts.unit;
  const ms = movementsIn
    .filter((m) => !m.deleted && Number.isFinite(m.delta) && Number.isFinite(Date.parse(m.at)))
    .map((m) => ({ ...m, t: Date.parse(m.at) }))
    .filter((m) => m.t <= now)
    .sort((a, b) => a.t - b.t || ((a.id ?? '') < (b.id ?? '') ? -1 : 1));

  // 1) Lotes: compras do mesmo dia (ou a menos de 24 h uma da outra) somam.
  const batches: Batch[] = [];
  for (const m of ms) {
    if (m.kind !== 'compra' || !(m.delta > 0)) continue;
    const prev = batches[batches.length - 1];
    if (prev && (m.t - prev.t < DAY || dayKey.format(prev.t) === dayKey.format(m.t))) prev.qty += m.delta;
    else batches.push({ t: m.t, qty: m.delta, stockAfter: 0 });
  }
  if (batches.length === 0) return empty('sem_dados', 'Ainda não há compras registradas deste produto.');
  // Estoque "rastreado": sobra só é carregada para o lote seguinte se a janela anterior teve registros;
  // sem registros, assume-se que o lote anterior foi consumido (não acumula compras antigas).
  const lastIdx = batches.length - 1;
  const windows: typeof ms[] = [];
  let carry = 0;
  for (let i = 0; i <= lastIdx; i++) {
    const b = batches[i]!;
    const endT = i < lastIdx ? batches[i + 1]!.t : Infinity;
    const win = ms.filter((m) => m.t > batchEnd(b, batches, ms) && m.t < endT && m.kind !== 'compra');
    windows.push(win);
    b.stockAfter = round3(carry + b.qty);
    let run = b.stockAfter;
    for (const m of win) run = Math.max(0, round3(run + m.delta));
    const hadRecords = win.some((m) => m.kind !== 'ainda_tem');
    carry = hadRecords ? run : 0;
  }

  // 2) Amostras de taxa.
  const samples: Sample[] = [];
  for (let i = 0; i <= lastIdx; i++) {
    const b = batches[i]!;
    const endT = i < lastIdx ? batches[i + 1]!.t : Infinity;
    const win = windows[i]!;
    // (a) zerou depois da compra?
    let run = b.stockAfter;
    let zeroAt: number | undefined;
    for (const m of win) {
      run = Math.max(0, round3(run + m.delta));
      if (run === 0 && (m.delta < 0 || m.kind === 'esgotado') && b.stockAfter > 0) {
        zeroAt = m.t;
        break;
      }
    }
    if (zeroAt !== undefined) {
      const days = (zeroAt - b.t) / DAY;
      if (days >= 1) samples.push({ rate: b.stockAfter / days, kind: 'direto', batch: i });
      continue;
    }
    if (i === lastIdx) continue; // janela aberta: só observação direta vale
    const days = (endT - b.t) / DAY;
    if (days < 1) continue;
    const used = -win.filter((m) => m.kind === 'consumo').reduce((s, m) => s + m.delta, 0);
    if (used > 0) {
      samples.push({ rate: used / days, kind: 'consumo', batch: i });
    } else if (win.length === 0) {
      samples.push({ rate: b.qty / days, kind: 'assumido', batch: i });
    }
  }

  const direct = samples.filter((s) => s.kind === 'direto').length;
  if (batches.length < 2 && direct === 0) {
    return empty(
      'poucos_dados',
      'Poucos dados ainda: há só 1 compra registrada. A previsão aparece depois da próxima compra (ou quando você marcar “Acabou”).',
      0,
      stockOf(ms),
    );
  }
  if (samples.length === 0) {
    return empty('poucos_dados', 'Poucos dados ainda: não deu para medir quanto tempo cada compra durou.', 0, stockOf(ms));
  }

  // 3) Robustez: lotes extraordinários, atípicas e mudança de padrão.
  const notes: string[] = [];
  const recent = samples.slice(-MAX_SAMPLES);
  const qtys = batches.map((b) => b.qty);
  const qMed = batches.length >= 3 ? median(qtys) : NaN;
  const bigBatches = new Set<number>();
  batches.forEach((b, i) => {
    if (qMed > 0 && b.qty > 3 * qMed) bigBatches.add(i);
  });
  let pool = recent.filter((s) => !bigBatches.has(s.batch));
  if (bigBatches.size > 0 && pool.length > 0) {
    const i = [...bigBatches].pop()!;
    notes.push(`Ignorei a compra de ${fmtQtyUnit(batches[i]!.qty, unit)} em ${formatDayMonth(batches[i]!.t)}, fora do seu padrão.`);
  } else {
    pool = recent;
    bigBatches.clear();
  }

  let chosen = pool;
  let changed = false;
  if (pool.length >= 4) {
    const prevMed = median(pool.slice(0, -2).map((s) => s.rate));
    const last2 = pool.slice(-2);
    const dev = last2.map((s) => (s.rate - prevMed) / prevMed);
    if (prevMed > 0 && dev.every((d) => Math.abs(d) > 0.5) && dev[0]! * dev[1]! > 0) {
      chosen = last2;
      changed = true;
      notes.push('Seu consumo mudou nas últimas compras; usei só as mais recentes.');
    }
  }
  if (!changed && pool.length >= 3) {
    const med = median(pool.map((s) => s.rate));
    const kept = pool.filter((s) => s.rate <= 3 * med && s.rate >= med / 3);
    if (kept.length < pool.length && kept.length > 0) {
      notes.push('Descartei um período atípico (muito diferente dos demais).');
      chosen = kept;
    }
  }

  const rate = median(chosen.map((s) => s.rate));
  if (!(rate > 0)) return empty('poucos_dados', 'Poucos dados ainda: o consumo medido foi zero.', 0, stockOf(ms));

  const keptBatches = batches.filter((_, i) => !bigBatches.has(i));
  const typicalQty = r2(median(keptBatches.slice(-MAX_SAMPLES).map((b) => b.qty)));
  const gaps: number[] = [];
  for (let i = 1; i < batches.length; i++) gaps.push((batches[i]!.t - batches[i - 1]!.t) / DAY);
  const typicalIntervalDays = gaps.length ? r1(median(gaps.slice(-MAX_SAMPLES))) : undefined;

  // 4) Confiança.
  const n = chosen.length;
  const observed = chosen.some((s) => s.kind !== 'assumido');
  let confidence: Confidence = n >= 4 && cv(chosen.map((s) => s.rate)) < 0.35 && observed ? 'alta' : n >= 2 ? 'media' : 'baixa';
  if (!observed && confidence === 'alta') confidence = 'media';

  // 5) Estoque estimado e data de esgotamento.
  const last = batches[lastIdx]!;
  const lastStart = last.t;
  const after = windows[lastIdx]!.filter((m) => m.kind !== 'ainda_tem');
  let base = last.stockAfter;
  let anchor = lastStart;
  if (after.length > 0) {
    for (const m of after) base = Math.max(0, round3(base + m.delta));
    anchor = after[after.length - 1]!.t;
  }
  let depletion = anchor + (base / rate) * DAY;
  let stillT: number | undefined;
  const lastOut = Math.max(-Infinity, ...after.filter((m) => m.kind === 'esgotado').map((m) => m.t));
  const still = ms.filter((m) => m.kind === 'ainda_tem' && m.t > lastStart && m.t > lastOut);
  if (still.length > 0) stillT = still[still.length - 1]!.t;
  let pushed = false;
  if (stillT !== undefined && depletion < stillT) {
    const interval = typicalIntervalDays ?? (last.stockAfter / rate);
    depletion = stillT + 0.25 * interval * DAY;
    pushed = true;
  }
  const stockEstimate = depletion <= now ? 0 : Math.round(rate * ((depletion - now) / DAY) * 1000) / 1000;
  const daysLeft = Math.max(0, r1((depletion - now) / DAY));

  // 6) Explicação.
  const parts: string[] = [];
  const nBuys = batches.length;
  if (typicalIntervalDays !== undefined) {
    parts.push(`Você compra cerca de ${fmtQtyUnit(typicalQty, unit)} a cada ~${fmtNum(Math.round(typicalIntervalDays))} dias (${fmtQtyUnit(r2(rate), unit)}/dia).`);
  } else {
    parts.push(`Pelo que você registrou, o consumo é de cerca de ${fmtQtyUnit(r2(rate), unit)} por dia.`);
  }
  parts.push(`Última compra em ${formatDayMonth(lastStart)};`);
  parts.push(depletion <= now ? `já deveria ter acabado por volta de ${formatDayMonth(depletion)}.` : `deve acabar por volta de ${formatDayMonth(depletion)}.`);
  if (pushed) parts.push(`Você informou que ainda tinha em ${formatDayMonth(stillT!)}.`);
  parts.push(...notes);
  if (!observed) parts.push('Assumi que cada compra foi consumida até a seguinte.');
  parts.push(`Confiança ${CONFIDENCE_LABEL[confidence]} (${nBuys} ${nBuys === 1 ? 'compra' : 'compras'}).`);

  return {
    status: 'ok',
    ratePerDay: Math.round(rate * 10000) / 10000,
    typicalQty,
    ...(typicalIntervalDays !== undefined ? { typicalIntervalDays } : {}),
    stockEstimate,
    depletionDate: new Date(depletion).toISOString(),
    daysLeft,
    confidence,
    samples: n,
    explanation: parts.join(' '),
  };
}

/** Instante em que o lote termina de ser "somado" (mesmo dia): usa o último movimento de compra agrupado. */
function batchEnd(b: Batch, batches: Batch[], ms: { kind: MovementKind; t: number }[]): number {
  const idx = batches.indexOf(b);
  const next = batches[idx + 1]?.t ?? Infinity;
  let end = b.t;
  for (const m of ms) if (m.kind === 'compra' && m.t >= b.t && m.t < next) end = Math.max(end, m.t);
  return end;
}
