import type { Unit } from '../domain/types';

/**
 * Tamanho de embalagem lido da descrição ("SAB LQD OMO 3L", "MASSA ACRILICA 55KG",
 * "REFRI 6X350ML", "OVOS C/12"). Funções puras, sem I/O.
 *
 * Só reconhece peso, volume e contagem. Medidas de comprimento/área ("48MMx50M",
 * "60X70", "23CM", "G120") NÃO são embalagem e retornam null.
 */

export type BaseUnit = 'kg' | 'l' | 'un';

export interface PackageSize {
  /** Tamanho de UMA embalagem, em kg, l ou un (g e ml já convertidos). */
  size: number;
  unit: BaseUnit;
  /** Multipack ("12X1L", "C/12", "12UN"): quantas embalagens. Ausente = 1. */
  count?: number;
}

export interface NormalizedPrice {
  /** Centavos por kg, por litro ou por unidade. */
  cents: number;
  unit: BaseUnit;
}

const UNIT_RE = '(kg|g|gr|grs|ml|l|lt|lts|litro|litros)';
// "(?<![a-z0-9.])" evita pegar "g120", "a230" ou o "l" de "x50m"; "\b" evita "23cm", "48mm".
const MULTI = new RegExp(`(?<![a-z0-9.])(\\d{1,3})\\s*x\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT_RE}(?![a-z0-9])`);
const SIMPLE = new RegExp(`(?<![a-z0-9.])(\\d+(?:\\.\\d+)?)\\s*${UNIT_RE}(?![a-z0-9])`);
const COUNT_SLASH = /(?<![a-z0-9])c\/\s*(\d{1,3})(?![a-z0-9])/;
const COUNT_UN = /(?<![a-z0-9.])(\d{1,3})\s*(?:un|und|unid|unids|unidades)(?![a-z0-9])/;

function toBase(value: number, u: string): { size: number; unit: BaseUnit } {
  if (u === 'kg') return { size: value, unit: 'kg' };
  if (u === 'g' || u === 'gr' || u === 'grs') return { size: value / 1000, unit: 'kg' };
  if (u === 'ml') return { size: value / 1000, unit: 'l' };
  return { size: value, unit: 'l' }; // l, lt, lts, litro(s)
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function parsePackage(description: string): PackageSize | null {
  const s = description
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2');

  const mm = MULTI.exec(s);
  if (mm) {
    const count = Number(mm[1]);
    const v = Number(mm[2]);
    if (count >= 2 && v > 0) {
      const b = toBase(v, mm[3]!);
      return { size: round6(b.size), unit: b.unit, count };
    }
  }

  const count = (() => {
    const c = COUNT_SLASH.exec(s) ?? COUNT_UN.exec(s);
    const n = c ? Number(c[1]) : 0;
    return n >= 2 ? n : 0;
  })();

  const sm = SIMPLE.exec(s);
  if (sm) {
    const v = Number(sm[1]);
    if (v > 0) {
      const b = toBase(v, sm[2]!);
      return { size: round6(b.size), unit: b.unit, ...(count ? { count } : {}) };
    }
  }
  if (count) return { size: 1, unit: 'un', count };
  return null;
}

/** Quantidade total (em kg, l ou un) de uma embalagem, considerando multipack. */
export function packageTotal(p: PackageSize): number {
  return p.size * (p.count ?? 1);
}

/**
 * Preço normalizado (centavos por kg, l ou un) de uma linha de nota.
 * - Vendido a granel em kg/g/l/ml: o unitário já é por kg/l (g e ml convertidos).
 * - Vendido em 'un' (ou pct/cx/dz) com embalagem na descrição: unitário ÷ tamanho total.
 * - Caso contrário: null (não dá para comparar embalagens sem tamanho).
 */
export function normalizedUnitPrice(entry: { unit: Unit; unitPriceCents: number; rawDescription: string }): NormalizedPrice | null {
  const p = entry.unitPriceCents;
  if (!Number.isFinite(p) || p < 0) return null;
  switch (entry.unit) {
    case 'kg':
      return { cents: Math.round(p), unit: 'kg' };
    case 'g':
      return { cents: Math.round(p * 1000), unit: 'kg' };
    case 'l':
      return { cents: Math.round(p), unit: 'l' };
    case 'ml':
      return { cents: Math.round(p * 1000), unit: 'l' };
    default: {
      const pkg = parsePackage(entry.rawDescription);
      if (!pkg) return null;
      const total = packageTotal(pkg) * (entry.unit === 'dz' ? 12 : 1);
      return total > 0 ? { cents: Math.round(p / total), unit: pkg.unit } : null;
    }
  }
}

/** "R$ 4,30/kg" -> rótulo curto da unidade-base. */
export const baseUnitLabel = (u: BaseUnit): string => (u === 'l' ? 'L' : u);
