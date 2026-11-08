/**
 * Chave de acesso de NF-e/NFC-e (44 dígitos).
 *
 * Layout: cUF(2) AAMM(4) CNPJ/CPF(14) modelo(2) série(3) número(9) tpEmis(1) código(8) DV(1)
 * DV: módulo 11 com pesos 2..9 da direita para a esquerda; resto 0 ou 1 → DV 0.
 */

export const UF_BY_CODE: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

export interface AccessKeyInfo {
  key: string;
  uf: string;
  /** Ano e mês de emissão (da chave; o dia não está na chave). */
  year: number;
  month: number;
  /** CNPJ (ou CPF com zeros à esquerda) do emitente, só dígitos. */
  issuerId: string;
  /** '65' = NFC-e (cupom), '55' = NF-e. */
  model: '65' | '55';
  series: number;
  number: number;
  /** 1 = normal; 9 = contingência offline (NFC-e). */
  emissionType: number;
}

export function mod11(digits43: string): number {
  let sum = 0;
  let w = 2;
  for (let i = digits43.length - 1; i >= 0; i--) {
    sum += Number(digits43[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

export class AccessKeyError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'AccessKeyError';
  }
}

/** Aceita a chave com espaços/pontos/traços (como impressa) e valida tudo. */
export function parseAccessKey(raw: string): AccessKeyInfo {
  const key = raw.replace(/\D/g, '');
  if (key.length !== 44) throw new AccessKeyError('A chave de acesso deve ter 44 dígitos');
  if (mod11(key.slice(0, 43)) !== Number(key[43])) {
    throw new AccessKeyError('Chave de acesso inválida (dígito verificador não confere) — confira os números');
  }
  const uf = UF_BY_CODE[key.slice(0, 2)];
  if (!uf) throw new AccessKeyError('Estado (UF) da chave desconhecido');
  const month = Number(key.slice(4, 6));
  if (month < 1 || month > 12) throw new AccessKeyError('Mês de emissão inválido na chave');
  const model = key.slice(20, 22);
  if (model !== '65' && model !== '55') throw new AccessKeyError('A chave não é de NF-e nem de NFC-e');
  return {
    key,
    uf,
    year: 2000 + Number(key.slice(2, 4)),
    month,
    issuerId: key.slice(6, 20),
    model,
    series: Number(key.slice(22, 25)),
    number: Number(key.slice(25, 34)),
    emissionType: Number(key[34]),
  };
}

export function formatCnpj(id: string): string {
  return id.length === 14 ? id.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : id;
}

/** Chave em grupos de 4, como impressa no cupom. */
export function formatAccessKey(key: string): string {
  return key.replace(/(\d{4})(?=\d)/g, '$1 ');
}
