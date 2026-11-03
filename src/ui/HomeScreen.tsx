import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';
import { Section, formatQty } from './components';
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
          <button className="quick-btn" disabled title="Fase 2">
            <span aria-hidden>📷</span>Escanear NFC-e
          </button>
          <button className="quick-btn" disabled title="Fase 4">
            <span aria-hidden>🛒</span>Modo compras
          </button>
        </div>
      </Section>

      <Section
        title="Em breve"
        footer="Estas áreas dependem da importação de notas fiscais (Fase 2) e da inteligência estatística (Fase 3). Nenhum dado fictício é exibido."
      >
        <div className="row muted">Produtos próximos da reposição</div>
        <div className="row muted">Resumo da despensa</div>
        <div className="row muted">Últimas compras e gastos recentes</div>
      </Section>
    </div>
  );
}

export function PantryScreen() {
  return (
    <div className="screen">
      <h1 className="large-title">Despensa</h1>
      <Section footer="A despensa virtual será preenchida automaticamente pela importação de NFC-e (Fase 2). O modelo de dados (estoque, movimentações auditáveis, validade e confiança) já está criado no banco local.">
        <div className="row muted">Em desenvolvimento — Fase 2</div>
      </Section>
    </div>
  );
}
