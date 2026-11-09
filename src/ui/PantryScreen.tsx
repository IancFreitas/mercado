import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';
import { CATEGORIES, type Category, type InventoryMovement, type Unit } from '../domain/types';
import { MOVEMENT_LABELS, groupByCategory, pantryFor, splitStock, type StockRow } from '../pantry/pantry';
import { TIMEZONE } from '../spending/spending';
import { Section, formatQty } from './components';

const UNIT_OPTIONS: Unit[] = ['un', 'kg', 'g', 'l', 'ml', 'pct', 'cx', 'dz'];

/** "1,5" ou "1.5" → 1.5 (NaN se inválido). */
export function parseQty(s: string): number {
  const n = Number(s.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: TIMEZONE });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function PantryScreen() {
  const { s, session } = useApp();
  const hid = session.householdId!;
  const svc = pantryFor(s.repo);
  const rows = useLiveQuery(() => svc.stockRows(hid), [hid], [] as StockRow[]);
  const { inStock, out } = splitStock(rows);

  return (
    <div className="screen">
      <h1 className="large-title">Despensa</h1>

      <AddProduct />

      {rows.length === 0 && (
        <Section footer="Importe uma nota fiscal em Notas (marcando “Adicionar à despensa”) ou adicione um produto à mão.">
          <div className="row muted" data-testid="pantry-empty">
            Nada na despensa ainda.
          </div>
        </Section>
      )}

      {groupByCategory(inStock).map((g) => (
        <Section key={g.category} title={g.category}>
          <ul className="list" data-testid="pantry-list">
            {g.rows.map((r) => (
              <ProductRow key={r.product.id} row={r} />
            ))}
          </ul>
        </Section>
      ))}

      {out.length > 0 && (
        <Section title="Acabou" footer="Produtos com estoque zerado. “Pôr na lista” não duplica itens já pendentes.">
          <ul className="list" data-testid="pantry-out">
            {out.map((r) => (
              <ProductRow key={r.product.id} row={r} isOut />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function AddProduct() {
  const { s, session, toast } = useApp();
  const hid = session.householdId!;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState<Unit>('un');
  const [category, setCategory] = useState<Category>('Outros');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await pantryFor(s.repo).addManual(hid, { name, quantity: parseQty(qty), unit, category });
      toast(r.created ? 'Produto adicionado' : 'Quantidade somada ao produto existente');
      setName('');
      setQty('1');
      setOpen(false);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-primary full-btn" onClick={() => setOpen(true)}>
        Adicionar produto
      </button>
    );
  }
  return (
    <Section title="Novo produto">
      <form className="pantry-form" onSubmit={submit}>
        <input className="input" aria-label="Nome do produto" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Arroz" autoComplete="off" />
        <input className="input qty" aria-label="Quantidade em estoque" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        <select className="input" aria-label="Unidade" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          {UNIT_OPTIONS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
        <select className="input" aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
          Salvar produto
        </button>
        <button className="btn btn-plain" type="button" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </form>
    </Section>
  );
}

function ProductRow({ row, isOut }: { row: StockRow; isOut?: boolean }) {
  const { s, session, toast } = useApp();
  const hid = session.householdId!;
  const svc = pantryFor(s.repo);
  const [panel, setPanel] = useState<'none' | 'edit' | 'hist'>('none');
  const p = row.product;

  async function run(fn: () => Promise<string | void>) {
    try {
      const msg = await fn();
      if (msg) toast(msg);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <li className="row pantry-row" data-testid="pantry-row">
      <button className="row-main" onClick={() => setPanel(panel === 'hist' ? 'none' : 'hist')} aria-expanded={panel === 'hist'} aria-label={`Histórico de ${p.name}, ${isOut ? 'sem estoque' : formatQty(row.quantity, row.unit)}`}>
        <span className="item-name">{p.name}</span>
        <span className="item-meta">
          {isOut ? 'Sem estoque' : formatQty(row.quantity, row.unit)}
          {row.lastPurchaseAt ? ` · última compra ${fmtDate(row.lastPurchaseAt)}` : ''}
        </span>
      </button>
      <div className="pantry-actions">
        {isOut ? (
          <button
            className="btn btn-plain small"
            aria-label={`Pôr ${p.name} na lista`}
            onClick={() => run(async () => ((await svc.putOnList(hid, p.id)).added ? 'Adicionado à lista' : 'Já está na lista'))}
          >
            Pôr na lista
          </button>
        ) : (
          <>
            <button className="btn btn-plain small" aria-label={`Usei 1 de ${p.name}`} onClick={() => run(async () => void (await svc.consume(hid, p.id, 1)))}>
              Usei 1
            </button>
            <button className="btn btn-plain small" aria-label={`${p.name} acabou`} onClick={() => run(async () => void (await svc.markOut(hid, p.id)))}>
              Acabou
            </button>
            <button className="btn btn-plain small" aria-label={`Ainda tem ${p.name}`} onClick={() => run(async () => ((await svc.stillHave(hid, p.id)), 'Anotado: ainda tem'))}>
              Ainda tem
            </button>
          </>
        )}
        <button className="btn btn-plain small" aria-label={`Editar ${p.name}`} onClick={() => setPanel(panel === 'edit' ? 'none' : 'edit')} aria-expanded={panel === 'edit'}>
          Editar
        </button>
      </div>
      {panel === 'edit' && <EditPanel row={row} onDone={() => setPanel('none')} />}
      {panel === 'hist' && <History row={row} />}
    </li>
  );
}

function EditPanel({ row, onDone }: { row: StockRow; onDone: () => void }) {
  const { s, session, toast } = useApp();
  const hid = session.householdId!;
  const svc = pantryFor(s.repo);
  const p = row.product;
  const [name, setName] = useState(p.name);
  const [category, setCategory] = useState<Category>(p.category);
  const [qty, setQty] = useState(String(Math.max(row.quantity, 0)));

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await svc.editProduct(hid, p.id, { name, category });
      const target = parseQty(qty);
      if (Number.isNaN(target)) throw new Error('Quantidade inválida');
      await svc.adjustTo(hid, p.id, target);
      toast('Produto atualizado');
      onDone();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <form className="row-edit pantry-form" onSubmit={save} data-testid="pantry-edit">
      <input className="input" aria-label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="input" aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
        {CATEGORIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <label className="pantry-qty">
        <span className="muted">Quantidade ({row.unit})</span>
        <input className="input qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantidade" />
      </label>
      <button className="btn btn-primary" type="submit">
        Salvar
      </button>
      <button
        className="btn btn-danger"
        type="button"
        disabled={row.quantity <= 0}
        onClick={async () => {
          try {
            await svc.discard(hid, p.id, 1, 'Descartado');
            toast('Descarte registrado');
          } catch (err) {
            toast((err as Error).message);
          }
        }}
      >
        Descartar 1
      </button>
    </form>
  );
}

function History({ row }: { row: StockRow }) {
  const { s, session } = useApp();
  const hid = session.householdId!;
  const ms = useLiveQuery(() => pantryFor(s.repo).movements(hid, row.product.id), [hid, row.product.id], [] as InventoryMovement[]);
  return (
    <div className="row-edit import-box" data-testid="pantry-history">
      {ms.length === 0 && <span className="muted">Sem movimentos.</span>}
      {ms.map((m) => (
        <div className="import-line" key={m.id}>
          <span className="grow">
            {MOVEMENT_LABELS[m.kind]}
            <span className="muted"> · {fmtDateTime(m.at)} · {m.by}</span>
            {m.note && <span className="muted"> · {m.note}</span>}
          </span>
          <strong>
            {m.delta > 0 ? '+' : ''}
            {m.delta.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {m.unit}
          </strong>
        </div>
      ))}
    </div>
  );
}
