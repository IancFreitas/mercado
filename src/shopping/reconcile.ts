import { descTokens, matchesListItem } from '../prices/priceMatch';

/**
 * Reconciliação do Modo compras com a NFC-e importada. Pura.
 * Casa itens MARCADOS da lista com itens da nota (mesma regra de matchesListItem);
 * cada item da nota é usado no máximo uma vez (nomes mais específicos primeiro).
 */

export interface ReconListItem {
  id: string;
  name: string;
  foundPriceCents?: number;
}
export interface ReconNoteItem {
  id: string;
  rawDescription: string;
  unitPriceCents: number;
  quantity: number;
}

export interface ReconMatch {
  listItem: ReconListItem;
  noteItem: ReconNoteItem;
  foundCents?: number;
  paidCents: number;
  /** pago - encontrado (positivo = pagou mais que o anotado). Ausente se não houve preço encontrado. */
  diffCents?: number;
  /** Casamento frouxo: a nota começa com outra palavra ("CREME DE LEITE" para "Leite") ou há mais de um candidato. Não vem pré-selecionado. */
  loose: boolean;
}

export interface Reconciliation {
  matched: ReconMatch[];
  /** Marcados na lista que não aparecem na nota. */
  unmatchedList: ReconListItem[];
  /** Itens da nota que não estavam na lista marcada. */
  unmatchedNote: ReconNoteItem[];
}

const firstWord = (s: string) => descTokens(s).words[0] ?? '';

export function reconcile(checkedItems: ReconListItem[], noteItems: ReconNoteItem[]): Reconciliation {
  const used = new Set<string>();
  const byList = new Map<string, ReconMatch>();
  const wordCount = (s: string) => s.trim().split(/\s+/).length;
  const order = [...checkedItems].sort((a, b) => wordCount(b.name) - wordCount(a.name));
  for (const li of order) {
    const cands = noteItems.filter((n) => !used.has(n.id) && matchesListItem(li.name, n.rawDescription));
    if (cands.length === 0) continue;
    // Mais próximo primeiro: nota que começa pela palavra da lista, depois menos palavras extras.
    const ranked = cands
      .map((n, idx) => ({ n, idx, lead: leadsWithListWord(li.name, n.rawDescription) ? 0 : 1, extra: descTokens(n.rawDescription).words.length }))
      .sort((x, y) => x.lead - y.lead || x.extra - y.extra || x.idx - y.idx);
    const best = ranked[0]!;
    used.add(best.n.id);
    const found = li.foundPriceCents;
    byList.set(li.id, {
      listItem: li,
      noteItem: best.n,
      paidCents: best.n.unitPriceCents,
      loose: best.lead === 1 || cands.length > 1,
      ...(found !== undefined ? { foundCents: found, diffCents: best.n.unitPriceCents - found } : {}),
    });
  }
  return {
    matched: checkedItems.map((li) => byList.get(li.id)).filter((m): m is ReconMatch => !!m),
    unmatchedList: checkedItems.filter((li) => !byList.has(li.id)),
    unmatchedNote: noteItems.filter((n) => !used.has(n.id)),
  };
}

/** A primeira palavra da nota é uma das palavras do nome da lista? ("CREME DE LEITE" não é "Leite"). */
function leadsWithListWord(listName: string, desc: string): boolean {
  const fw = firstWord(desc);
  return !!fw && descTokens(listName).words.some((w) => w === fw || fw.startsWith(w) || w.startsWith(fw));
}
