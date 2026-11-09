import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';
import type { ShoppingListItem } from '../domain/types';
import { baseUnitLabel } from '../prices/packageSize';
import { prepareEntries, priceStatsPrepared, type PriceEntry, type PriceStats } from '../prices/priceMatch';
import { basisLabel, centsToInput, comparePrice, estimateTotal, parsePriceInput } from '../shopping/shopping';
import { formatBRL, formatQty } from './components';
import { useDefaultList } from './ListScreen';
import { navigate } from './router';

/** Modo compras: tela para usar no mercado. Tudo local (funciona offline). */
export function ShoppingScreen() {
  const { s, session } = useApp();
  const hid = session.householdId!;
  const list = useDefaultList();
  const items = useLiveQuery(
    () => (list ? s.repo.listItems(hid, list.id) : Promise.resolve([] as ShoppingListItem[])),
    [list?.id, hid],
    [] as ShoppingListItem[],
  );
  const entries = useLiveQuery(() => s.repo.priceEntries(hid), [hid], [] as PriceEntry[]);
  const prepared = useMemo(() => prepareEntries(entries), [entries]);
  const stats = useMemo(() => {
    const m = new Map<string, PriceStats>();
    for (const i of items) {
      const st = priceStatsPrepared(i.name, prepared);
      if (st) m.set(i.id, st);
    }
    return m;
  }, [items, prepared]);
  const sorted = useMemo(
    () => [...items].sort((a, b) => ({ alta: 0, normal: 1, baixa: 2 })[a.priority] - { alta: 0, normal: 1, baixa: 2 }[b.priority] || a.name.localeCompare(b.name, 'pt-BR')),
    [items],
  );
  const pending = sorted.filter((i) => !i.checked);
  const inCart = sorted.filter((i) => i.checked);
  const total = useMemo(() => estimateTotal(items, (i) => stats.get((i as ShoppingListItem).id)), [items, stats]);

  if (!list) return <p className="empty">Carregando lista…</p>;

  return (
    <div className="screen shopping">
      <h1 className="large-title">Modo compras</h1>

      <section className="card shop-total" data-testid="shopping-total" aria-label="Total estimado">
        <div className="shop-total-main">
          <span>Total estimado</span>
          <strong data-testid="total-all">{formatBRL(total.totalCents)}</strong>
        </div>
        <div className="shop-total-sub">
          <span>
            No carrinho: <strong data-testid="total-cart">{formatBRL(total.cartCents)}</strong>
          </span>
          <span>
            Faltam: <strong data-testid="total-pending">{formatBRL(total.pendingCents)}</strong>
          </span>
        </div>
        {total.withoutPrice > 0 && (
          <p className="item-meta" data-testid="total-missing">
            {total.withoutPrice} item(ns) sem preço, fora da conta
            {total.cartWithoutPrice > 0 && ` (${total.cartWithoutPrice} no carrinho)`}.
          </p>
        )}
      </section>

      {pending.length === 0 && inCart.length === 0 && (
        <p className="empty">
          Lista vazia. <button className="link" onClick={() => navigate('lista')}>Adicionar itens</button>
        </p>
      )}

      {pending.length === 0 && inCart.length > 0 && <p className="empty">Nada faltando. Bom proveito!</p>}

      {pending.length > 0 && (
        <section className="section">
          <h2 className="section-title">Faltam ({pending.length})</h2>
          <ul className="card list" data-testid="shop-pending">
            {pending.map((i) => (
              <ShopRow key={i.id} item={i} stats={stats.get(i.id)} />
            ))}
          </ul>
        </section>
      )}

      {inCart.length > 0 && (
        <section className="section">
          <h2 className="section-title">No carrinho ({inCart.length})</h2>
          <ul className="card list" data-testid="shop-cart">
            {inCart.map((i) => (
              <ShopRow key={i.id} item={i} stats={stats.get(i.id)} />
            ))}
          </ul>
        </section>
      )}

      <p className="section-footer">
        O preço encontrado é opcional. Depois de importar a nota, use <strong>Conferir com a lista</strong> em Notas.
      </p>
    </div>
  );
}

function ShopRow({ item, stats }: { item: ShoppingListItem; stats?: PriceStats }) {
  const { s, session, toast } = useApp();
  const hid = session.householdId!;
  const [text, setText] = useState(item.foundPriceCents !== undefined ? centsToInput(item.foundPriceCents) : '');
  useEffect(() => setText(item.foundPriceCents !== undefined ? centsToInput(item.foundPriceCents) : ''), [item.foundPriceCents]);
  const cmp = comparePrice(item, stats);

  async function save() {
    const c = parsePriceInput(text);
    if (c === null || c === item.foundPriceCents) {
      if (c === null && text.trim() && item.foundPriceCents === undefined) toast('Preço inválido');
      if (c === null) setText(item.foundPriceCents !== undefined ? centsToInput(item.foundPriceCents) : '');
      return;
    }
    try {
      await s.repo.updateItem(hid, item.id, { foundPriceCents: c });
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <li className={`shop-row ${item.checked ? 'checked' : ''}`} data-testid="shop-row">
      <button
        className="shop-main"
        onClick={() => s.repo.updateItem(hid, item.id, { checked: !item.checked })}
        aria-label={`${item.checked ? 'Tirar do carrinho' : 'Pôr no carrinho'}: ${item.name}`}
      >
        <span className={`shop-box ${item.checked ? 'on' : ''}`} aria-hidden>
          {item.checked ? '✓' : ''}
        </span>
        <span className="shop-text">
          <span className="shop-name">
            {item.priority === 'alta' && <span className="prio" aria-label="prioridade alta">!</span>}
            {item.name}
          </span>
          <span className="item-meta">{formatQty(item.quantity, item.unit)}</span>
        </span>
      </button>
      <div className="shop-price">
        <label className="shop-price-label">
          <span className="item-meta">Preço encontrado (R$)</span>
          <input
            className="input shop-input"
            inputMode="decimal"
            placeholder="opcional"
            value={text}
            aria-label={`Preço encontrado de ${item.name}`}
            onChange={(e) => setText(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
        {stats ? (
          <span className="item-meta" data-testid="shop-history">
            Médio {formatBRL(stats.avgUnitCents)}
            {stats.last.unit !== 'un' && `/${stats.last.unit}`}
            {stats.normalizedLast && stats.normalizedAvg !== undefined && ` · ${formatBRL(stats.normalizedAvg)}/${baseUnitLabel(stats.normalizedLast.unit)}`}
            {stats.count < 2 && ' (1 compra)'}
          </span>
        ) : (
          <span className="item-meta">Sem histórico de preço</span>
        )}
        {item.foundPriceCents !== undefined && (
          <span className={`cmp cmp-${cmp.status}`} role="status" data-testid="shop-compare">
            <span aria-hidden>{cmp.icon}</span> {cmp.text}
            {cmp.status !== 'sem' && cmp.basis !== 'unit' && ` · por ${basisLabel(cmp.basis)}`}
          </span>
        )}
      </div>
    </li>
  );
}
