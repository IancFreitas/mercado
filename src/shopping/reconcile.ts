import { matchesListItem } from '../prices/priceMatch';

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
}

export interface Reconciliation {
  matched: ReconMatch[];
  /** Marcados na lista que não aparecem na nota. */
  unmatchedList: ReconListItem[];
  /** Itens da nota que não estavam na lista marcada. */
  unmatchedNote: ReconNoteItem[];
}

export function reconcile(checkedItems: ReconListItem[], noteItems: ReconNoteItem[]): Reconciliation {
  const used = new Set<string>();
  const byList = new Map<string, ReconMatch>();
  const wordCount = (s: string) => s.trim().split(/\s+/).length;
  const order = [...checkedItems].sort((a, b) => wordCount(b.name) - wordCount(a.name));
  for (const li of order) {
    const hit = noteItems.find((n) => !used.has(n.id) && matchesListItem(li.name, n.rawDescription));
    if (!hit) continue;
    used.add(hit.id);
    const found = li.foundPriceCents;
    byList.set(li.id, {
      listItem: li,
      noteItem: hit,
      paidCents: hit.unitPriceCents,
      ...(found !== undefined ? { foundCents: found, diffCents: hit.unitPriceCents - found } : {}),
    });
  }
  return {
    matched: checkedItems.map((li) => byList.get(li.id)).filter((m): m is ReconMatch => !!m),
    unmatchedList: checkedItems.filter((li) => !byList.has(li.id)),
    unmatchedNote: noteItems.filter((n) => !used.has(n.id)),
  };
}
