import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';
import { formatAccessKey, formatCnpj } from '../nfce/accessKey';
import { decodeFile, decodeFrom } from '../nfce/decodeImage';
import { parseNfceQr, type NfceQr } from '../nfce/qrcode';
import { Section, formatBRL } from './components';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function ScanScreen() {
  const { s, session, toast } = useApp();
  const hid = session.householdId!;
  const [result, setResult] = useState<NfceQr | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const purchases = useLiveQuery(() => s.repo.listPurchases(hid), [hid], []);
  const duplicate = useLiveQuery(
    async () => (result ? !!(await s.repo.findPurchaseByKey(hid, result.info.key)) : false),
    [result?.info.key, hid],
    false,
  );

  function handleText(text: string) {
    try {
      const qr = parseNfceQr(text);
      setResult(qr);
      setError(null);
      setCamera(false);
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    }
  }

  async function save() {
    if (!result) return;
    setBusy(true);
    try {
      const r = await s.repo.savePurchaseFromQr(hid, result);
      toast(r.existing ? 'Esta nota já estava registrada' : 'Nota registrada');
      setResult(null);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h1 className="large-title">Notas fiscais</h1>

      {!result && (
        <Section footer="A leitura é feita no próprio aparelho; nenhuma imagem é enviada a servidores.">
          {camera ? (
            <CameraScanner onText={handleText} onError={(m) => { setError(m); setCamera(false); }} />
          ) : (
            <button className="btn btn-primary full" onClick={() => { setError(null); setCamera(true); }}>
              📷 Escanear QR Code com a câmera
            </button>
          )}
          {camera && (
            <button className="btn btn-plain full" onClick={() => setCamera(false)}>
              Cancelar câmera
            </button>
          )}
          <label className="btn btn-plain full file-btn">
            Ler QR de uma foto…
            <input
              type="file"
              accept="image/*"
              data-testid="qr-photo"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  const text = await decodeFile(f);
                  if (text) handleText(text);
                  else setError('Não encontrei um QR Code na foto. Tente mais perto, com boa luz e sem reflexo.');
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            />
          </label>
          <form
            className="field"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              handleText(manual);
            }}
          >
            <span>Ou digite a chave de acesso (44 números, abaixo do QR)</span>
            <input
              className="input mono"
              inputMode="numeric"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="3526 0923 4760 …"
              aria-label="Chave de acesso"
              autoComplete="off"
            />
            <button className="btn btn-plain" type="submit" disabled={manual.replace(/\D/g, '').length < 44}>
              Usar chave
            </button>
          </form>
        </Section>
      )}

      {error && (
        <div className="banner banner-warn" role="alert">
          {error}
        </div>
      )}

      {result && <ResultCard qr={result} duplicate={duplicate} busy={busy} onSave={save} onCancel={() => setResult(null)} />}

      {purchases.length > 0 && (
        <section className="section">
          <h2 className="section-title">Notas registradas ({purchases.length})</h2>
          <ul className="card list" data-testid="purchase-list">
            {purchases.map((p) => (
              <li className="row" key={p.id}>
                <span className="grow">
                  <span className="item-name">{p.issuerCnpj ? formatCnpj(p.issuerCnpj) : 'Compra'}</span>
                  <span className="item-meta" style={{ display: 'block' }}>
                    {new Date(p.purchasedAt).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' })}
                    {p.totalCents ? ` · ${formatBRL(p.totalCents)}` : ''} · {p.status === 'pendente' ? 'itens pendentes' : 'importada'}
                  </span>
                </span>
                {p.consultUrl && (
                  <a className="link" href={p.consultUrl} target="_blank" rel="noopener noreferrer">
                    SEFAZ
                  </a>
                )}
                <button
                  className="link"
                  onClick={() => confirm('Remover esta nota?') && s.repo.removePurchase(hid, p.id)}
                  aria-label="Remover nota"
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Section footer="Próximo passo da Fase 2: importar os itens e preços da nota (pela página da SEFAZ ou pela foto do cupom).">
        <div className="row muted">Importação dos itens — em desenvolvimento</div>
      </Section>
    </div>
  );
}

function ResultCard({ qr, duplicate, busy, onSave, onCancel }: { qr: NfceQr; duplicate: boolean; busy: boolean; onSave: () => void; onCancel: () => void }) {
  const { info } = qr;
  return (
    <Section title={info.model === '65' ? 'NFC-e (cupom fiscal)' : 'NF-e'}>
      <div data-testid="scan-result">
        <div className="row">
          <span className="grow">Emitente (CNPJ)</span>
          <strong>{formatCnpj(info.issuerId)}</strong>
        </div>
        <div className="row">
          <span className="grow">Emissão</span>
          <span>
            {qr.offline ? `${qr.offline.day} ` : ''}
            {MONTHS[info.month - 1]}/{info.year} · {info.uf}
          </span>
        </div>
        <div className="row">
          <span className="grow">Número / série</span>
          <span>
            {info.number} / {info.series}
          </span>
        </div>
        {qr.offline && (
          <div className="row">
            <span className="grow">Valor total</span>
            <strong>{formatBRL(qr.offline.totalCents)}</strong>
          </div>
        )}
        <div className="row muted mono" style={{ fontSize: 13 }}>
          {formatAccessKey(info.key)}
        </div>
      </div>
      {qr.environment === 2 && <div className="banner banner-warn">Nota de homologação (teste) — não é uma compra real.</div>}
      {info.model === '55' && (
        <div className="banner">NF-e (nota grande) não tem consulta pública dos itens sem CAPTCHA; os itens precisarão ser lidos da foto ou digitados.</div>
      )}
      {duplicate ? (
        <div className="banner banner-warn" data-testid="dup-warning">
          Esta nota já foi registrada nesta Casa.
        </div>
      ) : (
        <button className="btn btn-primary full" disabled={busy} onClick={onSave}>
          Registrar nota
        </button>
      )}
      {qr.consultUrl && (
        <a className="btn btn-plain full" href={qr.consultUrl} target="_blank" rel="noopener noreferrer">
          Abrir na SEFAZ ↗
        </a>
      )}
      <button className="btn btn-plain full" onClick={onCancel}>
        Ler outra
      </button>
    </Section>
  );
}

function CameraScanner({ onText, onError }: { onText: (t: string) => void; onError: (m: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const canvas = document.createElement('canvas');
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Câmera indisponível neste navegador — use "Ler QR de uma foto".');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          if (stopped) return;
          if (v.videoWidth) {
            const t = decodeFrom(v, v.videoWidth, v.videoHeight, canvas);
            if (t) {
              onText(t);
              return;
            }
          }
          timer = setTimeout(tick, 200);
        };
        tick();
      } catch (e) {
        const name = (e as Error).name;
        onError(
          name === 'NotAllowedError'
            ? 'Permissão da câmera negada. No iPhone: Ajustes › Safari › Câmera, ou use "Ler QR de uma foto".'
            : (e as Error).message || 'Não foi possível abrir a câmera',
        );
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="camera">
      <video ref={video} playsInline muted autoPlay aria-label="Visualização da câmera" />
      <div className="camera-frame" aria-hidden />
      <p className="muted" style={{ textAlign: 'center', margin: 8 }}>
        Aponte para o QR Code da nota
      </p>
    </div>
  );
}
