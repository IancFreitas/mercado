import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';
import { findDuplicates } from '../db/repo';
import { CATEGORIES, type Category, type ShoppingListItem, type Unit } from '../domain/types';
import { formatQty } from './components';

const UNITS: Unit[] = ['un', 'kg', 'g', 'l', 'ml', 'pct', 'cx', 'dz'];
const MAX_REMOVED = 30;

export function useDefaultList() {
  const { s, session } = useApp();
  return useLiveQuery(
    () => (session.householdId ? s.repo.getDefaultList(session.householdId) : undefined),
    [session.householdId],
  );
}

export function ListScreen({ deepLinkAdd }: { deepLinkAdd?: { name: string; qty: number; key: string } | null }) {
  const { s, session, toast } = useApp();
  const hid = session.householdId!;
  const list = useDefaultList();
  const items = useLiveQuery(
    () => (list ? s.repo.listItems(hid, list.id, true) : Promise.resolve([] as ShoppingListItem[])),
    [list?.id, hid],
    [] as ShoppingListItem[],
  );
  const conflicts = useLiveQuery(
    () => s.db.conflicts.where('householdId').equals(hid).filter((c) => !c.resolved).toArray(),
    [hid],
    [],
  );
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState<Unit>('un');
  const [category, setCategory] = useState<Category>('Outros');
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [linkAdd, setLinkAdd] = useState<{ name: string; qty: number } | null>(null);

  // Deep link (Atalhos/Siri): #/lista?add=leite&qtd=2 — pede confirmação, pois
  // qualquer página/mensagem pode abrir esse link (QA-15).
  const linkKey = deepLinkAdd?.key ?? '';
  useEffect(() => {
    if (!deepLinkAdd) return;
    setLinkAdd({ name: deepLinkAdd.name, qty: deepLinkAdd.qty });
    history.replaceState(null, '', '#/lista');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey]);

  async function confirmLinkAdd() {
    if (!linkAdd || !list) return;
    const r = await s.repo.addItem(hid, list.id, { name: linkAdd.name, quantity: linkAdd.qty, source: 'atalho' });
    setLinkAdd(null);
    toast(r.merged ? `${r.item.name}: quantidade atualizada` : `${r.item.name} adicionado`);
  }

  const active = items.filter((i) => !i.deleted);
  const pending = active.filter((i) => !i.checked);
  const inCart = active.filter((i) => i.checked);
  const removed = items.filter((i) => i.deleted).sort((a, b) => (a._v.deleted! < b._v.deleted! ? 1 : -1)).slice(0, MAX_REMOVED);
  const dups = useMemo(() => findDuplicates(active), [active]);
  const groups = useMemo(() => {
    const m = new Map<string, ShoppingListItem[]>();
    for (const i of pending.sort(sortItems)) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()].sort((a, b) => CATEGORIES.indexOf(a[0] as Category) - CATEGORIES.indexOf(b[0] as Category));
  }, [pending]);

  if (!list) return <p className="empty">Carregando lista… (se você acabou de entrar numa Casa, aguarde a sincronização)</p>;

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    // Limpa já, para não apagar o que o usuário digitar enquanto a gravação ocorre.
    const typed = { name, qty };
    setName('');
    setQty('1');
    try {
      const r = await s.repo.addItem(hid, list!.id, { name: typed.name, quantity: Number(typed.qty.replace(',', '.')), unit, category });
      if (r.merged) toast(`Já estava na lista: quantidade somada (${formatQty(r.item.quantity, r.item.unit)})`);
    } catch (err) {
      setName((cur) => cur || typed.name);
      toast((err as Error).message);
    }
  }

  return (
    <div className="screen">
      <form className="add-bar" onSubmit={onAdd} aria-label="Adicionar item">
        <input
          className="input grow"
          placeholder="Adicionar item (ex.: leite)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Nome do item"
          enterKeyHint="done"
          autoComplete="off"
          maxLength={80}
        />
        <button className="btn btn-primary" type="submit" disabled={!name.trim()} aria-label="Adicionar">
          +
        </button>
        <button type="button" className="btn btn-plain small" onClick={() => setMore((m) => !m)} aria-expanded={more}>
          {more ? 'Menos' : 'Mais'}
        </button>
        {more && (
          <div className="add-more">
            <input className="input qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantidade" />
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="Unidade">
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)} aria-label="Categoria">
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
      </form>

      {linkAdd && (
        <div className="banner" role="alertdialog" aria-label="Confirmar item do atalho" data-testid="deeplink-confirm">
          Adicionar <strong>{linkAdd.name}</strong> ({formatQty(linkAdd.qty, 'un')}) à lista?{' '}
          <button className="link" onClick={confirmLinkAdd}>
            Adicionar
          </button>
          <button className="link" onClick={() => setLinkAdd(null)}>
            Ignorar
          </button>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="banner banner-warn">
          {conflicts.length} alteração(ões) simultânea(s) detectada(s). <a href="#/casa">Revisar em Casa › Conflitos</a>
        </div>
      )}

      {dups.map((g) => (
        <div className="banner" key={g[0]!.normName}>
          “{g[0]!.name}” aparece {g.length}× (adicionado em aparelhos diferentes).{' '}
          <button className="link" onClick={() => s.repo.mergeDuplicates(hid, g).then(() => toast('Itens unidos'))}>
            Unir
          </button>
        </div>
      ))}

      {pending.length === 0 && inCart.length === 0 && <p className="empty">Lista vazia. Adicione o que está faltando em casa.</p>}

      {groups.map(([cat, its]) => (
        <section className="section" key={cat}>
          <h2 className="section-title">{cat}</h2>
          <ul className="card list" data-testid="pending-list">
            {its.map((i) => (
              <ItemRow key={i.id} item={i} editing={editing === i.id} onEdit={() => setEditing(editing === i.id ? null : i.id)} />
            ))}
          </ul>
        </section>
      ))}

      {inCart.length > 0 && (
        <section className="section">
          <h2 className="section-title">
            No carrinho ({inCart.length})
            <button className="link right" onClick={() => s.repo.clearChecked(hid, list.id).then((n) => toast(`${n} item(ns) removido(s)`))}>
              Limpar
            </button>
          </h2>
          <ul className="card list" data-testid="cart-list">
            {inCart.map((i) => (
              <ItemRow key={i.id} item={i} editing={false} onEdit={() => {}} />
            ))}
          </ul>
        </section>
      )}

      {removed.length > 0 && (
        <section className="section">
          <button className="link" onClick={() => setShowRemoved((v) => !v)}>
            {showRemoved ? 'Ocultar' : 'Ver'} removidos recentemente ({removed.length})
          </button>
          {showRemoved && (
            <ul className="card list">
              {removed.map((i) => (
                <li className="row muted" key={i.id}>
                  <span className="grow">{i.name}</span>
                  <button className="link" onClick={() => s.repo.restoreItem(hid, i.id)}>
                    Restaurar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function sortItems(a: ShoppingListItem, b: ShoppingListItem): number {
  const p = { alta: 0, normal: 1, baixa: 2 } as const;
  return p[a.priority] - p[b.priority] || a.name.localeCompare(b.name, 'pt-BR');
}

function ItemRow({ item, editing, onEdit }: { item: ShoppingListItem; editing: boolean; onEdit: () => void }) {
  const { s, session } = useApp();
  const hid = session.householdId!;
  const [q, setQ] = useState(String(item.quantity));
  useEffect(() => setQ(String(item.quantity)), [item.quantity]);
  const toggle = () => s.repo.updateItem(hid, item.id, { checked: !item.checked });
  return (
    <li className={`row ${item.checked ? 'checked' : ''}`} data-testid="item-row">
      <button
        className={`check ${item.checked ? 'on' : ''}`}
        onClick={toggle}
        role="checkbox"
        aria-checked={item.checked}
        aria-label={`${item.checked ? 'Desmarcar' : 'Marcar'} ${item.name}`}
      />
      <button className="row-main" onClick={onEdit} aria-expanded={editing}>
        <span className="item-name">
          {item.priority === 'alta' && <span className="prio" aria-label="prioridade alta">!</span>}
          {item.name}
        </span>
        <span className="item-meta">
          {formatQty(item.quantity, item.unit)}
          {item.createdBy && ` · ${item.createdBy}`}
        </span>
      </button>
      {editing && (
        <div className="row-edit">
          <button className="btn btn-plain" aria-label="Diminuir" onClick={() => s.repo.updateItem(hid, item.id, { quantity: Math.max(1, item.quantity - 1) })}>
            −
          </button>
          <input
            className="input qty"
            inputMode="decimal"
            value={q}
            aria-label="Quantidade"
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => {
              const n = Number(q.replace(',', '.'));
              if (n > 0 && n !== item.quantity) void s.repo.updateItem(hid, item.id, { quantity: n });
            }}
          />
          <button className="btn btn-plain" aria-label="Aumentar" onClick={() => s.repo.updateItem(hid, item.id, { quantity: item.quantity + 1 })}>
            +
          </button>
          <select
            className="input"
            aria-label="Prioridade"
            value={item.priority}
            onChange={(e) => s.repo.updateItem(hid, item.id, { priority: e.target.value as ShoppingListItem['priority'] })}
          >
            <option value="baixa">Baixa</option>
            <option value="normal">Normal</option>
            <option value="alta">Alta</option>
          </select>
          <button className="btn btn-danger" onClick={() => s.repo.removeItem(hid, item.id)}>
            Remover
          </button>
        </div>
      )}
    </li>
  );
}
