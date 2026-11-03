import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../app/AppContext';
import { restoreBackup } from '../backup/backup';
import { Section } from './components';
import { BackendConfig, LoginForm } from './HouseScreen';

type Step = 'start' | 'create' | 'join';

export function Onboarding() {
  const { s, updateSession, toast, restartSync } = useApp();
  const [step, setStep] = useState<Step>('start');
  const [name, setName] = useState('');
  const [house, setHouse] = useState('');
  const [code, setCode] = useState('');
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void s.backend?.currentUser().then(setUser);
  }, [s.backend]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const { household } = await s.repo.createHousehold(house || `Casa de ${name || 'mim'}`);
    await updateSession({ householdId: household.id, displayName: name.trim() || 'Eu', householdConnected: false });
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const hid = await s.backend!.acceptInvitation(code, name.trim());
      await updateSession({ householdId: hid, displayName: name.trim() || 'Eu', householdConnected: true });
      await restartSync();
      await s.engine.sync(hid);
      toast('Você entrou na Casa');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen onboarding">
      <div className="hero">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={72} height={72} />
        <h1 className="large-title">Smart Pantry</h1>
        <p className="muted">Lista de compras e despensa da sua Casa. Funciona offline; compartilhar é opcional.</p>
      </div>

      {step === 'start' && (
        <Section>
          <button className="btn btn-primary full" onClick={() => setStep('create')}>
            Criar minha Casa
          </button>
          <button className="btn btn-plain full" onClick={() => setStep('join')}>
            Entrar com um convite
          </button>
          <label className="btn btn-plain full file-btn">
            Restaurar de um backup…
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 50 * 1024 * 1024) return toast('Arquivo grande demais');
                try {
                  const r = await restoreBackup(s.db, JSON.parse(await f.text()));
                  await updateSession({ householdId: r.householdId, displayName: name || 'Eu', householdConnected: false });
                  toast(`Backup restaurado (${r.inserted} registros)`);
                } catch (err) {
                  toast((err as Error).message);
                }
              }}
            />
          </label>
        </Section>
      )}

      {step === 'create' && (
        <form onSubmit={create}>
          <Section footer="A Casa é criada neste aparelho. Você pode ativar o compartilhamento depois, em Casa › Compartilhamento.">
            <label className="field">
              <span>Seu nome</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
            </label>
            <label className="field">
              <span>Nome da Casa</span>
              <input className="input" value={house} onChange={(e) => setHouse(e.target.value)} placeholder="Ex.: Casa Ian & Fernanda" maxLength={60} />
            </label>
            <button className="btn btn-primary full" type="submit">
              Começar
            </button>
            <button className="btn btn-plain full" type="button" onClick={() => setStep('start')}>
              Voltar
            </button>
          </Section>
        </form>
      )}

      {step === 'join' && (
        <>
          {!s.backend ? (
            <BackendConfig />
          ) : !user ? (
            <LoginForm onLogin={setUser} />
          ) : (
            <form onSubmit={join}>
              <Section footer="Peça o código a quem já mora na Casa (Casa › Compartilhamento › Gerar código).">
                <label className="field">
                  <span>Seu nome</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
                </label>
                <label className="field">
                  <span>Código de convite</span>
                  <input className="input mono" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="off" required />
                </label>
                <button className="btn btn-primary full" disabled={busy} type="submit">
                  Entrar na Casa
                </button>
              </Section>
            </form>
          )}
          <button className="btn btn-plain full" onClick={() => setStep('start')}>
            Voltar
          </button>
        </>
      )}
    </div>
  );
}
