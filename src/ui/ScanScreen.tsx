import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';
import { formatAccessKey, formatCnpj } from '../nfce/accessKey';
import { decodeFile, decodeFrom } from '../nfce/decodeImage';
import { parseNfceQr, type NfceQr } from '../nfce/qrcode';
import { parseSefazText, type ParsedNfce } from '../nfce/parseSefazText';
import type { Purchase } from '../domain/types';
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
              <PurchaseRow key={p.id} p={p} />
            ))}
          </ul>
        </section>
      )}

      <Section footer="Próximo passo da Fase 2: reconhecer os produtos e montar o histórico de preços a partir dos itens importados.">
        <div className="row muted">Produtos e preços — em desenvolvimento</div>
      </Section>
    </div>
  );
}

function PurchaseRow({ p }: { p: Purchase }) {
  const { s, session, toast } = useApp();
  const hid = session.householdId!;
  const [open, setOpen] = useState(false);
  const pending = p.status === 'pendente';
  return (
    <li className="row" data-testid="purchase-row">
      <span className="grow">
        <span className="item-name">{p.issuerCnpj ? formatCnpj(p.issuerCnpj) : 'Compra'}</span>
        <span className="item-meta" style={{ display: 'block' }}>
          {new Date(p.purchasedAt).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' })}
          {p.totalCents ? ` · ${formatBRL(p.totalCents)}` : ''} · {pending ? 'itens pendentes' : 'importada'}
          {p.paymentMethod ? ` · ${p.paymentMethod}` : ''}
        </span>
      </span>
      {pending ? (
        <button className="link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Importar itens
        </button>
      ) : (
        <button className="link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Ocultar itens' : 'Ver itens'}
        </button>
      )}
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
      {open && pending && <ImportPanel purchase={p} onDone={() => { setOpen(false); toast('Itens importados'); }} onCancel={() => setOpen(false)} />}
      {open && !pending && <PurchaseItems purchase={p} />}
    </li>
  );
}

function PurchaseItems({ purchase }: { purchase: Purchase }) {
  const { s, session } = useApp();
  const hid = session.householdId!;
  const items = useLiveQuery(() => s.repo.listPurchaseItems(hid, purchase.id), [hid, purchase.id], []);
  return (
    <div className="row-edit import-box" data-testid="purchase-items">
      {items.length === 0 && <span className="muted">Nenhum item encontrado (pode estar sincronizando).</span>}
      {items.map((i) => (
        <div className="import-line" key={i.id}>
          <span className="grow">{i.rawDescription}</span>
          <span className="muted">
            {i.quantity} {i.unit} × {formatBRL(i.unitPriceCents)}
          </span>
          <strong>{formatBRL(i.totalCents)}</strong>
        </div>
      ))}
    </div>
  );
}

function ImportPanel({ purchase, onDone, onCancel }: { purchase: Purchase; onDone: () => void; onCancel: () => void }) {
  const { s, session } = useApp();
  const hid = session.householdId!;
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedNfce | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { setText(t); setParsed(null); setErr(null); }
    } catch {
      /* sem permissão/suporte: o usuário cola manualmente no campo */
    }
  }

  function read() {
    try {
      setParsed(parseSefazText(text));
      setErr(null);
    } catch (e) {
      setParsed(null);
      setErr((e as Error).message);
    }
  }

  async function confirmImport() {
    if (!parsed) return;
    setBusy(true);
    try {
      await s.repo.importPurchaseItems(hid, purchase.id, parsed);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row-edit import-box" data-testid="import-panel">
      <p className="muted import-help">
        Abra a nota na SEFAZ, selecione do primeiro produto até antes de "Chave de acesso", copie e cole aqui.
      </p>
      <textarea
        className="input import-text"
        aria-label="Texto da nota"
        rows={6}
        value={text}
        onChange={(e) => { setText(e.target.value); setParsed(null); }}
        placeholder="Cole aqui o texto copiado da página da SEFAZ"
      />
      <div className="import-actions">
        <button className="btn btn-plain" type="button" onClick={paste}>Colar</button>
        <button className="btn btn-primary" type="button" onClick={read} disabled={!text.trim()}>Ler texto</button>
        <button className="btn btn-plain" type="button" onClick={onCancel}>Cancelar</button>
      </div>
      {err && <div className="banner banner-warn import-wide" role="alert">{err}</div>}
      {parsed && (
        <div className="import-wide" data-testid="import-preview">
          {parsed.warnings.length > 0 && (
            <div className="banner banner-warn" role="alert">
              <strong>Confira antes de importar:</strong>
              <ul>{parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          {parsed.number === undefined && (
            <div className="banner">O texto não tem número/série da nota; não consigo confirmar que é desta nota.</div>
          )}
          <p><strong>{parsed.items.length} itens</strong></p>
          {parsed.items.map((i, n) => (
            <div className="import-line" key={n}>
              <span className="grow">{i.description}</span>
              <span className="muted">{i.quantity} {i.unit} × {formatBRL(i.unitPriceCents)}</span>
              <strong>{formatBRL(i.totalCents)}</strong>
            </div>
          ))}
          <div className="import-line">
            <span className="grow">Valor total</span>
            <span>{parsed.totals.totalCents !== undefined ? formatBRL(parsed.totals.totalCents) : '—'}</span>
          </div>
          {parsed.totals.discountCents > 0 && (
            <div className="import-line"><span className="grow">Descontos</span><span>− {formatBRL(parsed.totals.discountCents)}</span></div>
          )}
          {parsed.totals.otherCents > 0 && (
            <div className="import-line"><span className="grow">Outras despesas</span><span>{formatBRL(parsed.totals.otherCents)}</span></div>
          )}
          <div className="import-line">
            <span className="grow"><strong>Valor a pagar</strong></span>
            <strong>{formatBRL(parsed.totals.payableCents ?? parsed.totals.totalCents ?? 0)}</strong>
          </div>
          {parsed.payment && (
            <div className="import-line">
              <span className="grow">{parsed.payment.method}</span>
              <span>{formatBRL(parsed.payment.amountCents)}</span>
            </div>
          )}
          <button className="btn btn-primary" type="button" disabled={busy} onClick={confirmImport}>
            {parsed.consistent ? 'Confirmar importação' : 'Confirmar importação mesmo assim'}
          </button>
        </div>
      )}
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
