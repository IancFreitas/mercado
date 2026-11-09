import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';
import { formatCnpj } from '../nfce/accessKey';
import type { Purchase } from '../domain/types';
import {
  TIMEZONE,
  availableMonths,
  byCategory,
  byStore,
  currentMonthKey,
  inMonth,
  loadCategoryLines,
  monthLabel,
  prevMonthKey,
  spendingPurchases,
  summarizeMonth,
  type CategoryLine,
} from '../spending/spending';
import { Section, formatBRL } from './components';

const EMPTY: { ps: Purchase[]; lines: CategoryLine[] } = { ps: [], lines: [] };

export function SpendingScreen() {
  const { s, session } = useApp();
  const hid = session.householdId!;
  const current = currentMonthKey();
  const [month, setMonth] = useState(current);
  const data = useLiveQuery(
    async () => {
      const ps = spendingPurchases(hid, await s.repo.listPurchases(hid));
      return { ps, lines: await loadCategoryLines(s.repo, hid, ps) };
    },
    [hid],
    EMPTY,
  );
  const { ps, lines } = data;
  const months = availableMonths(ps, current);
  const sum = summarizeMonth(ps, month);
  const stores = byStore(ps, month);
  const cats = byCategory(lines, inMonth(ps, month));
  const monthPurchases = inMonth(ps, month);

  return (
    <div className="screen">
      <h1 className="large-title">Gastos</h1>

      <label className="field month-pick">
        <span>Mês</span>
        <select className="input" aria-label="Mês" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </label>

      <Section title={`Total em ${monthLabel(month)}`}>
        <div className="row" data-testid="spend-total">
          <span className="grow">
            <span className="stat-big">{formatBRL(sum.totalCents)}</span>
            <span className="item-meta" style={{ display: 'block' }}>
              {sum.count === 0 ? 'Nenhuma compra com valor neste mês' : `${sum.count} compra${sum.count > 1 ? 's' : ''}`}
            </span>
          </span>
        </div>
        <div className="row muted" data-testid="spend-compare">
          {sum.changePct !== null
            ? `${sum.changePct > 0 ? '+' : ''}${sum.changePct.toLocaleString('pt-BR')}% em relação a ${monthLabel(prevMonthKey(month))} (${formatBRL(sum.previousCents)})`
            : 'Sem comparação: é preciso haver gastos nos dois meses.'}
        </div>
      </Section>

      <Section title="Por loja">
        {stores.length === 0 && <div className="row muted">Sem compras neste mês.</div>}
        {stores.map((st) => (
          <div className="row" key={st.cnpj ?? 'none'} data-testid="spend-store">
            <span className="grow">
              {st.cnpj ? formatCnpj(st.cnpj) : 'Loja não identificada'}
              <span className="item-meta" style={{ display: 'block' }}>
                {st.count} compra{st.count > 1 ? 's' : ''}
              </span>
            </span>
            <strong>{formatBRL(st.totalCents)}</strong>
          </div>
        ))}
      </Section>

      <Section
        title="Por categoria"
        footer="Soma dos itens das notas importadas, pela categoria do produto. Descontos e acréscimos da nota não entram aqui, então o total pode diferir do total do mês. Itens sem produto na Despensa ficam em “Sem categoria”."
      >
        {cats.length === 0 && <div className="row muted">Sem itens importados neste mês.</div>}
        {cats.map((c) => (
          <div className="row" key={c.category} data-testid="spend-category">
            <span className="grow">{c.category}</span>
            <strong>{formatBRL(c.totalCents)}</strong>
          </div>
        ))}
      </Section>

      <Section title="Compras do mês">
        {monthPurchases.length === 0 && <div className="row muted">Sem compras neste mês.</div>}
        {monthPurchases.map((p) => (
          <div className="row" key={p.id} data-testid="spend-purchase">
            <span className="grow">
              {p.issuerCnpj ? formatCnpj(p.issuerCnpj) : 'Compra'}
              <span className="item-meta" style={{ display: 'block' }}>
                {new Date(p.purchasedAt).toLocaleDateString('pt-BR', { timeZone: TIMEZONE })}
                {p.status === 'pendente' ? ' · itens pendentes' : ''}
              </span>
            </span>
            <strong>{formatBRL(p.totalCents)}</strong>
          </div>
        ))}
      </Section>
    </div>
  );
}
