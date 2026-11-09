import { isTrustedSefazUrl, parseNfceQr, type NfceQr } from '../nfce/qrcode';
import { formatCnpj } from '../nfce/accessKey';

/**
 * Deep link do Atalho do iPhone: #/notas?qr=<URL do QR codificada>&colar=1.
 * Função PURA: só interpreta o link. Nada é gravado aqui; quem grava é o toque
 * em "Registrar" na tela de confirmação (qualquer página/mensagem pode abrir o link).
 */
export type ShortcutLink =
  | { kind: 'none' }
  | { kind: 'invalid'; error: string }
  | { kind: 'confirm'; qr: NfceQr; paste: boolean };

export function evaluateShortcutLink(params: URLSearchParams): ShortcutLink {
  const raw = params.get('qr');
  if (raw === null) return { kind: 'none' };
  const text = raw.trim();
  // Mesmas regras de segurança do QR: só URL https/http em *.gov.br (chave solta não vale no atalho).
  if (!isTrustedSefazUrl(text)) return { kind: 'invalid', error: 'O link do Atalho não traz um endereço de nota fiscal válido (gov.br).' };
  try {
    return { kind: 'confirm', qr: parseNfceQr(text), paste: params.get('colar') === '1' };
  } catch (e) {
    return { kind: 'invalid', error: (e as Error).message };
  }
}

/** Nome da loja quando existir; senão o CNPJ formatado. */
export function storeLabel(cnpj: string | null | undefined, names: Map<string, string>, fallback = 'Compra'): string {
  if (!cnpj) return fallback;
  return names.get(cnpj) ?? formatCnpj(cnpj);
}

/** Com nome: "Nome (CNPJ)"; sem nome: só o CNPJ. */
export function storeLabelWithCnpj(cnpj: string, names: Map<string, string>): string {
  const n = names.get(cnpj);
  return n ? `${n} (${formatCnpj(cnpj)})` : formatCnpj(cnpj);
}
