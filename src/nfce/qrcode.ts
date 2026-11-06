/**
 * Interpretação do conteúdo do QR Code da NFC-e (versões 1, 2 e 3).
 * Ver docs/research/NFCE_SP.md §2.2.
 *
 * Segurança: o conteúdo do QR é dado não confiável. A URL só é considerada
 * "abrível" se for http(s) em domínio *.gov.br (todas as SEFAZ). Caso
 * contrário, o app usa apenas a chave e monta a URL oficial de consulta.
 */
import { AccessKeyError, parseAccessKey, type AccessKeyInfo } from './accessKey';

export interface NfceQr {
  info: AccessKeyInfo;
  qrVersion: 1 | 2 | 3 | null;
  /** 1 = produção, 2 = homologação (teste). */
  environment: 1 | 2 | null;
  /** Só no QR de contingência offline (v2): dia da emissão e valor total. */
  offline?: { day: number; totalCents: number };
  /** URL segura para abrir a consulta na SEFAZ (null se não houver). */
  consultUrl: string | null;
  /** Texto original lido (guardado para auditoria). */
  raw: string;
}

/** URLs oficiais de consulta por chave (fallback quando o QR não traz URL confiável). */
const CONSULT_BY_KEY: Record<string, string> = {
  SP: 'https://www.nfce.fazenda.sp.gov.br/consulta',
};

const MAX_QR_TEXT = 2048;

export function isTrustedSefazUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return (url.protocol === 'https:' || url.protocol === 'http:') && /(^|\.)gov\.br$/i.test(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function toCents(v: string): number | null {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

/**
 * Aceita: URL completa do QR, só o valor de `p`, URL v1 (chNFe=…) ou a chave
 * de 44 dígitos (digitada ou lida de código de barras).
 */
export function parseNfceQr(text: string): NfceQr {
  const raw = text.trim();
  if (!raw) throw new AccessKeyError('QR Code vazio');
  if (raw.length > MAX_QR_TEXT) throw new AccessKeyError('Conteúdo do QR Code longo demais');

  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }

  // Só a chave (digitada, colada ou código de barras do DANFE).
  if (!url && /^[\d\s.\-/]+$/.test(raw)) {
    const info = parseAccessKey(raw);
    return { info, qrVersion: null, environment: null, consultUrl: CONSULT_BY_KEY[info.uf] ?? null, raw };
  }

  let p: string | null = null;
  let chNFe: string | null = null;
  if (url) {
    p = url.searchParams.get('p');
    chNFe = url.searchParams.get('chNFe');
  } else {
    // Só o conteúdo do parâmetro p (com | ou %7C).
    p = raw.replace(/^p=/, '');
  }

  const safeUrl = url && isTrustedSefazUrl(raw) ? url.toString() : null;

  if (chNFe) {
    const info = parseAccessKey(chNFe);
    const env = url?.searchParams.get('tpAmb');
    return {
      info,
      qrVersion: 1,
      environment: env === '1' ? 1 : env === '2' ? 2 : null,
      consultUrl: safeUrl ?? CONSULT_BY_KEY[info.uf] ?? null,
      raw,
    };
  }
  if (!p) throw new AccessKeyError('Este QR Code não parece ser de uma nota fiscal');

  const parts = decodeURIComponent(p).split('|');
  const info = parseAccessKey(parts[0] ?? '');
  const version = parts[1] === '2' ? 2 : parts[1] === '3' ? 3 : null;
  if (!version) throw new AccessKeyError('Versão do QR Code não reconhecida');
  const env = parts[2] === '1' ? 1 : parts[2] === '2' ? 2 : null;

  const result: NfceQr = {
    info,
    qrVersion: version,
    environment: env,
    consultUrl: safeUrl ?? CONSULT_BY_KEY[info.uf] ?? null,
    raw,
  };
  // v2 offline: chave|2|tpAmb|dia|vNF|digVal|cIdToken|hash
  if (version === 2 && parts.length >= 8) {
    const day = Number(parts[3]);
    const cents = toCents(parts[4] ?? '');
    if (day >= 1 && day <= 31 && cents !== null) result.offline = { day, totalCents: cents };
  }
  return result;
}
