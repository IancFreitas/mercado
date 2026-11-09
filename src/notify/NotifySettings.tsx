import { useEffect, useState } from 'react';
import { useApp } from '../app/AppContext';
import { Section } from '../ui/components';
import { getPrefs, notifyPermission, notifySupported, setPrefs } from './notify';

export function NotifySettings() {
  const { s, toast } = useApp();
  const [enabled, setEnabled] = useState(false);
  const [perm, setPerm] = useState(notifyPermission());
  useEffect(() => {
    void getPrefs(s.db).then((p) => setEnabled(p.enabled));
  }, [s]);

  async function toggle(on: boolean) {
    if (on && notifySupported() && Notification.permission === 'default') {
      // Só por gesto do usuário (este clique).
      const r = await Notification.requestPermission();
      setPerm(r);
      if (r !== 'granted') {
        toast('Permissão não concedida');
        return;
      }
    }
    setEnabled(on);
    await setPrefs(s.db, { enabled: on });
  }

  const unsupported = perm === 'unsupported';
  return (
    <Section
      title="Avisos"
      footer="No iPhone, os avisos só aparecem quando você abre o app (no máximo um por dia); avisos com o app fechado precisam de um servidor (não configurado). O número no ícone mostra quantos itens estão acabando."
    >
      {unsupported ? (
        <p className="empty">Avisos indisponíveis aqui. No iPhone, instale o app: Compartilhar → Adicionar à Tela de Início, e abra por lá.</p>
      ) : (
        <label className="field">
          <span>
            <input type="checkbox" checked={enabled && perm === 'granted'} disabled={perm === 'denied'} onChange={(e) => void toggle(e.target.checked)} /> Avisar quando algo estiver acabando
          </span>
        </label>
      )}
      {perm === 'denied' && <p className="empty">Notificações bloqueadas. Libere em Ajustes do iPhone → Notificações → Smart Pantry.</p>}
    </Section>
  );
}
