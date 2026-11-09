import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';
import { formatCnpj } from '../nfce/accessKey';
import { pantryFor, splitStock, type StockRow } from '../pantry/pantry';
import { TIMEZONE, currentMonthKey, monthLabel, spendingPurchases, summarizeMonth } from '../spending/spending';
import { Section, formatBRL, formatQty } from './components';
import { useDefaultList } from './ListScreen';
import { navigate } from './router';

export function HomeScreen() {
  const { s, session } = useApp();
  const hid = session.householdId!;
  const list = useDefaultList();
  const household = useLiveQuery(() => s.db.households.get(hid), [hid]);
  const pending = useLiveQuery(
    async () => (list ? (await s.repo.listItems(hid, list.id)).filter((i) => !i.checked) : []),
    [list?.id, hid],
    [],
  );
  const stockRows = useLiveQuery(() => pantryFor(s.repo).stockRows(hid), [hid], [] as StockRow[]);
  const stock = splitStock(stockRows);
  const purchases = useLiveQuery(() => s.repo.listPurchases(hid), [hid], []);
  const month = currentMonthKey();
  const monthTotal = summarizeMonth(spendingPurchases(hid, purchases), month).totalCents;
  const recent = purchases.slice(0, 3);
  const high = pending.filter((i) => i.priority === 'alta');

  return (
    <div className="screen">
      <h1 className="large-title">{household?.name ?? 'Minha Casa'}</h1>

      <Section title="Lista de compras">
        <button className="row-link" onClick={() => navigate('lista')}>
          <span className="grow">
            <strong data-testid="home-pending">{pending.length}</strong> item(ns) faltando
            {high.length > 0 && <span className="tag tag-red">{high.length} urgente(s)</span>}
          </span>
          <span className="chev" aria-hidden>
            ›
          </span>
        </button>
        {pending.slice(0, 5).map((i) => (
          <div className="row muted" key={i.id}>
            <span className="grow">{i.name}</span>
            <span>{formatQty(i.quantity, i.unit)}</span>
          </div>
        ))}
      </Section>

      <Section title="Ações rápidas">
        <div className="quick">
          <button className="quick-btn" onClick={() => navigate('lista')}>
            <span aria-hidden>📝</span>Lista
          </button>
          <button className="quick-btn" onClick={() => navigate('notas')}>
            <span aria-hidden>📷</span>Escanear NFC-e
          </button>
          <button className="quick-btn" disabled title="Fase 4">
            <span aria-hidden>🛒</span>Modo compras
          </button>
        </div>
      </Section>

      <Section title="Despensa">
        <button className="row-link" onClick={() => navigate('despensa')}>
          <span className="grow">
            <strong data-testid="home-pantry-count">{stock.inStock.length}</strong> produto(s) em estoque
            {stock.out.length > 0 && <span className="tag tag-red">{stock.out.length} acabou</span>}
          </span>
          <span className="chev" aria-hidden>
            ›
          </span>
        </button>
      </Section>

      <Section title="Gastos do mês">
        <button className="row-link" onClick={() => navigate('gastos')}>
          <span className="grow">
            <strong data-testid="home-spend">{formatBRL(monthTotal)}</strong> em {monthLabel(month)}
          </span>
          <span className="chev" aria-hidden>
            ›
          </span>
        </button>
      </Section>

      <Section title="Últimas compras">
        {recent.length === 0 && <div className="row muted">Nenhuma compra registrada.</div>}
        {recent.map((p) => (
          <div className="row" key={p.id} data-testid="home-recent">
            <span className="grow">
              {p.issuerCnpj ? formatCnpj(p.issuerCnpj) : 'Compra'}
              <span className="item-meta" style={{ display: 'block' }}>
                {new Date(p.purchasedAt).toLocaleDateString('pt-BR', { timeZone: TIMEZONE })}
                {p.status === 'pendente' ? ' · itens pendentes' : ''}
              </span>
            </span>
            {p.totalCents > 0 && <strong>{formatBRL(p.totalCents)}</strong>}
          </div>
        ))}
      </Section>

      <Section footer="A previsão de reposição depende do histórico de compras (Fase 3). Nenhum dado fictício é exibido.">
        <div className="row muted">Produtos próximos da reposição — em breve (Fase 3)</div>
      </Section>
    </div>
  );
}
