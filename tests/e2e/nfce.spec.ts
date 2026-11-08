import { expect, test, type Page } from '@playwright/test';
import QRCode from 'qrcode';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mod11 } from '../../src/nfce/accessKey';

// Pasta sem acentos (o caminho padrão herda o nome do teste, com acentos).
const FIX = join('test-results', 'qr-fixtures');
mkdirSync(FIX, { recursive: true });
const fixture = (name: string) => join(FIX, `${Date.now()}-${name}`);

// Chave SINTÉTICA (não é nota real).
const k43 = '35' + '2609' + '11222333000181' + '65' + '006' + '000012345' + '9' + '12345678';
const KEY = k43 + mod11(k43);
const QR_TEXT = `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|2|1|19|597.45|6a6f|1|ABCDEF`;

async function openNotas(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar minha Casa' }).click();
  await page.getByLabel('Seu nome').fill('Ian');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: /Escanear NFC-e/ }).click();
  await expect(page.getByRole('heading', { name: 'Notas fiscais' })).toBeVisible();
}

test('lê o QR Code de uma foto, registra a nota e bloqueia duplicata', async ({ page }) => {
  await openNotas(page);
  const png = fixture('qr.png');
  await QRCode.toFile(png, QR_TEXT, { width: 600, margin: 6 });
  await page.getByTestId('qr-photo').setInputFiles(png);
  const card = page.getByTestId('scan-result');
  await expect(card).toContainText('11.222.333/0001-81');
  await expect(card).toContainText('19 set/2026');
  await expect(card).toContainText('597,45');
  await expect(page.getByRole('link', { name: /Abrir na SEFAZ/ })).toHaveAttribute('href', /nfce\.fazenda\.sp\.gov\.br/);
  await page.getByRole('button', { name: 'Registrar nota' }).click();
  await expect(page.getByTestId('purchase-list')).toContainText('itens pendentes');

  // Mesma nota pela chave digitada → aviso de duplicata
  await page.getByLabel('Chave de acesso').fill(KEY.replace(/(\d{4})/g, '$1 '));
  await page.getByRole('button', { name: 'Usar chave' }).click();
  await expect(page.getByTestId('dup-warning')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar nota' })).toHaveCount(0);
});

test('chave com dígito errado mostra erro claro', async ({ page }) => {
  await openNotas(page);
  await page.getByLabel('Chave de acesso').fill(KEY.slice(0, 43) + ((Number(KEY[43]) + 1) % 10));
  await page.getByRole('button', { name: 'Usar chave' }).click();
  await expect(page.getByRole('alert')).toContainText('dígito verificador');
});

test('foto sem QR Code orienta o usuário', async ({ page }) => {
  await openNotas(page);
  const png = fixture('blank.png');
  await page.screenshot({ path: png, clip: { x: 0, y: 0, width: 200, height: 200 } });
  await page.getByTestId('qr-photo').setInputFiles(png);
  await expect(page.getByRole('alert')).toContainText('Não encontrei um QR Code');
});

// Texto no formato da página da SEFAZ (nota anonimizada) + bloco do consumidor que deve ser ignorado.
const SEFAZ_TEXT = `MASSA ACRILICA 55KG SUVINIL (Código: 89580456 )
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
` + '\nChave de acesso\n' + KEY + '\nCPF: 000.000.000-00\nNome: FULANO DE TAL\n';

test('importa os itens da nota a partir do texto copiado da SEFAZ', async ({ page }) => {
  await openNotas(page);
  await page.getByLabel('Chave de acesso').fill(KEY);
  await page.getByRole('button', { name: 'Usar chave' }).click();
  await page.getByRole('button', { name: 'Registrar nota' }).click();
  await expect(page.getByTestId('purchase-list')).toContainText('itens pendentes');

  await page.getByRole('button', { name: 'Importar itens' }).click();
  await expect(page.getByTestId('import-panel')).toBeVisible();
  await page.getByLabel('Texto da nota').fill(SEFAZ_TEXT);
  await page.getByRole('button', { name: 'Ler texto' }).click();
  const preview = page.getByTestId('import-preview');
  await expect(preview).toContainText('8 itens');
  await expect(preview).toContainText('597,45');
  await expect(preview).toContainText('FOLHA LIXA MASSA G120 A230 ALCAR');
  await expect(preview).not.toContainText('FULANO');
  await page.getByRole('button', { name: 'Confirmar importação' }).click();

  const list = page.getByTestId('purchase-list');
  await expect(list).toContainText('importada');
  await expect(list).toContainText('597,45');
  await page.getByRole('button', { name: 'Ver itens' }).click();
  const items = page.getByTestId('purchase-items');
  await expect(items).toContainText('MASSA ACRILICA 55KG SUVINIL');
  await expect(items).toContainText('FITA CREPE BRANCA 48MMx50M TEKBOND');
  await expect(items).not.toContainText('FULANO');
});
