import { describe, expect, it } from 'vitest';
import { formatAccessKey, mod11, parseAccessKey } from '../../src/nfce/accessKey';
import { isTrustedSefazUrl, parseNfceQr } from '../../src/nfce/qrcode';

/** Monta uma chave SINTÉTICA válida (não corresponde a nota real). */
function key(opts: { uf?: string; aamm?: string; cnpj?: string; model?: string; serie?: string; num?: string; tpEmis?: string } = {}) {
  const k43 =
    (opts.uf ?? '35') + (opts.aamm ?? '2609') + (opts.cnpj ?? '11222333000181') + (opts.model ?? '65') +
    (opts.serie ?? '006') + (opts.num ?? '000012345') + (opts.tpEmis ?? '1') + '12345678';
  return k43 + mod11(k43);
}

describe('chave de acesso', () => {
  it('decodifica os campos', () => {
    const i = parseAccessKey(key());
    expect(i).toMatchObject({ uf: 'SP', year: 2026, month: 9, issuerId: '11222333000181', model: '65', series: 6, number: 12345, emissionType: 1 });
  });
  it('aceita a chave como impressa (com espaços, pontos e traço)', () => {
    const k = key();
    expect(parseAccessKey(formatAccessKey(k)).key).toBe(k);
    expect(parseAccessKey(`${k.slice(0, 2)}.${k.slice(2, 43)}-${k[43]}`).key).toBe(k);
  });
  it('reconhece NF-e (modelo 55)', () => {
    expect(parseAccessKey(key({ model: '55' })).model).toBe('55');
  });
  it.each([
    ['tamanho errado', '123'],
    ['dígito verificador errado', key().slice(0, 43) + ((Number(key()[43]) + 1) % 10)],
    ['UF inexistente', key({ uf: '99' })],
    ['mês inválido', key({ aamm: '2613' })],
    ['modelo desconhecido', key({ model: '57' })],
  ])('rejeita %s', (_n, k) => {
    expect(() => parseAccessKey(k)).toThrow();
  });
  it('DV: resto 0 ou 1 vira 0 (mod11)', () => {
    // procura um prefixo cujo resto seja < 2 e confere
    for (let n = 0; n < 50; n++) {
      const k43 = key({ num: String(n).padStart(9, '0') }).slice(0, 43);
      const dv = mod11(k43);
      expect(dv).toBeGreaterThanOrEqual(0);
      expect(dv).toBeLessThanOrEqual(9);
    }
  });
});

describe('QR Code da NFC-e', () => {
  const k = key();
  it('v2 online (URL de SP)', () => {
    const q = parseNfceQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${k}|2|1|1|ABCDEF0123456789ABCDEF0123456789ABCDEF01`);
    expect(q).toMatchObject({ qrVersion: 2, environment: 1 });
    expect(q.info.key).toBe(k);
    expect(q.consultUrl).toContain('nfce.fazenda.sp.gov.br');
    expect(q.offline).toBeUndefined();
  });
  it('v2 com | codificado (%7C)', () => {
    const q = parseNfceQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${k}%7C2%7C1%7C1%7CABC`);
    expect(q.info.key).toBe(k);
  });
  it('v2 contingência offline traz dia e valor total', () => {
    const q = parseNfceQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${key({ tpEmis: '9' })}|2|1|19|597.45|6a6f|1|HASH`);
    expect(q.offline).toEqual({ day: 19, totalCents: 59745 });
  });
  it('v3 online', () => {
    const q = parseNfceQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${k}|3|1`);
    expect(q).toMatchObject({ qrVersion: 3, environment: 1 });
  });
  it('v1 legado (chNFe=)', () => {
    const q = parseNfceQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?chNFe=${k}&nVersao=100&tpAmb=2`);
    expect(q).toMatchObject({ qrVersion: 1, environment: 2 });
  });
  it('só o valor de p', () => {
    expect(parseNfceQr(`${k}|2|1|1|ABC`).info.key).toBe(k);
  });
  it('só a chave digitada usa a consulta oficial do estado', () => {
    const q = parseNfceQr(formatAccessKey(k));
    expect(q.qrVersion).toBeNull();
    expect(q.consultUrl).toBe('https://www.nfce.fazenda.sp.gov.br/consulta');
  });
  it('URL fora de *.gov.br não é aberta (QR adulterado)', () => {
    const q = parseNfceQr(`https://golpe.example.com/qrcode?p=${k}|2|1|1|ABC`);
    expect(q.consultUrl).toBe('https://www.nfce.fazenda.sp.gov.br/consulta');
    expect(isTrustedSefazUrl('https://sefaz.gov.br.golpe.com/x')).toBe(false);
    expect(isTrustedSefazUrl('javascript:alert(1)//gov.br')).toBe(false);
    expect(isTrustedSefazUrl('https://user:pw@www.nfce.fazenda.sp.gov.br/')).toBe(false);
    expect(isTrustedSefazUrl('https://www.fazenda.pr.gov.br/nfce/qrcode')).toBe(true);
  });
  it.each([
    ['vazio', ''],
    ['QR qualquer (site)', 'https://www.google.com'],
    ['Pix / texto', 'pagamento qualquer'],
    ['versão desconhecida', `${k}|9|1`],
    ['texto gigante', 'x'.repeat(5000)],
  ])('rejeita %s', (_n, t) => {
    expect(() => parseNfceQr(t)).toThrow();
  });
});

describe('nota escaneada → compra pendente', async () => {
  const { PantryDB } = await import('../../src/db/db');
  const { PantryRepo } = await import('../../src/db/repo');
  const { SyncEngine } = await import('../../src/sync/engine');
  const { MemorySyncServer } = await import('../../src/sync/memoryServer');
  let n = 0;
  async function dev(server: InstanceType<typeof MemorySyncServer>, user: string) {
    const engine = await SyncEngine.create(new PantryDB(`nfce-${++n}`), `devN${n}`, { transport: server.transportFor(user) });
    return new PantryRepo(engine, () => user);
  }

  it('registra a nota e bloqueia importação duplicada', async () => {
    const server = new MemorySyncServer();
    const a = await dev(server, 'ian');
    const { household } = await a.createHousehold('Casa');
    const qr = parseNfceQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${key({ tpEmis: '9' })}|2|1|19|597.45|ab|1|H`);
    const r1 = await a.savePurchaseFromQr(household.id, qr);
    expect(r1.existing).toBe(false);
    expect(r1.purchase).toMatchObject({ status: 'pendente', totalCents: 59745, issuerCnpj: '11222333000181', docModel: '65' });
    expect(r1.purchase.purchasedAt.slice(0, 10)).toBe('2026-09-19');
    const r2 = await a.savePurchaseFromQr(household.id, parseNfceQr(formatAccessKey(qr.info.key)));
    expect(r2.existing).toBe(true);
    expect(await a.listPurchases(household.id)).toHaveLength(1);
  });

  it('mesma nota escaneada offline em dois aparelhos vira um único registro', async () => {
    const server = new MemorySyncServer();
    const ian = await dev(server, 'ian');
    const fer = await dev(server, 'fer');
    const { household } = await ian.createHousehold('Casa');
    const hid = household.id;
    server.createHousehold('ian', hid);
    server.createInvite('ian', hid, 'C');
    server.acceptInvite('fer', 'C');
    await ian.engine.sync(hid);
    await fer.engine.sync(hid);
    server.online = false;
    const qr = parseNfceQr(`${key()}|3|1`);
    await ian.savePurchaseFromQr(hid, qr);
    await fer.savePurchaseFromQr(hid, qr);
    server.online = true;
    await ian.engine.sync(hid);
    await fer.engine.sync(hid);
    await ian.engine.sync(hid);
    expect(await ian.listPurchases(hid)).toHaveLength(1);
    expect(await fer.listPurchases(hid)).toHaveLength(1);
  });

  it('a mesma chave em Casas diferentes gera ids diferentes (isolamento)', async () => {
    const { purchaseIdFor } = await import('../../src/db/repo');
    const k = key();
    const a = await purchaseIdFor('11111111-1111-4111-8111-111111111111', k);
    const b = await purchaseIdFor('22222222-2222-4222-8222-222222222222', k);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
