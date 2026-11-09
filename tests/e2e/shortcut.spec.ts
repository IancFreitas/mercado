import { expect, test, type Page } from '@playwright/test';
import { mod11 } from '../../src/nfce/accessKey';

// Chave SINTÉTICA (não é nota real).
const k43 = '35' + '2609' + '11222333000181' + '65' + '006' + '000012345' + '9' + '12345678';
const KEY = k43 + mod11(k43);
const QR_TEXT = `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|2|1|19|597.45|6a6f|1|ABCDEF`;
const link = (qr: string) => `/#/notas?qr=${encodeURIComponent(qr)}&colar=1`;

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


async function onboard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar minha Casa' }).click();
  await page.getByLabel('Seu nome').fill('Ian');
  await page.getByRole('button', { name: 'Começar' }).click();
}

async function importViaShortcut(page: Page) {
  await page.goto(link(QR_TEXT));
  await expect(page.getByTestId('shortcut-confirm')).toContainText('11.222.333/0001-81');
  await expect(page.getByTestId('shortcut-confirm')).toContainText('set/2026');
  await page.getByRole('button', { name: 'Registrar nota' }).click();
  await expect(page.getByTestId('import-panel')).toBeVisible();
  await page.getByLabel('Texto da nota').fill(SEFAZ_TEXT);
  await page.getByRole('button', { name: 'Ler texto' }).click();
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByTestId('purchase-list')).toContainText('importada');
}

test('Atalho: deep link confirma, registra e abre o painel de importação com Colar em destaque', async ({ page }) => {
  await onboard(page);
  await page.goto(link(QR_TEXT));
  // Nada gravado sem toque.
  await expect(page.getByTestId('shortcut-confirm')).toBeVisible();
  await expect(page.getByTestId('purchase-list')).toHaveCount(0);
  await page.getByRole('button', { name: 'Registrar nota' }).click();
  await expect(page.getByTestId('import-panel')).toBeVisible();
  await expect(page.getByTestId('paste-btn')).toHaveClass(/btn-primary/);
  await page.getByLabel('Texto da nota').fill(SEFAZ_TEXT);
  await page.getByRole('button', { name: 'Ler texto' }).click();
  await expect(page.getByTestId('import-preview')).toContainText('8 itens');
  await expect(page.getByTestId('import-preview')).not.toContainText('FULANO');
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByTestId('purchase-list')).toContainText('importada');
});

test('Atalho: link fora de gov.br é recusado e cancelar não grava', async ({ page }) => {
  await onboard(page);
  await page.goto(link(QR_TEXT.replace('nfce.fazenda.sp.gov.br', 'evil.example.com')));
  await expect(page.getByRole('alert')).toContainText('gov.br');
  await expect(page.getByTestId('shortcut-confirm')).toHaveCount(0);
  await page.goto(link(QR_TEXT));
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByTestId('purchase-list')).toHaveCount(0);
});

test('nome da loja aparece em Notas e na Lista', async ({ page }) => {
  await onboard(page);
  await importViaShortcut(page);
  await page.getByRole('button', { name: 'Nome da loja' }).click();
  await page.getByLabel('Nome da loja', { exact: true }).fill('Casa das Tintas');
  await page.getByRole('button', { name: 'Salvar nome' }).click();
  const row = page.getByTestId('purchase-row');
  await expect(row).toContainText('Casa das Tintas');
  await expect(row).toContainText('11.222.333/0001-81');

  await page.goto('/#/lista');
  await page.getByLabel('Nome do item').fill('Fita crepe');
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByRole('button', { name: /Fita crepe/ }).first().click();
  await expect(page.getByTestId('price-block')).toContainText('Casa das Tintas (11.222.333/0001-81)');
});

test('Modo compras: registrar e limpar o preço encontrado', async ({ page }) => {
  await onboard(page);
  await page.goto('/#/lista');
  await page.getByLabel('Nome do item').fill('Leite');
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.goto('/#/compras');
  const input = page.getByLabel('Preço encontrado de Leite');
  await input.fill('5,49');
  await input.blur();
  await expect(page.getByTestId('total-all')).toContainText('5,49');
  await page.getByRole('button', { name: 'Limpar preço de Leite' }).click();
  await expect(input).toHaveValue('');
  await expect(page.getByTestId('total-all')).toContainText('0,00');
  // Campo vazio também limpa.
  await input.fill('3,00');
  await input.blur();
  await expect(page.getByTestId('total-all')).toContainText('3,00');
  await input.fill('');
  await input.blur();
  await expect(page.getByTestId('total-all')).toContainText('0,00');
});
