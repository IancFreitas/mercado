import { expect, test, type Page } from '@playwright/test';
import { mod11 } from '../../src/nfce/accessKey';

// Chave SINTÉTICA (não é nota real).
const k43 = '35' + '2609' + '11222333000181' + '65' + '006' + '000012345' + '9' + '12345678';
const KEY = k43 + mod11(k43);

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

async function importNota(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar minha Casa' }).click();
  await page.getByLabel('Seu nome').fill('Ian');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: /Escanear NFC-e/ }).click();
  await expect(page.getByRole('heading', { name: 'Notas fiscais' })).toBeVisible();
  await page.getByLabel('Chave de acesso').fill(KEY);
  await page.getByRole('button', { name: 'Usar chave' }).click();
  await page.getByRole('button', { name: 'Registrar nota' }).click();
  await page.getByRole('button', { name: 'Importar itens' }).click();
  await page.getByLabel('Texto da nota').fill(SEFAZ_TEXT);
  await page.getByRole('button', { name: 'Ler texto' }).click();
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByTestId('purchase-list')).toContainText('importada');
}

async function addToList(page: Page, name: string) {
  await page.getByLabel('Nome do item').fill(name);
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
}

test('lista mostra R$/kg para embalagem reconhecida e nada para medidas', async ({ page }) => {
  await importNota(page);
  await page.goto('/#/lista');
  await addToList(page, 'Massa acrílica');
  await expect(page.getByTestId('item-row').filter({ hasText: 'Massa' }).getByTestId('price-line')).toContainText('R$ 1,31/kg');
  await addToList(page, 'Fita crepe');
  await expect(page.getByTestId('item-row').filter({ hasText: 'Fita crepe' }).getByTestId('price-line')).not.toContainText('/kg');
});

test('modo compras: alerta de preço acima, carrinho, total e conferência com a nota', async ({ page }) => {
  await importNota(page);
  await page.goto('/#/lista');
  await addToList(page, 'Fita crepe');
  await page.getByRole('button', { name: /Modo compras/ }).click();
  await expect(page.getByRole('heading', { name: 'Modo compras' })).toBeVisible();
  await expect(page.getByTestId('shop-history')).toContainText('R$ 12,90');
  // sem preço encontrado: total usa o último preço pago
  await expect(page.getByTestId('total-all')).toContainText('12,90');

  await page.getByLabel('Preço encontrado de Fita crepe').fill('15,90');
  await page.getByLabel('Preço encontrado de Fita crepe').blur();
  await expect(page.getByTestId('shop-compare')).toContainText('acima do preço médio (+23%)');
  await expect(page.getByTestId('total-pending')).toContainText('15,90');

  await page.getByRole('button', { name: /Pôr no carrinho: Fita crepe/ }).click();
  await expect(page.getByTestId('shop-cart')).toContainText('Fita crepe');
  await expect(page.getByTestId('total-cart')).toContainText('15,90');
  await expect(page.getByTestId('total-pending')).toContainText('0,00');

  // Reconciliação em Notas
  await page.goto('/#/notas');
  await page.getByRole('button', { name: 'Conferir com a lista' }).click();
  const panel = page.getByTestId('reconcile-panel');
  await expect(panel).toContainText('Encontrado R$ 15,90');
  await expect(panel).toContainText('Pago R$ 12,90');
  await expect(panel).toContainText('pagou R$ 3,00 a menos');
  await panel.getByRole('button', { name: 'Limpar comprados' }).click();
  await page.goto('/#/lista');
  await expect(page.getByText('Lista vazia')).toBeVisible();
});

test('modo compras abre pela Início e funciona sem preço', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar minha Casa' }).click();
  await page.getByLabel('Seu nome').fill('Ian');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: /Lista/ }).first().click();
  await addToList(page, 'Leite');
  await page.goto('/#/');
  await page.getByRole('button', { name: /Modo compras/ }).click();
  await expect(page.getByTestId('shop-history')).toHaveCount(0);
  await expect(page.getByTestId('total-missing')).toContainText('1 item(ns) sem preço');
  await page.getByRole('button', { name: /Pôr no carrinho: Leite/ }).click();
  await expect(page.getByTestId('shop-cart')).toContainText('Leite');
});
