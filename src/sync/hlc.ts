/**
 * Hybrid Logical Clock (HLC).
 *
 * Formato serializado: "<ms:15 dígitos>:<contador:6 dígitos>:<deviceId>"
 * — comparável lexicograficamente, o que permite ordenar operações de forma
 * total e determinística em todos os dispositivos, mesmo com relógios
 * levemente dessincronizados.
 */

export interface Hlc {
  ms: number;
  counter: number;
  node: string;
}

/** Deriva máxima aceita de um relógio remoto antes de recusar adotá-lo. */
export const MAX_DRIFT_MS = 24 * 60 * 60 * 1000;
const MAX_COUNTER = 999_999;

export function serialize(h: Hlc): string {
  return `${String(h.ms).padStart(15, '0')}:${String(h.counter).padStart(6, '0')}:${h.node}`;
}

const HLC_RE = /^(\d{15}):(\d{6}):([A-Za-z0-9_-]{1,64})$/;

export function parse(s: string): Hlc {
  const m = HLC_RE.exec(s);
  if (!m) throw new Error(`HLC inválido: ${s}`);
  return { ms: Number(m[1]), counter: Number(m[2]), node: m[3]! };
}

export function isValidHlc(s: unknown): s is string {
  return typeof s === 'string' && HLC_RE.test(s);
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class HlcClock {
  private last: Hlc;

  constructor(
    private readonly node: string,
    private readonly now: () => number = () => Date.now(),
    initial?: string,
  ) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(node)) throw new Error('deviceId inválido para HLC');
    // Carimbo salvo inválido (ex.: corrompido) não pode impedir o app de abrir (QA-10).
    this.last = initial && isValidHlc(initial) ? { ...parse(initial), node } : { ms: 0, counter: 0, node };
  }

  /** Gera um novo carimbo para um evento local. */
  tick(): string {
    const wall = this.now();
    if (wall > this.last.ms) {
      this.last = { ms: wall, counter: 0, node: this.node };
    } else {
      this.last = { ms: this.last.ms, counter: this.last.counter + 1, node: this.node };
    }
    if (this.last.counter > MAX_COUNTER) {
      // Muitos eventos no mesmo ms: avança o tempo lógico.
      this.last = { ms: this.last.ms + 1, counter: 0, node: this.node };
    }
    return serialize(this.last);
  }

  /**
   * Incorpora um carimbo recebido de outro dispositivo, garantindo que eventos
   * locais futuros sejam ordenados depois dele. Carimbos absurdamente no futuro
   * (relógio remoto errado) não são adotados, para não "envenenar" o relógio.
   */
  receive(remote: string): void {
    const r = parse(remote);
    const wall = this.now();
    if (r.ms > wall + MAX_DRIFT_MS) return;
    const ms = Math.max(wall, this.last.ms, r.ms);
    let counter: number;
    if (ms === this.last.ms && ms === r.ms) counter = Math.max(this.last.counter, r.counter) + 1;
    else if (ms === this.last.ms) counter = this.last.counter + 1;
    else if (ms === r.ms) counter = r.counter + 1;
    else counter = 0;
    if (counter > MAX_COUNTER) {
      // QA-10: nunca produzir contador com mais de 6 dígitos.
      this.last = { ms: ms + 1, counter: 0, node: this.node };
      return;
    }
    this.last = { ms, counter, node: this.node };
  }

  /**
   * Garante que o próximo tick seja maior que `h`, SEM limite de deriva.
   * Usado para carimbos já confiáveis (o próprio relógio salvo por outra aba,
   * ou a versão atual de um campo que vamos sobrescrever — QA-06/QA-11).
   */
  observe(h: string): void {
    const r = parse(h);
    if (r.ms > this.last.ms || (r.ms === this.last.ms && r.counter > this.last.counter)) {
      this.last = r.counter >= MAX_COUNTER ? { ms: r.ms + 1, counter: 0, node: this.node } : { ms: r.ms, counter: r.counter, node: this.node };
    }
  }

  current(): string {
    return serialize(this.last);
  }
}
