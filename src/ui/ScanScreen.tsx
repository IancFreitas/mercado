import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';
import { formatAccessKey, formatCnpj } from '../nfce/accessKey';
import { decodeFile, decodeFrom } from '../nfce/decodeImage';
import { parseNfceQr, type NfceQr } from '../nfce/qrcode';
import { parseSefazText, type ParsedNfce } from '../nfce/parseSefazText';
import type { Purchase } from '../domain/types';
import { pantryFor } from '../pantry/pantry';
import { Section, formatBRL } from './components';
import { useDefaultList } from './ListScreen';
import { reconcile } from '../shopping/reconcile';
import { evaluateShortcutLink, storeLabel, type ShortcutLink } from '../stores/stores';
import { useStoreNames } from '../stores/useStoreNames';
import { useRoute } from './router';

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
  const names = useStoreNames();
  const route = useRoute();
  // Deep link do Atalho (#/notas?qr=…&colar=1): só pede confirmação; nada é gravado sem toque.
  const [link, setLink] = useState<Extract<ShortcutLink, { kind: 'confirm' }> | null>(null);
  const [openId, setOpenId] = useState<{ id: string; paste: boolean } | null>(null);
  const linkKey = route.params.get('qr') ? `${route.seq}|${route.params.get('qr')}` : '';
  useEffect(() => {
    if (!linkKey) return;
    const ev = evaluateShortcutLink(route.params);
    history.replaceState(null, '', '#/notas'); // não reprocessar ao recarregar
    if (ev.kind === 'confirm') {
      setLink(ev);
      setError(null);
      setResult(null);
    } else if (ev.kind === 'invalid') {
      setLink(null);
      setError(ev.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey]);

  async function confirmLink() {
    if (!link) return;
    setBusy(true);
    try {
      const r = await s.repo.savePurchaseFromQr(hid, link.qr);
      setLink(null);
      if (r.purchase.status === 'pendente') {
        toast(r.existing ? 'Esta nota já estava registrada' : 'Nota registrada');
        setOpenId({ id: r.purchase.id, paste: link.paste });
      } else {
        toast('Esta nota já foi registrada e importada');
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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

      {link && (
        <Section title="Atalho do iPhone">
          <div data-testid="shortcut-confirm">
            <div className="row">
              <span className="grow">
                Registrar nota de <strong>{storeLabel(link.qr.info.issuerId, names)}</strong> ({MONTHS[link.qr.info.month - 1]}/{link.qr.info.year})?
              </span>
            </div>
            <div className="import-actions" style={{ padding: '0 16px 12px' }}>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={confirmLink}>Registrar nota</button>
              <button className="btn btn-plain" type="button" onClick={() => setLink(null)}>Cancelar</button>
            </div>
          </div>
        </Section>
      )}

      {!result && !link && (
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
              <PurchaseRow key={p.id} p={p} names={names} autoOpen={openId?.id === p.id ? openId : null} />
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

function PurchaseRow({ p, names, autoOpen }: { p: Purchase; names: Map<string, string>; autoOpen: { id: string; paste: boolean } | null }) {
  const { s, session, toast } = useApp();
  const hid = session.householdId!;
  const [open, setOpen] = useState(false);
  const [recon, setRecon] = useState(false);
  const [naming, setNaming] = useState(false);
  const [storeText, setStoreText] = useState('');
  const pending = p.status === 'pendente';
  useEffect(() => {
    if (autoOpen && pending) setOpen(true);
  }, [autoOpen, pending]);
  async function saveStoreName() {
    if (!p.issuerCnpj) return;
    try {
      await s.repo.setStoreName(hid, p.issuerCnpj, storeText);
      setNaming(false);
      toast('Nome da loja salvo');
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <li className="row" data-testid="purchase-row">
      <span className="grow">
        <span className="item-name">{storeLabel(p.issuerCnpj, names)}</span>
        <span className="item-meta" style={{ display: 'block' }}>
          {p.issuerCnpj && names.has(p.issuerCnpj) ? `${formatCnpj(p.issuerCnpj)} · ` : ''}
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
      {!pending && (
        <button
          className="link"
          onClick={async () => {
            try {
              const r = await pantryFor(s.repo).addPurchaseToPantry(hid, p.id);
              toast(
                r.movements > 0
                  ? `${r.movements} produto(s) adicionados à despensa${r.ignored ? ` · ${r.ignored} item(ns) ignorado(s): unidade diferente do produto` : ''}`
                  : r.already > 0
                    ? 'Esta nota já estava na despensa'
                    : `Nenhum item pôde ser adicionado${r.ignored ? ` (${r.ignored} ignorado(s): unidade diferente do produto)` : ''}`,
              );
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          Adicionar à despensa
        </button>
      )}
      {!pending && (
        <button className="link" onClick={() => setRecon((v) => !v)} aria-expanded={recon}>
          Conferir com a lista
        </button>
      )}
      {p.issuerCnpj && (
        <button
          className="link"
          onClick={() => { setStoreText(names.get(p.issuerCnpj!) ?? ''); setNaming((v) => !v); }}
          aria-expanded={naming}
        >
          Nome da loja
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
      {naming && (
        <form className="row-edit import-box" onSubmit={(e: FormEvent) => { e.preventDefault(); void saveStoreName(); }}>
          <label className="field">
            <span>Nome da loja (vale para todas as notas do CNPJ {formatCnpj(p.issuerCnpj!)})</span>
            <input className="input" value={storeText} maxLength={60} onChange={(e) => setStoreText(e.target.value)} aria-label="Nome da loja" placeholder="Ex.: Mercado do bairro" />
          </label>
          <div className="import-actions">
            <button className="btn btn-primary" type="submit" disabled={!storeText.trim()}>Salvar nome</button>
            <button className="btn btn-plain" type="button" onClick={() => setNaming(false)}>Cancelar</button>
          </div>
        </form>
      )}
      {open && pending && <ImportPanel purchase={p} highlightPaste={!!autoOpen?.paste} onDone={(msg) => { setOpen(false); toast(msg); }} onCancel={() => setOpen(false)} />}
      {open && !pending && <PurchaseItems purchase={p} />}
      {recon && !pending && <ReconcilePanel purchase={p} onClose={() => setRecon(false)} />}
    </li>
  );
}

function ReconcilePanel({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const { s, session, toast } = useApp();
  const hid = session.householdId!;
  const list = useDefaultList();
  const noteItems = useLiveQuery(() => s.repo.listPurchaseItems(hid, purchase.id), [hid, purchase.id], []);
  const listItems = useLiveQuery(
    () => (list ? s.repo.listItems(hid, list.id) : Promise.resolve([])),
    [list?.id, hid],
    [],
  );
  const checked = listItems.filter((i) => i.checked);
  const r = reconcile(checked, noteItems);
  // Seleção por linha: pré-marcadas só as correspondências seguras (não frouxas); o usuário confirma.
  const [off, setOff] = useState<Set<string>>(new Set());
  const [on, setOn] = useState<Set<string>>(new Set());
  const isSel = (m: (typeof r.matched)[number]) => (m.loose ? on.has(m.listItem.id) : !off.has(m.listItem.id));
  const toggle = (m: (typeof r.matched)[number]) => {
    const id = m.listItem.id;
    const set = new Set(m.loose ? on : off);
    set.has(id) ? set.delete(id) : set.add(id);
    (m.loose ? setOn : setOff)(set);
  };
  const selected = r.matched.filter(isSel);

  async function clear() {
    try {
      for (const m of selected) await s.repo.removeItem(hid, m.listItem.id);
      toast(`${selected.length} item(ns) removido(s) da lista. Para desfazer: Lista › removidos recentemente › Restaurar`);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="row-edit import-box" data-testid="reconcile-panel">
      {checked.length === 0 ? (
        <span className="muted">Nenhum item marcado no carrinho da lista para conferir.</span>
      ) : r.matched.length === 0 ? (
        <span className="muted">Nenhum item marcado da lista aparece nesta nota.</span>
      ) : (
        <>
          <strong>Conferência: {r.matched.length} de {checked.length} marcado(s) estão na nota</strong>
          {r.matched.map((m) => (
            <div className="import-line" key={m.listItem.id} data-testid="reconcile-line">
              <input
                type="checkbox"
                checked={isSel(m)}
                onChange={() => toggle(m)}
                aria-label={`Remover ${m.listItem.name} da lista`}
                style={{ width: 24, height: 24 }}
              />
              <span className="grow">
                {m.listItem.name}
                <span className="item-meta" style={{ display: 'block' }}>{m.noteItem.rawDescription}</span>
              </span>
              <span className="recon-line">
                {m.foundCents !== undefined ? <span className="muted">Encontrado {formatBRL(m.foundCents)}</span> : <span className="muted">Sem preço anotado</span>}
                <strong>Pago {formatBRL(m.paidCents)}</strong>
                {m.diffCents !== undefined && m.diffCents !== 0 && (
                  <span className={m.diffCents > 0 ? 'cmp cmp-acima' : 'cmp cmp-abaixo'}>
                    {m.diffCents > 0 ? '▲ pagou ' : '▼ pagou '}
                    {formatBRL(Math.abs(m.diffCents))}
                    {m.diffCents > 0 ? ' a mais' : ' a menos'}
                  </span>
                )}
                {m.diffCents === 0 && <span className="cmp cmp-media">● igual ao anotado</span>}
                {m.loose && <span className="cmp cmp-sem">Confira se é o mesmo produto</span>}
              </span>
            </div>
          ))}
        </>
      )}
      {r.unmatchedList.length > 0 && r.matched.length > 0 && (
        <span className="muted">Marcados que não vieram na nota: {r.unmatchedList.map((i) => i.name).join(', ')}.</span>
      )}
      <div className="import-actions">
        <button className="btn btn-primary" type="button" disabled={selected.length === 0} onClick={clear}>
          Limpar comprados ({selected.length})
        </button>
        <button className="btn btn-plain" type="button" onClick={onClose}>Fechar</button>
      </div>
    </div>
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

function ImportPanel({ purchase, highlightPaste, onDone, onCancel }: { purchase: Purchase; highlightPaste?: boolean; onDone: (msg: string) => void; onCancel: () => void }) {
  const { s, session } = useApp();
  const hid = session.householdId!;
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedNfce | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [toPantry, setToPantry] = useState(true);

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
      setUnverified(false);
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
      let msg = 'Itens importados';
      if (toPantry) {
        try {
          const r = await pantryFor(s.repo).addPurchaseToPantry(hid, purchase.id);
          msg = `Itens importados · ${r.movements} produto(s) na despensa${r.ignored ? ` · ${r.ignored} item(ns) ignorado(s): unidade diferente do produto ou dados inválidos` : ''}`;
        } catch (e) {
          msg = `Itens importados, mas não entraram na despensa: ${(e as Error).message}`;
        }
      }
      onDone(msg);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row-edit import-box" data-testid="import-panel">
      <p className="muted import-help">
        {highlightPaste && <strong>Toque em Colar (o Atalho já copiou o texto da nota). </strong>}
        Abra a nota na SEFAZ, toque e segure em qualquer texto › Selecionar Tudo › Copiar. Volte aqui e cole.
        O app lê só os produtos e totais e ignora tudo a partir de "Chave de acesso" (seus dados pessoais não são lidos nem salvos).
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
        <button className={`btn ${highlightPaste ? 'btn-primary paste-hl' : 'btn-plain'}`} type="button" onClick={paste} data-testid="paste-btn">Colar</button>
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
            <label className="banner banner-warn import-check">
              <input type="checkbox" checked={unverified} onChange={(e) => setUnverified(e.target.checked)} />{' '}
              O texto não tem número/série; não consigo confirmar que é desta nota. Confirmo que é.
            </label>
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
          <label className="import-check">
            <input type="checkbox" checked={toPantry} onChange={(e) => setToPantry(e.target.checked)} /> Adicionar à despensa
          </label>
          <button className="btn btn-primary" type="button" disabled={busy || (parsed.number === undefined && !unverified)} onClick={confirmImport}>
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
