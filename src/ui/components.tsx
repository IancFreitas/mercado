import type { ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';

export function SyncBadge() {
  const { s, session, online } = useApp(); // re-renderiza a cada mudança de status (contexto)
  const pending = useLiveQuery(
    () => (session.householdId ? s.engine.pendingCount(session.householdId) : 0),
    [session.householdId],
    0,
  );
  const st = s.engine.status;
  let label: string;
  let tone: 'ok' | 'warn' | 'bad' | 'muted';
  if (!online) {
    label = pending ? `Offline · ${pending} pendente${pending > 1 ? 's' : ''}` : 'Offline';
    tone = 'warn';
  } else if (st === 'local-only') {
    label = 'Só neste aparelho';
    tone = 'muted';
  } else if (st === 'syncing') {
    label = 'Sincronizando…';
    tone = 'muted';
  } else if (st === 'forbidden') {
    label = 'Sem acesso à Casa';
    tone = 'bad';
  } else if (st === 'error' || st === 'offline') {
    label = pending ? `Erro · ${pending} pendente${pending > 1 ? 's' : ''}` : 'Erro de sincronização';
    tone = 'bad';
  } else if (pending) {
    label = `${pending} pendente${pending > 1 ? 's' : ''}`;
    tone = 'warn';
  } else {
    label = 'Sincronizado';
    tone = 'ok';
  }
  return (
    <span className={`badge badge-${tone}`} role="status" aria-live="polite" title={s.engine.lastError ?? undefined} data-testid="sync-badge">
      <span className="dot" aria-hidden />
      {label}
    </span>
  );
}

export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="section">
      {title && <h2 className="section-title">{title}</h2>}
      <div className="card">{children}</div>
      {footer && <p className="section-footer">{footer}</p>}
    </section>
  );
}

export function Toast() {
  const { toastMsg } = useApp();
  if (!toastMsg) return null;
  return (
    <div className="toast" role="status" aria-live="assertive">
      {toastMsg}
    </div>
  );
}

export function OfflineBanner() {
  const { online } = useApp();
  if (online) return null;
  return <div className="banner banner-warn">Você está offline. Tudo continua funcionando e será sincronizado depois.</div>;
}

export function formatQty(q: number, unit: string): string {
  const n = Number.isInteger(q) ? String(q) : q.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return unit === 'un' ? `${n}×` : `${n} ${unit}`;
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
