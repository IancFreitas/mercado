import { describe, expect, it } from 'vitest';
import { mod11 } from '../../src/nfce/accessKey';
import { parseSefazText, SefazTextError } from '../../src/nfce/parseSefazText';
import { parseNfceQr } from '../../src/nfce/qrcode';

/** Texto no formato da página da SEFAZ-SP (nota ANONIMIZADA: número 12345, série 6, protocolo zerado). */
const FIXTURE = `MASSA ACRILICA 55KG SUVINIL (Código: 89580456 )
Qtde.:1   UN: UN   Vl. Unit.:   71,9 \tVl. Total
71,90
PLASTICO BOLHA 130X50M (Código: 89535544 )
Qtde.:1   UN: UN   Vl. Unit.:   74,9 \tVl. Total
74,90
TINTA STD ACR FSC RD E COBRE BR 20L SV (Código: 89467231 )
Qtde.:1   UN: UN   Vl. Unit.:   379,9 \tVl. Total
379,90
TRINCHA SIMPLES PPAREDE 2 COMPEL (Código: 89780250 )
Qtde.:1   UN: UN   Vl. Unit.:   5,39 \tVl. Total
5,39
SACOLA PLASTICA CINZA 60X70 (Código: 89723466 )
Qtde.:1   UN: UN   Vl. Unit.:   0,25 \tVl. Total
0,25
FOLHA LIXA MASSA G120 A230 ALCAR (Código: 89719511 )
Qtde.:11   UN: UN   Vl. Unit.:   0,7 \tVl. Total
7,70
ROLO LA SINT ANTIR S SUP 1374 23CM TIGR (Código: 89169402 )
Qtde.:1   UN: UN   Vl. Unit.:   19,9 \tVl. Total
19,90
FITA CREPE BRANCA 48MMx50M TEKBOND (Código: 89641405 )
Qtde.:2   UN: UN   Vl. Unit.:   12,9 \tVl. Total
25,80
Qtd. total de itens: 8
Valor total R$: 585,74
Outras despesas R$: 11,71
Valor a pagar R$: 597,45
Forma de pagamento: Valor pago R$:
Cartão de Crédito 597,45
Troco NaN
Informação dos Tributos Totais Incidentes (Lei Federal 12.741/2012) R$
192,15
Informações gerais da Nota
EMISSÃO NORMAL

Número: 12345 Série: 6 Emissão: 19/09/2026 18:15:34 - Via Consumidor

Protocolo de Autorização: 00000000000000000 19/09/2026 18:15:35

Ambiente de Produção - Versão XML: 4.00 - Versão XSLT: 2.05
`;

const CONSUMER = `
Chave de acesso
3526 0911 2223 3300 0181 6500 6000 0123 4591 2345 6780
Consumidor
CPF: 000.000.000-00
Nome: FULANO DE TAL
Endereço: RUA DOS TESTES 1
`;

describe('parseSefazText — fixture anonimizada', () => {
  const r = parseSefazText(FIXTURE);
  it('lê 8 itens e os totais', () => {
    expect(r.items).toHaveLength(8);
    expect(r.totals).toEqual({ itemsCount: 8, totalCents: 58574, discountCents: 0, otherCents: 1171, payableCents: 59745 });
    expect(r.payment).toEqual({ method: 'Cartão de Crédito', amountCents: 59745 });
    expect(r.consistent).toBe(true);
    expect(r.warnings).toEqual([]);
  });
  it('FOLHA LIXA: 11 × 0,70 = 7,70', () => {
    const i = r.items.find((x) => x.description.startsWith('FOLHA LIXA'))!;
    expect(i).toMatchObject({ quantity: 11, unit: 'un', unitPriceCents: 70, totalCents: 770, code: '89719511' });
    expect(i.description).toBe('FOLHA LIXA MASSA G120 A230 ALCAR');
  });
  it('cabeçalho', () => {
    expect(r).toMatchObject({ number: 12345, series: 6, environment: 1, emittedAt: '2026-09-19T21:15:34.000Z' });
  });
  it('aceita \\r\\n e linhas em branco extras', () => {
    const crlf = parseSefazText(FIXTURE.replace(/\n/g, '\r\n\r\n'));
    expect(crlf.items).toHaveLength(8);
    expect(crlf.consistent).toBe(true);
  });
});

describe('parseSefazText — variantes', () => {
  it('quantidade fracionária em KG', () => {
    const r = parseSefazText(`BANANA PRATA (Código: 12 )
Qtde.:0,345   UN: KG   Vl. Unit.:   7,99 \tVl. Total
2,76
Qtd. total de itens: 1
Valor total R$: 2,76
Valor a pagar R$: 2,76`);
    expect(r.items[0]).toMatchObject({ quantity: 0.345, unit: 'kg', unitPriceCents: 799, totalCents: 276 });
    expect(r.consistent).toBe(true);
  });
  it('desconto', () => {
    const r = parseSefazText(`ARROZ 5KG (Código: 1 )
Qtde.:2   UN: PCT   Vl. Unit.:   20,00 \tVl. Total
40,00
Qtd. total de itens: 1
Valor total R$: 40,00
Descontos R$: 5,00
Valor a pagar R$: 35,00
Forma de pagamento: Valor pago R$:
Dinheiro 35,00`);
    expect(r.items[0]!.unit).toBe('pct');
    expect(r.totals).toMatchObject({ discountCents: 500, otherCents: 0, payableCents: 3500 });
    expect(r.payment).toEqual({ method: 'Dinheiro', amountCents: 3500 });
    expect(r.consistent).toBe(true);
  });
  it('total na mesma linha do "Vl. Total", sem código, unidade desconhecida', () => {
    const r = parseSefazText(`PRODUTO SEM CODIGO
Qtde.:3   UN: XYZ   Vl. Unit.:   1,50 \tVl. Total 4,50
Qtd. total de itens: 1
Valor total R$: 4,50
Valor a pagar R$: 4,50`);
    expect(r.items[0]).toMatchObject({ description: 'PRODUTO SEM CODIGO', unit: 'un', rawUnit: 'XYZ', totalCents: 450 });
    expect(r.items[0]!.code).toBeUndefined();
    expect(r.consistent).toBe(true);
  });
  it('separador de milhar', () => {
    const r = parseSefazText(`TV (Código: 9 )
Qtde.:1   UN: UN   Vl. Unit.:   1.299,90 \tVl. Total
1.299,90
Valor total R$: 1.299,90`);
    expect(r.items[0]!.totalCents).toBe(129990);
  });
  it('não usa nada depois de "Chave de acesso" (CPF/nome do consumidor)', () => {
    const r = parseSefazText(FIXTURE + CONSUMER);
    const json = JSON.stringify(r);
    expect(json).not.toContain('FULANO');
    expect(json).not.toContain('000.000.000-00');
    expect(json).not.toContain('TESTES');
    expect(r.items).toHaveLength(8);
    expect(r.consistent).toBe(true);
  });
  it('corta na chave de acesso mesmo sem acento/caixa e no meio de uma linha', () => {
    const r = parseSefazText(FIXTURE.trimEnd() + ' CHAVE   DE ACESSO 3526 Nome: FULANO');
    expect(JSON.stringify(r)).not.toContain('FULANO');
  });
  it('sem itens → erro amigável', () => {
    expect(() => parseSefazText('Qtd. total de itens: 3\nValor total R$: 10,00')).toThrow(/Não encontrei itens no texto colado/);
    expect(() => parseSefazText('')).toThrow(SefazTextError);
    // itens só depois da chave não valem
    expect(() => parseSefazText('Chave de acesso\n' + FIXTURE)).toThrow(/Não encontrei itens/);
    // consumidor (e chave) antes dos itens: falha segura, sem vazar dados
    expect(() => parseSefazText(CONSUMER + FIXTURE)).toThrow(/Não encontrei itens/);
  });
  it('recusa texto acima de 200 KB', () => {
    expect(() => parseSefazText('x'.repeat(200 * 1024 + 1))).toThrow(/200 KB/);
  });
  it('soma que não bate → warning e consistent=false (sem lançar)', () => {
    const r = parseSefazText(FIXTURE.replace('Valor total R$: 585,74', 'Valor total R$: 600,00'));
    expect(r.consistent).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/soma dos itens/);
  });
  it('item faltando na cópia → contagem diverge', () => {
    const cut = FIXTURE.replace(/MASSA ACRILICA[\s\S]*?71,90\n/, '');
    const r = parseSefazText(cut);
    expect(r.items).toHaveLength(7);
    expect(r.consistent).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/informa 8 itens/);
  });
  it('quantidade × unitário diferente do total → warning', () => {
    const r = parseSefazText(FIXTURE.replace('Vl. Unit.:   0,7 \tVl. Total\n7,70', 'Vl. Unit.:   0,8 \tVl. Total\n7,70'));
    expect(r.consistent).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/FOLHA LIXA.*difere do total/);
  });
});

describe('parseSefazText — limites', () => {
  const base = (extra: string, qty = '1', unit = 'UN', price = '1,00', tot = '1,00') => `PROD ${extra}
Qtde.:${qty}   UN: ${unit}   Vl. Unit.:   ${price} \tVl. Total
${tot}
Valor total R$: ${tot}`;
  it('trunca código, unidade desconhecida e forma de pagamento', () => {
    const r = parseSefazText(base('(Código: ' + '9'.repeat(5000) + ' )', '1', 'X'.repeat(500)) + '\nForma de pagamento: Valor pago R$:\n' + 'Cartão '.repeat(3000) + ' 1,00');
    expect(r.items[0]!.code!.length).toBeLessThanOrEqual(40);
    expect(r.items[0]!.rawUnit!.length).toBeLessThanOrEqual(10);
    expect(r.payment!.method.length).toBeLessThanOrEqual(60);
  });
  it('valores gigantes são ignorados com aviso (nunca importados)', () => {
    expect(() => parseSefazText(base('', '99999999999', 'UN', '99999999999', '99999999999'))).toThrow(/Não encontrei itens/);
    const r = parseSefazText(base('') + '\n' + base('', '99999999999', 'UN', '99999999999', '99999999999'));
    expect(r.items).toHaveLength(1);
    expect(r.consistent).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/fora do limite/);
  });
  it('"ChavedeAcesso" (sem espaços) também corta', () => {
    expect(JSON.stringify(parseSefazText(FIXTURE + 'ChavedeAcesso Nome: FULANO'))).not.toContain('FULANO');
  });
});

describe('importPurchaseItems (repo)', async () => {
  const { PantryDB } = await import('../../src/db/db');
  const { PantryRepo } = await import('../../src/db/repo');
  const { SyncEngine } = await import('../../src/sync/engine');
  const { MemorySyncServer } = await import('../../src/sync/memoryServer');
  let n = 0;
  async function dev(server: InstanceType<typeof MemorySyncServer>, user: string) {
    const engine = await SyncEngine.create(new PantryDB(`nfce-imp-${++n}`), `devI${n}`, { transport: server.transportFor(user) });
    return new PantryRepo(engine, () => user);
  }
  const k43 = '35' + '2609' + '11222333000181' + '65' + '006' + '000012345' + '1' + '12345678';
  const KEY = k43 + mod11(k43);
  const k43b = '35' + '2609' + '11222333000181' + '65' + '006' + '000099999' + '1' + '12345678';
  const KEY_B = k43b + mod11(k43b);

  it('importação ok: itens gravados e compra atualizada', async () => {
    const a = await dev(new MemorySyncServer(), 'ian');
    const { household } = await a.createHousehold('Casa');
    const { purchase } = await a.savePurchaseFromQr(household.id, parseNfceQr(KEY));
    const done = await a.importPurchaseItems(household.id, purchase.id, parseSefazText(FIXTURE));
    expect(done).toMatchObject({ status: 'importada', totalCents: 59745, paymentMethod: 'Cartão de Crédito', itemsCount: 8, otherCents: 1171, discountCents: 0 });
    expect(done.purchasedAt).toBe('2026-09-19T21:15:34.000Z');
    const items = await a.listPurchaseItems(household.id, purchase.id);
    expect(items).toHaveLength(8);
    expect(items[0]!.rawDescription).toBe('MASSA ACRILICA 55KG SUVINIL');
    expect(items[5]).toMatchObject({ quantity: 11, unitPriceCents: 70, totalCents: 770 });
  });

  it('texto de outra nota é recusado e nada é gravado', async () => {
    const a = await dev(new MemorySyncServer(), 'ian');
    const { household } = await a.createHousehold('Casa');
    const { purchase } = await a.savePurchaseFromQr(household.id, parseNfceQr(KEY_B));
    await expect(a.importPurchaseItems(household.id, purchase.id, parseSefazText(FIXTURE))).rejects.toThrow(/outra nota/);
    expect(await a.listPurchaseItems(household.id, purchase.id)).toHaveLength(0);
    expect((await a.listPurchases(household.id))[0]!.status).toBe('pendente');
  });

  it('reimportar é recusado', async () => {
    const a = await dev(new MemorySyncServer(), 'ian');
    const { household } = await a.createHousehold('Casa');
    const { purchase } = await a.savePurchaseFromQr(household.id, parseNfceQr(KEY));
    const parsed = parseSefazText(FIXTURE);
    await a.importPurchaseItems(household.id, purchase.id, parsed);
    await expect(a.importPurchaseItems(household.id, purchase.id, parsed)).rejects.toThrow(/já foram importados/);
    expect(await a.listPurchaseItems(household.id, purchase.id)).toHaveLength(8);
  });

  it('dois aparelhos importando o mesmo texto não duplicam itens após sync', async () => {
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
    const { purchase } = await ian.savePurchaseFromQr(hid, parseNfceQr(KEY));
    await ian.engine.sync(hid);
    await fer.engine.sync(hid);
    server.online = false;
    const parsed = parseSefazText(FIXTURE);
    await ian.importPurchaseItems(hid, purchase.id, parsed);
    await fer.importPurchaseItems(hid, purchase.id, parsed);
    server.online = true;
    await ian.engine.sync(hid);
    await fer.engine.sync(hid);
    await ian.engine.sync(hid);
    for (const d of [ian, fer]) {
      expect(await d.listPurchaseItems(hid, purchase.id)).toHaveLength(8);
      expect((await d.listPurchases(hid))[0]).toMatchObject({ status: 'importada', totalCents: 59745 });
    }
  });

  it('reimportar com texto menor após falha parcial apaga itens órfãos', async () => {
    const a = await dev(new MemorySyncServer(), 'ian');
    const { household } = await a.createHousehold('Casa');
    const hid = household.id;
    const { purchase } = await a.savePurchaseFromQr(hid, parseNfceQr(KEY));
    const { purchaseItemIdFor } = await import('../../src/db/repo');
    // simula tentativa anterior que gravou 10 itens e caiu antes de marcar a nota
    for (let i = 0; i < 10; i++) {
      await a.engine.mutate(hid, 'purchaseItems', await purchaseItemIdFor(hid, purchase.id, i), {
        purchaseId: purchase.id, rawDescription: `VELHO ${i}`, quantity: 1, unit: 'un', unitPriceCents: 1, totalCents: 1, position: i, deleted: false,
      });
    }
    await a.importPurchaseItems(hid, purchase.id, parseSefazText(FIXTURE));
    const items = await a.listPurchaseItems(hid, purchase.id);
    expect(items).toHaveLength(8);
    expect(items.some((i) => i.rawDescription.startsWith('VELHO 8'))).toBe(false);
    expect(items[0]!.rawDescription).toBe('MASSA ACRILICA 55KG SUVINIL');
  });

  it('dados fora do limite viram erro amigável e a nota segue pendente', async () => {
    const a = await dev(new MemorySyncServer(), 'ian');
    const { household } = await a.createHousehold('Casa');
    const { purchase } = await a.savePurchaseFromQr(household.id, parseNfceQr(KEY));
    const parsed = parseSefazText(FIXTURE);
    parsed.items[0]!.totalCents = 9e15;
    await expect(a.importPurchaseItems(household.id, purchase.id, parsed)).rejects.toThrow(/fora do limite/);
    expect((await a.listPurchases(household.id))[0]!.status).toBe('pendente');
  });
});

describe('parseSefazText — página inteira (Selecionar Tudo)', () => {
  const PAGE = `Consulta Pública - NFC-e
Secretaria da Fazenda
MERCADO EXEMPLO LTDA
CNPJ: 11.222.333/0001-81
RUA FICTICIA 1, CENTRO, SAO PAULO
Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica
ARROZ 5KG (Código: 1 )
Qtde.:2   UN: UN   Vl. Unit.:   20,00 \tVl. Total
40,00
FEIJAO 1KG (Código: 2 )
Qtde.:1   UN: UN   Vl. Unit.:   8,50 \tVl. Total
8,50
Qtd. total de itens: 2
Valor total R$: 48,50
Valor a pagar R$: 48,50
Forma de pagamento: Valor pago R$:
Dinheiro 48,50
Número: 12345 Série: 6 Emissão: 19/09/2026 18:15:34 - Via Consumidor
Chave de acesso:
3526 0911 2223 3300 0181 6500 6000 0123 4591 2345 6780
Consumidor
CPF: 000.000.000-00 Nome: FULANO DE TAL
Endereço: RUA FICTICIA 1
Voltar  Imprimir
`;
  it('lê só itens e totais, captura o CNPJ e ignora dados do consumidor', () => {
    const r = parseSefazText(PAGE);
    expect(r.items).toHaveLength(2);
    expect(r.consistent).toBe(true);
    expect(r.issuerCnpj).toBe('11222333000181');
    const json = JSON.stringify(r);
    expect(json).not.toContain('FULANO');
    expect(json).not.toContain('000.000.000-00');
    expect(json).not.toContain('RUA FICTICIA');
  });
});
