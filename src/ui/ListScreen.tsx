import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';
import { findDuplicates } from '../db/repo';
import { CATEGORIES, type Category, type ShoppingListItem, type Unit } from '../domain/types';
import { formatQty, formatBRL } from './components';
import { storeLabelWithCnpj } from '../stores/stores';
import { useStoreNames } from '../stores/useStoreNames';
import { baseUnitLabel } from '../prices/packageSize';
import { navigate } from './router';
import { CONFIDENCE_LABEL } from '../predict/consumption';
import { addSuggestion, loadSuggestions, setPredictionEnabled, snoozeSuggestion, timingLabel, type Suggestion } from '../predict/suggestions';
import { prepareEntries, priceStatsPrepared, type PriceEntry, type PriceStats } from '../prices/priceMatch';

const UNITS: Unit[] = ['un', 'kg', 'g', 'l', 'ml', 'pct', 'cx', 'dz'];
const MAX_REMOVED = 30;

export function useDefaultList() {
  const { s, session } = useApp();
  return useLiveQuery(
    () => (session.householdId ? s.repo.getDefaultList(session.householdId) : undefined),
    [session.householdId],
  );
}

export function useSuggestions(): Suggestion[] {
  const { s, session } = useApp();
  const hid = session.householdId!;
  // Relógio de 1 h: adiamento que vence e "acaba em N dias" se atualizam com o app aberto.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 3_600_000);
    return () => clearInterval(id);
  }, []);
  return useLiveQuery(() => loadSuggestions(s.repo, hid, tick), [hid, tick], [] as Suggestion[]);
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
  const suggestions = useSuggestions();
  const entries = useLiveQuery(() => s.repo.priceEntries(hid), [hid], [] as PriceEntry[]);
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
  const prepared = useMemo(() => prepareEntries(entries), [entries]);
  const stats = useMemo(() => {
    const m = new Map<string, PriceStats>();
    if (prepared.length === 0) return m;
    for (const i of items) {
      if (i.deleted) continue;
      const st = priceStatsPrepared(i.name, prepared);
      if (st) m.set(i.id, st);
    }
    return m;
  }, [items, prepared]);
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

      {pending.length + inCart.length > 0 && (
        <button type="button" className="btn btn-plain" onClick={() => navigate('compras')}>
          🛒 Modo compras
        </button>
      )}

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

      <SuggestionsSection suggestions={suggestions} />

      {pending.length === 0 && inCart.length === 0 && suggestions.length === 0 && <p className="empty">Lista vazia. Adicione o que está faltando em casa.</p>}

      {groups.map(([cat, its]) => (
        <section className="section" key={cat}>
          <h2 className="section-title">{cat}</h2>
          <ul className="card list" data-testid="pending-list">
            {its.map((i) => (
              <ItemRow key={i.id} item={i} stats={stats.get(i.id)} editing={editing === i.id} onEdit={() => setEditing(editing === i.id ? null : i.id)} />
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
              <ItemRow key={i.id} item={i} stats={stats.get(i.id)} editing={false} onEdit={() => {}} />
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

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'America/Sao_Paulo' });
};

function priceLine(st: PriceStats): string {
  const u = st.last.unit === 'un' ? '' : `/${st.last.unit}`;
  const parts = [`Último ${formatBRL(st.last.unitPriceCents)}${u}`, fmtDay(st.last.purchasedAt)];
  if (st.count >= 2) parts.push(`médio ${formatBRL(st.avgUnitCents)}${u}`);
  if (st.normalizedLast) parts.push(`${formatBRL(st.normalizedLast.cents)}/${baseUnitLabel(st.normalizedLast.unit)}`);
  parts.push(st.last.rawDescription);
  return parts.join(' · ');
}

/** Só é montado com o bloco "Preços pagos" aberto (evita uma consulta por linha da lista). */
function StoreSuffix({ cnpj }: { cnpj: string }) {
  const names = useStoreNames();
  return <> · loja {storeLabelWithCnpj(cnpj, names)}</>;
}

function ItemRow({ item, stats, editing, onEdit }: { item: ShoppingListItem; stats?: PriceStats; editing: boolean; onEdit: () => void }) {
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
        {stats && (
          <span className="item-meta price-line" data-testid="price-line">
            <span className="sr-only">Preço pago: </span>
            {priceLine(stats)}
          </span>
        )}
      </button>
      {editing && stats && (
        <div className="price-block" data-testid="price-block">
          <strong>Preços pagos</strong>
          <ul>
            {stats.matches.slice(0, 5).map((m, k) => (
              <li key={`${m.purchaseId}-${k}`}>
                {fmtDay(m.purchasedAt)} · {formatBRL(m.unitPriceCents)}/{m.unit} · {m.rawDescription}
                {m.storeCnpj && <StoreSuffix cnpj={m.storeCnpj} />}
              </li>
            ))}
          </ul>
        </div>
      )}
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

function SuggestionsSection({ suggestions }: { suggestions: Suggestion[] }) {
  const { s, session, toast } = useApp();
  const hid = session.householdId!;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('sugestoes-recolhidas') !== '1';
    } catch {
      return true;
    }
  });
  const [why, setWhy] = useState<string | null>(null);
  if (suggestions.length === 0) return null;

  function toggle() {
    setOpen((o) => {
      try {
        localStorage.setItem('sugestoes-recolhidas', o ? '1' : '0');
      } catch {
        /* sem armazenamento: só não lembra */
      }
      return !o;
    });
  }
  async function run(fn: () => Promise<string>) {
    try {
      toast(await fn());
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <section className="section" data-testid="suggestions">
      <h2 className="section-title">
        <button className="link" onClick={toggle} aria-expanded={open}>
          Sugestões ({suggestions.length}) {open ? '▾' : '▸'}
        </button>
      </h2>
      {open && (
        <ul className="card list">
          {suggestions.map(({ product: p, forecast: f, quantity, unit }) => (
            <li className="row sugg-row" key={p.id} data-testid="suggestion-row">
              <div className="row-main">
                <span className="item-name">{p.name}</span>
                <span className="item-meta">
                  {formatQty(quantity, unit)} · {timingLabel(f)} · Confiança {CONFIDENCE_LABEL[f.confidence]}
                </span>
                <button className="link" aria-expanded={why === p.id} onClick={() => setWhy(why === p.id ? null : p.id)}>
                  Por que sugeriu?
                </button>
                {why === p.id && (
                  <p className="item-meta sugg-why" data-testid="suggestion-why">
                    {f.explanation}
                  </p>
                )}
              </div>
              <div className="pantry-actions">
                <button
                  className="btn btn-plain small"
                  aria-label={`Adicionar ${p.name} à lista`}
                  onClick={() => run(async () => ((await addSuggestion(s.repo, hid, p.id, quantity)).added ? `${p.name} adicionado` : 'Já está na lista'))}
                >
                  Adicionar
                </button>
                <button
                  className="btn btn-plain small"
                  aria-label={`Adiar sugestão de ${p.name} por 7 dias`}
                  onClick={() => run(async () => (await snoozeSuggestion(s.repo, hid, p.id), 'Adiado por 7 dias'))}
                >
                  Adiar
                </button>
                <button
                  className="btn btn-plain small"
                  aria-label={`Não sugerir mais ${p.name}`}
                  onClick={() => run(async () => (await setPredictionEnabled(s.repo, hid, p.id, false), 'Não vou mais sugerir (reative na Despensa)'))}
                >
                  Não sugerir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
