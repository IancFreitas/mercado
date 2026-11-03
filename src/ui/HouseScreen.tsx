import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';
import { saveConfig } from '../app/services';
import { exportBackup, restoreBackup } from '../backup/backup';
import { SupabaseBackend, validateConfig } from '../sync/supabase';
import { Section } from './components';

export function HouseScreen() {
  const { s, session, updateSession, toast } = useApp();
  const hid = session.householdId!;
  const household = useLiveQuery(() => s.db.households.get(hid), [hid]);
  const [houseName, setHouseName] = useState('');
  const [myName, setMyName] = useState(session.displayName);
  useEffect(() => setHouseName(household?.name ?? ''), [household?.name]);

  return (
    <div className="screen">
      <h1 className="large-title">Casa</h1>

      <Section title="Identificação">
        <label className="field">
          <span>Nome da Casa</span>
          <input
            className="input"
            value={houseName}
            maxLength={60}
            onChange={(e) => setHouseName(e.target.value)}
            onBlur={() => houseName.trim() && houseName !== household?.name && s.repo.renameHousehold(hid, houseName)}
          />
        </label>
        <label className="field">
          <span>Seu nome (aparece nos itens)</span>
          <input
            className="input"
            value={myName}
            maxLength={40}
            onChange={(e) => setMyName(e.target.value)}
            onBlur={() => myName.trim() && updateSession({ displayName: myName.trim() })}
          />
        </label>
      </Section>

      <SharingSection />
      <ConflictsSection />
      <BackupSection />

      <Section title="Privacidade" footer="Os dados ficam neste aparelho (IndexedDB). Se o compartilhamento estiver ativo, as alterações também são enviadas ao seu projeto Supabase. Detalhes em docs/SECURITY.md.">
        <button
          className="btn btn-danger full"
          onClick={async () => {
            if (!confirm('Apagar TODOS os dados deste aparelho? Faça um backup antes. Os dados no servidor (se houver) não são apagados.')) return;
            await s.backend?.signOut();
            await s.db.delete();
            toast('Dados locais apagados');
            location.reload();
          }}
        >
          Apagar dados deste aparelho
        </button>
      </Section>
      <p className="version">Smart Pantry v{__APP_VERSION__} · aparelho {s.deviceId.slice(0, 6)}</p>
    </div>
  );
}

function SharingSection() {
  const { s, session, updateSession, toast, restartSync } = useApp();
  const hid = session.householdId!;
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [members, setMembers] = useState<{ userId: string; role: string; displayName: string }[]>([]);
  const [invite, setInvite] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void s.backend?.currentUser().then(setUser);
  }, [s.backend]);
  useEffect(() => {
    if (s.backend && user && session.householdConnected) void s.backend.members(hid).then(setMembers).catch(() => {});
  }, [s.backend, user, session.householdConnected, hid]);

  if (!s.backend) return <BackendConfig />;
  if (!user) return <LoginForm onLogin={setUser} />;

  async function connect() {
    setBusy(true);
    try {
      await s.backend!.createHousehold(hid, session.displayName);
      await updateSession({ householdConnected: true });
      await restartSync();
      toast('Casa conectada ao servidor');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function makeInvite() {
    setBusy(true);
    try {
      setInvite(await s.backend!.createInvitation(hid));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Compartilhamento"
      footer={
        session.householdConnected
          ? 'Somente membros desta Casa conseguem ler ou alterar os dados (controle por RLS no banco).'
          : 'Conectar envia as alterações desta Casa ao servidor para que outros moradores convidados possam vê-las.'
      }
    >
      <div className="row">
        <span className="grow">Conta</span>
        <span className="muted">{user.email}</span>
      </div>
      {!session.householdConnected ? (
        <button className="btn btn-primary full" disabled={busy} onClick={connect}>
          Ativar compartilhamento desta Casa
        </button>
      ) : (
        <>
          <div className="row">
            <span className="grow">Moradores</span>
          </div>
          {members.map((m) => (
            <div className="row muted" key={m.userId}>
              <span className="grow">
                {m.displayName || 'Sem nome'} {m.userId === user.id && '(você)'}
              </span>
              <span>{m.role === 'owner' ? 'Dono' : 'Membro'}</span>
            </div>
          ))}
          <button className="btn btn-primary full" disabled={busy} onClick={makeInvite}>
            Gerar código de convite
          </button>
          {invite && (
            <div className="invite" data-testid="invite-code">
              <code>{invite.replace(/(.{4})(?=.)/g, '$1-')}</code>
              <small>Válido por 48 h e para 1 uso. Envie por um canal privado. Ele só aparece agora.</small>
              <button
                className="link"
                onClick={() => navigator.clipboard?.writeText(invite).then(() => toast('Código copiado'), () => toast('Não foi possível copiar'))}
              >
                Copiar
              </button>
            </div>
          )}
          <button
            className="btn btn-plain full"
            onClick={async () => {
              await s.engine.sync(hid);
              toast(s.engine.lastError ?? 'Sincronizado');
            }}
          >
            Sincronizar agora
          </button>
        </>
      )}
      <button
        className="btn btn-plain full"
        onClick={async () => {
          await s.backend!.signOut();
          await updateSession({ householdConnected: false });
          await restartSync();
          setUser(null);
        }}
      >
        Sair da conta neste aparelho
      </button>
    </Section>
  );
}

export function BackendConfig() {
  const { s, toast } = useApp();
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  return (
    <Section
      title="Compartilhamento"
      footer="Para compartilhar entre aparelhos é preciso um projeto Supabase (plano gratuito). Veja docs/SETUP_SUPABASE.md. Use somente a chave pública (anon); nunca a service_role."
    >
      <form
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          const cfg = validateConfig({ url: url.trim(), anonKey: key.trim() });
          if (!cfg) return toast('URL (https) ou chave inválida');
          await saveConfig(s.db, cfg);
          location.reload();
        }}
      >
        <label className="field">
          <span>URL do projeto</span>
          <input className="input" placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" />
        </label>
        <label className="field">
          <span>Chave pública (anon)</span>
          <input className="input" value={key} onChange={(e) => setKey(e.target.value)} autoCapitalize="off" autoComplete="off" />
        </label>
        <button className="btn btn-primary full" type="submit">
          Salvar configuração
        </button>
      </form>
    </Section>
  );
}

export function LoginForm({ onLogin, backend }: { onLogin: (u: { id: string; email?: string }) => void; backend?: SupabaseBackend }) {
  const { s, toast } = useApp();
  const b = backend ?? s.backend!;
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Entrar" footer="Enviamos um código de 6 dígitos por e-mail. O código funciona dentro do app instalado (links mágicos abririam no Safari).">
      <form
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (!sent) {
              await b.sendCode(email);
              setSent(true);
              toast('Código enviado');
            } else {
              const id = await b.verifyCode(email, code);
              onLogin({ id, email });
            }
          } catch (err) {
            toast((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>E-mail</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent} autoComplete="email" required />
        </label>
        {sent && (
          <label className="field">
            <span>Código</span>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={10} required />
          </label>
        )}
        <button className="btn btn-primary full" disabled={busy} type="submit">
          {sent ? 'Confirmar código' : 'Enviar código'}
        </button>
      </form>
    </Section>
  );
}

function ConflictsSection() {
  const { s, session, toast } = useApp();
  const hid = session.householdId!;
  const conflicts = useLiveQuery(
    () => s.db.conflicts.where('householdId').equals(hid).filter((c) => !c.resolved).toArray(),
    [hid],
    [],
  );
  if (conflicts.length === 0) return null;
  return (
    <Section title="Conflitos" footer="Duas pessoas alteraram o mesmo campo ao mesmo tempo. O app manteve a alteração mais recente; você pode restaurar a outra.">
      {conflicts.map((c) => (
        <div className="row conflict" key={c.id}>
          <span className="grow">
            <strong>{c.field}</strong>: ficou <code>{JSON.stringify(c.winnerValue)}</code>, a outra versão era <code>{JSON.stringify(c.loserValue)}</code>
          </span>
          <button
            className="link"
            onClick={async () => {
              await s.engine.mutate(hid, c.entity, c.entityId, { [c.field]: c.loserValue });
              await s.db.conflicts.update(c.id, { resolved: true });
              toast('Valor restaurado');
            }}
          >
            Usar outra
          </button>
          <button className="link" onClick={() => s.db.conflicts.update(c.id, { resolved: true })}>
            Manter
          </button>
        </div>
      ))}
    </Section>
  );
}

function BackupSection() {
  const { s, session, toast } = useApp();
  const hid = session.householdId!;
  const last = useLiveQuery(() => s.db.backups.where('householdId').equals(hid).reverse().sortBy('createdAt'), [hid], []);
  return (
    <Section
      title="Backup"
      footer="O arquivo .json pode ser salvo em Arquivos › iCloud Drive pela folha de compartilhamento. O app não grava no iCloud automaticamente (limitação do iOS para web apps)."
    >
      <button
        className="btn btn-plain full"
        onClick={async () => {
          const data = await exportBackup(s.db, hid);
          const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
          const fname = `smart-pantry-${new Date().toISOString().slice(0, 10)}.json`;
          const file = new File([blob], fname, { type: 'application/json' });
          if (navigator.canShare?.({ files: [file] })) {
            try {
              await navigator.share({ files: [file], title: 'Backup Smart Pantry' });
              return;
            } catch {
              /* cancelado: cai no download */
            }
          }
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = fname;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }}
      >
        Exportar backup
      </button>
      <label className="btn btn-plain full file-btn">
        Restaurar backup…
        <input
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (f.size > 50 * 1024 * 1024) return toast('Arquivo grande demais');
            try {
              const r = await restoreBackup(s.db, JSON.parse(await f.text()), hid);
              toast(`Restaurado: ${r.inserted} novos, ${r.updated} atualizados, ${r.unchanged} sem mudança`);
            } catch (err) {
              toast((err as Error).message);
            }
          }}
        />
      </label>
      {last[0] && (
        <div className="row muted">
          Último: {last[0].kind === 'export' ? 'exportado' : 'importado'} em {new Date(last[0].createdAt).toLocaleString('pt-BR')}
        </div>
      )}
    </Section>
  );
}
