/**
 * Interpreta o texto copiado da página de consulta pública da NFC-e (SEFAZ-SP).
 *
 * Função pura, sem rede. PRIVACIDADE: a página mostra, depois do bloco dos itens, a seção
 * "Chave de acesso" com CPF/nome/endereço do consumidor. Tudo a partir do primeiro
 * "Chave de acesso" é descartado ANTES de qualquer interpretação.
 */
import type { Unit } from '../domain/types';

export const MAX_SEFAZ_TEXT_BYTES = 200 * 1024;

export class SefazTextError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SefazTextError';
  }
}

export interface ParsedNfceItem {
  description: string;
  code?: string;
  quantity: number;
  unit: Unit;
  /** Unidade original, só quando não reconhecida (unit cai para 'un'). */
  rawUnit?: string;
  unitPriceCents: number;
  totalCents: number;
}

export interface ParsedNfce {
  items: ParsedNfceItem[];
  totals: {
    itemsCount?: number;
    totalCents?: number;
    discountCents: number;
    otherCents: number;
    payableCents?: number;
  };
  payment?: { method: string; amountCents: number };
  number?: number;
  series?: number;
  /** ISO (UTC) a partir do horário de Brasília (-03:00). */
  emittedAt?: string;
  environment?: 1 | 2;
  /** CNPJ do emitente (só dígitos), se aparecer antes da chave. */
  issuerCnpj?: string;
  warnings: string[];
  consistent: boolean;
}

const UNIT_MAP: Record<string, Unit> = {
  UN: 'un', UND: 'un', UNID: 'un', UNIDADE: 'un',
  KG: 'kg', QUILO: 'kg',
  G: 'g', GR: 'g',
  L: 'l', LT: 'l', LTS: 'l',
  ML: 'ml',
  PC: 'pct', PCT: 'pct', PCTE: 'pct',
  CX: 'cx', CXA: 'cx',
  DZ: 'dz', DUZIA: 'dz',
};

/** "1.234,56" | "12,5" | "0.7" → número. Vários pontos = milhar; um ponto sem vírgula = decimal. */
function parseDecimal(raw: string): number {
  let s = raw.trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const toCents = (n: number) => Math.round(n * 100 + 1e-9);
const NUM = '[\\d.,]+';

/** Tetos de sanidade (texto colado é entrada não confiável; também respeitam o limite de 8 KiB por operação). */
const MAX_QTY = 1_000_000;
const MAX_ITEM_CENTS = 100_000_000; // R$ 1 milhão por item/unitário
const MAX_TOTAL_CENTS = 1_000_000_000; // R$ 10 milhões nos totais da nota
const MAX_CODE = 40;
const MAX_RAW_UNIT = 10;
const MAX_METHOD = 60;

function money(text: string, re: RegExp): number | undefined {
  const m = re.exec(text);
  if (!m) return undefined;
  const n = parseDecimal(m[1]!);
  if (Number.isNaN(n)) return undefined;
  const c = toCents(n);
  return Number.isSafeInteger(c) && c >= 0 && c <= MAX_TOTAL_CENTS ? c : undefined;
}

export function parseSefazText(input: string): ParsedNfce {
  if (typeof input !== 'string') throw new SefazTextError('Texto inválido');
  if (new TextEncoder().encode(input).length > MAX_SEFAZ_TEXT_BYTES) {
    throw new SefazTextError('Texto grande demais (limite de 200 KB) — copie só do primeiro produto até antes de "Chave de acesso"');
  }
  let text = input.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  // Corta na chave de acesso: nada depois dela é lido.
  const cut = /chave\s*de\s*acesso/i.exec(text);
  if (cut) text = text.slice(0, cut.index);

  const warnings: string[] = [];

  // --- Itens ---
  const itemRe = new RegExp(
    `Qtde\\.?\\s*:\\s*(${NUM})\\s*UN\\s*:\\s*([^\\s]+)\\s*Vl\\.?\\s*Unit\\.?\\s*:\\s*(${NUM})` +
      `(?:\\s*Vl\\.?\\s*Total\\s*:?\\s*(?:R\\$)?\\s*(${NUM})[ \\t]*(?=\\n|$))?`,
    'gi',
  );
  const items: ParsedNfceItem[] = [];
  /** Soma dos totais calculados com preço unitário exato (para a checagem qtd × unitário). */
  const exactTotals: number[] = [];
  let rejected = 0;
  let prevEnd = 0;
  let itemsEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(text))) {
    const segment = text.slice(prevEnd, m.index);
    prevEnd = itemRe.lastIndex;
    itemsEnd = prevEnd;
    const lines = segment.split('\n').map((l) => l.trim()).filter(Boolean);
    let desc = lines[lines.length - 1] ?? '';
    let code: string | undefined;
    const cm = /\(\s*C[óo]digo\s*:\s*([^)]*?)\s*\)/i.exec(desc);
    if (cm) {
      code = cm[1]!.trim().slice(0, MAX_CODE) || undefined;
      desc = desc.replace(cm[0], '');
    }
    desc = desc.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!desc) {
      desc = '(sem descrição)';
      warnings.push(`Item ${items.length + 1}: descrição não encontrada`);
    }
    const qty = parseDecimal(m[1]!);
    const unitPrice = parseDecimal(m[3]!);
    if (!(qty > 0) || Number.isNaN(unitPrice)) {
      warnings.push(`Item "${desc}": quantidade ou preço ilegível — ignorado`);
      continue;
    }
    const rawU = m[2]!.replace(/[.,;:]+$/g, '').toUpperCase().slice(0, MAX_RAW_UNIT);
    const unit = UNIT_MAP[rawU];
    const exact = qty * unitPrice * 100;
    const tc = m[4] !== undefined ? parseDecimal(m[4]) : NaN;
    if (
      qty > MAX_QTY || unitPrice * 100 > MAX_ITEM_CENTS || !(exact <= MAX_ITEM_CENTS * 10) ||
      (!Number.isNaN(tc) && tc * 100 > MAX_ITEM_CENTS)
    ) {
      warnings.push(`Item "${desc}": quantidade ou valor fora do limite aceito — ignorado`);
      rejected++;
      continue;
    }
    let totalCents: number;
    if (m[4] !== undefined && !Number.isNaN(parseDecimal(m[4]))) totalCents = toCents(parseDecimal(m[4]));
    else {
      totalCents = Math.round(exact);
      warnings.push(`Item "${desc}": total não encontrado — calculado por quantidade × unitário`);
    }
    const item: ParsedNfceItem = {
      description: desc,
      quantity: Math.round(qty * 1000) / 1000,
      unit: unit ?? 'un',
      unitPriceCents: toCents(unitPrice),
      totalCents,
    };
    if (code) item.code = code;
    if (!unit) {
      item.rawUnit = rawU;
      warnings.push(`Item "${desc}": unidade "${rawU}" desconhecida — usei "un"`);
    }
    items.push(item);
    exactTotals.push(exact);
  }
  if (items.length === 0) {
    throw new SefazTextError('Não encontrei itens no texto colado — copie a partir do primeiro produto');
  }

  // --- Totais e demais campos (só depois do último item, evita confundir com descrições) ---
  const tail = text.slice(itemsEnd);
  const countM = /Qtd\.?\s*total\s*de\s*itens\s*:?\s*(\d+)/i.exec(tail);
  const itemsCount = countM ? Number(countM[1]) : undefined;
  const totalCents = money(tail, new RegExp(`Valor\\s+total\\s*R\\$\\s*:?\\s*(${NUM})`, 'i'));
  const discountCents = money(tail, new RegExp(`Descontos?\\s*R\\$\\s*:?\\s*(${NUM})`, 'i')) ?? 0;
  let otherCents = 0;
  for (const om of tail.matchAll(new RegExp(`(?:Outras\\s+despesas|Acr[ée]scimos?)\\s*R\\$\\s*:?\\s*(${NUM})`, 'gi'))) {
    const n = parseDecimal(om[1]!);
    if (!Number.isNaN(n)) otherCents += toCents(n);
  }
  const payableCents = money(tail, new RegExp(`Valor\\s+a\\s+pagar\\s*R\\$\\s*:?\\s*(${NUM})`, 'i'));

  let payment: ParsedNfce['payment'];
  const pm = new RegExp(
    `Forma\\s+de\\s+pagamento\\s*:?\\s*(?:Valor\\s+pago\\s*R\\$\\s*:?)?\\s*([^\\d\\n$:]+?)\\s*:?\\s*(?:R\\$)?\\s*(${NUM})`,
    'i',
  ).exec(tail);
  if (pm) {
    const n = parseDecimal(pm[2]!);
    const method = pm[1]!.replace(/\s+/g, ' ').trim();
    if (method && !Number.isNaN(n) && toCents(n) <= MAX_TOTAL_CENTS) payment = { method: method.slice(0, MAX_METHOD), amountCents: toCents(n) };
  }

  const result: ParsedNfce = {
    items,
    totals: { discountCents, otherCents },
    warnings,
    consistent: true,
  };
  if (itemsCount !== undefined) result.totals.itemsCount = itemsCount;
  if (totalCents !== undefined) result.totals.totalCents = totalCents;
  if (payableCents !== undefined) result.totals.payableCents = payableCents;
  if (payment) result.payment = payment;

  // --- Cabeçalho (procura no texto cortado inteiro) ---
  const numM = /N[úu]mero\s*:\s*(\d+)/i.exec(text);
  if (numM) result.number = Number(numM[1]);
  const serM = /S[ée]rie\s*:\s*(\d+)/i.exec(text);
  if (serM) result.series = Number(serM[1]);
  const emM = /Emiss[ãa]o\s*:\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/i.exec(text);
  if (emM) {
    const d = new Date(`${emM[3]}-${emM[2]}-${emM[1]}T${emM[4]}:${emM[5]}:${emM[6] ?? '00'}-03:00`);
    if (!Number.isNaN(d.getTime())) result.emittedAt = d.toISOString();
  }
  const envM = /Ambiente\s+de\s+(Produ[çc][ãa]o|Homologa[çc][ãa]o)/i.exec(text);
  if (envM) result.environment = /^p/i.test(envM[1]!) ? 1 : 2;
  const cnpjM = /CNPJ\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i.exec(text);
  if (cnpjM) result.issuerCnpj = cnpjM[1]!.replace(/\D/g, '');

  // --- Consistência ---
  const bad = (msg: string) => {
    warnings.push(msg);
    result.consistent = false;
  };
  if (rejected > 0) bad(`${rejected} item(ns) ignorado(s) por valor ou quantidade fora do limite`);
  const fmt = (c: number) => (c / 100).toFixed(2).replace('.', ',');
  items.forEach((it, i) => {
    // Tolerância de 1 centavo (o unitário exibido já traz as casas decimais usadas no cálculo).
    if (Math.abs(exactTotals[i]! - it.totalCents) > 1.0001) {
      bad(`Item "${it.description}": quantidade × unitário (${fmt(Math.round(exactTotals[i]!))}) difere do total (${fmt(it.totalCents)})`);
    }
  });
  const sum = items.reduce((s, it) => s + it.totalCents, 0);
  if (totalCents === undefined) {
    bad('Não encontrei "Valor total R$" — copie o texto até o fim dos totais');
  } else if (Math.abs(sum - totalCents) > items.length) {
    bad(`A soma dos itens (R$ ${fmt(sum)}) não bate com o valor total da nota (R$ ${fmt(totalCents)}) — faltou algum item na cópia?`);
  }
  if (itemsCount !== undefined && itemsCount !== items.length) {
    bad(`A nota informa ${itemsCount} itens, mas encontrei ${items.length}`);
  }
  if (totalCents !== undefined && payableCents !== undefined) {
    const expected = totalCents - discountCents + otherCents;
    if (Math.abs(expected - payableCents) > 1) {
      bad(`Valor a pagar (R$ ${fmt(payableCents)}) difere de total − descontos + outras despesas (R$ ${fmt(expected)})`);
    }
  }
  return result;
}
