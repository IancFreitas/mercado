import { useApp } from '../app/AppContext';
import { HomeScreen, PantryScreen } from './HomeScreen';
import { HouseScreen } from './HouseScreen';
import { ListScreen } from './ListScreen';
import { Onboarding } from './Onboarding';
import { OfflineBanner, SyncBadge, Toast } from './components';
import { navigate, useRoute, type Tab } from './router';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'inicio', label: 'Início', icon: '🏠' },
  { id: 'lista', label: 'Lista', icon: '📝' },
  { id: 'despensa', label: 'Despensa', icon: '🥫' },
  { id: 'casa', label: 'Casa', icon: '👥' },
];

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
  const deepLinkAdd = addParam ? { name: addParam.slice(0, 80), qty: Number(route.params.get('qtd') ?? '1') || 1 } : null;

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar-title">{TABS.find((t) => t.id === route.tab)?.label}</span>
        <SyncBadge />
      </header>
      <OfflineBanner />
      <main className="content">
        {route.tab === 'inicio' && <HomeScreen />}
        {route.tab === 'lista' && <ListScreen deepLinkAdd={deepLinkAdd} />}
        {route.tab === 'despensa' && <PantryScreen />}
        {route.tab === 'casa' && <HouseScreen />}
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
