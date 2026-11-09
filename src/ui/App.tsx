import { lazy, Suspense } from 'react';
import { useApp } from '../app/AppContext';
import { HomeScreen } from './HomeScreen';
import { PantryScreen } from './PantryScreen';
import { HouseScreen } from './HouseScreen';
import { ListScreen } from './ListScreen';
import { Onboarding } from './Onboarding';
import { OfflineBanner, SyncBadge, Toast } from './components';
import { useReplenishmentBadge } from '../notify/useReplenishmentBadge';
import { navigate, useRoute, type Tab } from './router';

// Carregada sob demanda: o leitor de QR (jsQR) não pesa na abertura do app.
const ScanScreen = lazy(() => import('./ScanScreen').then((m) => ({ default: m.ScanScreen })));

const SpendingScreen = lazy(() => import('./SpendingScreen').then((m) => ({ default: m.SpendingScreen })));

const ShoppingScreen = lazy(() => import('./ShoppingScreen').then((m) => ({ default: m.ShoppingScreen })));

const TITLES: Partial<Record<Tab, string>> = { notas: 'Notas', gastos: 'Gastos', compras: 'Compras' };

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'inicio', label: 'Início', icon: '🏠' },
  { id: 'lista', label: 'Lista', icon: '📝' },
  { id: 'despensa', label: 'Despensa', icon: '🥫' },
  { id: 'casa', label: 'Casa', icon: '👥' },
];

function BadgeEffect() {
  useReplenishmentBadge();
  return null;
}

export function App() {
  const { session } = useApp();
  const route = useRoute();

  if (!session.householdId) {
    return (
      <>
        <Onboarding />
        <Toast />
      </>
    );
  }

  const addParam = route.params.get('add');
  const deepLinkAdd = addParam
    ? { name: addParam.slice(0, 80), qty: Number(route.params.get('qtd') ?? '1') || 1, key: `${route.seq}|${addParam}` }
    : null;

  return (
    <div className="app">
      <BadgeEffect />
      <header className="topbar">
        <span className="topbar-title">{TITLES[route.tab] ?? TABS.find((t) => t.id === route.tab)?.label}</span>
        <SyncBadge />
      </header>
      <OfflineBanner />
      <main className="content">
        {route.tab === 'inicio' && <HomeScreen />}
        {route.tab === 'lista' && <ListScreen deepLinkAdd={deepLinkAdd} />}
        {route.tab === 'despensa' && <PantryScreen />}
        {route.tab === 'casa' && <HouseScreen />}
        {route.tab === 'notas' && (
          <Suspense fallback={<p className="empty">Carregando…</p>}>
            <ScanScreen />
          </Suspense>
        )}
        {route.tab === 'compras' && (
          <Suspense fallback={<p className="empty">Carregando…</p>}>
            <ShoppingScreen />
          </Suspense>
        )}
        {route.tab === 'gastos' && (
          <Suspense fallback={<p className="empty">Carregando…</p>}>
            <SpendingScreen />
          </Suspense>
        )}
      </main>
      <nav className="tabbar" aria-label="Navegação principal">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${route.tab === t.id ? 'active' : ''}`} onClick={() => navigate(t.id)} aria-current={route.tab === t.id ? 'page' : undefined}>
            <span className="tab-icon" aria-hidden>
              {t.icon}
            </span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <Toast />
    </div>
  );
}
