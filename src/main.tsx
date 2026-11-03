import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { AppProvider } from './app/AppContext';
import { bootstrap } from './app/services';
import { App } from './ui/App';
import './ui/styles.css';

const root = createRoot(document.getElementById('root')!);

bootstrap()
  .then((services) => {
    root.render(
      <StrictMode>
        <AppProvider services={services}>
          <App />
        </AppProvider>
      </StrictMode>,
    );
  })
  .catch((e: unknown) => {
    root.render(
      <div className="fatal">
        <h1>Não foi possível abrir o banco local</h1>
        <p>{e instanceof Error ? e.message : String(e)}</p>
        <p>No iPhone, verifique se não está em navegação privada.</p>
      </div>,
    );
  });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const update = registerSW({
    onNeedRefresh() {
      if (confirm('Nova versão do Smart Pantry disponível. Atualizar agora?')) void update(true);
    },
  });
}
