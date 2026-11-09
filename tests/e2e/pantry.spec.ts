import { expect, test, type Page } from '@playwright/test';
import { mod11 } from '../../src/nfce/accessKey';

// Chave SINTÉTICA (não é nota real) e texto anonimizado.
const k43 = '35' + '2609' + '11222333000181' + '65' + '006' + '000012345' + '9' + '12345678';
const KEY = k43 + mod11(k43);

const TEXT = `ARROZ TIPO 1 5KG (Código: 100001 )
Qtde.:2   UN: UN   Vl. Unit.:   25,5 \tVl. Total
51,00
DETERGENTE NEUTRO 500ML (Código: 100002 )
Qtde.:3   UN: UN   Vl. Unit.:   2,5 \tVl. Total
7,50
Qtd. total de itens: 2
Valor total R$: 58,50
Valor a pagar R$: 58,50
Forma de pagamento: Valor pago R$:
Cartão de Crédito 58,50
Informações gerais da Nota
EMISSÃO NORMAL

Número: 12345 Série: 6 Emissão: 19/09/2026 18:15:34 - Via Consumidor
` + '\nChave de acesso\n' + KEY + '\n';

async function importNota(page: Page, toPantry = true) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar minha Casa' }).click();
  await page.getByLabel('Seu nome').fill('Ian');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByRole('button', { name: /Escanear NFC-e/ }).click();
  await page.getByLabel('Chave de acesso').fill(KEY);
  await page.getByRole('button', { name: 'Usar chave' }).click();
  await page.getByRole('button', { name: 'Registrar nota' }).click();
  await page.getByRole('button', { name: 'Importar itens' }).click();
  await page.getByLabel('Texto da nota').fill(TEXT);
  await page.getByRole('button', { name: 'Ler texto' }).click();
  await expect(page.getByTestId('import-preview')).toContainText('2 itens');
  const check = page.getByLabel('Adicionar à despensa');
  await expect(check).toBeChecked();
  if (!toPantry) await check.uncheck();
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByTestId('purchase-list')).toContainText('importada');
}

test('importa a nota para a despensa, marca "Acabou", põe na lista e vê os gastos', async ({ page }) => {
  await importNota(page);

  await page.goto('/#/despensa');
  const list = page.getByTestId('pantry-list');
  await expect(list).toContainText('Arroz Tipo 1 5KG');
  await expect(list).toContainText('Detergente Neutro 500ML');
  await expect(list.getByTestId('pantry-row').filter({ hasText: 'Arroz' })).toContainText('2×');
  await expect(list).toContainText('última compra 19/09/2026');

  // Usei 1 e histórico
  await page.getByRole('button', { name: 'Usei 1 de Arroz Tipo 1 5KG' }).click();
  await expect(list.getByTestId('pantry-row').filter({ hasText: 'Arroz' })).toContainText('1×');
  await page.getByRole('button', { name: 'Histórico de Arroz Tipo 1 5KG' }).click();
  await expect(page.getByTestId('pantry-history')).toContainText('Consumo');
  await expect(page.getByTestId('pantry-history')).toContainText('Compra');

  // Acabou -> seção "Acabou" -> Pôr na lista
  await page.getByRole('button', { name: 'Detergente Neutro 500ML acabou' }).click();
  const out = page.getByTestId('pantry-out');
  await expect(out).toContainText('Detergente Neutro 500ML');
  await expect(list).not.toContainText('Detergente');
  await page.getByRole('button', { name: 'Pôr Detergente Neutro 500ML na lista' }).click();
  await page.getByRole('button', { name: 'Pôr Detergente Neutro 500ML na lista' }).click(); // 2º clique não duplica

  await page.goto('/#/lista');
  const pending = page.getByTestId('pending-list');
  await expect(pending.getByText('Detergente Neutro 500ML', { exact: true })).toHaveCount(1);
  await expect(pending).not.toContainText('2×');

  // Início mostra cartões reais
  await page.goto('/#/inicio');
  await expect(page.getByTestId('home-pantry-count')).toHaveText('1');
  await expect(page.getByTestId('home-recent')).toContainText('58,50');

  // Gastos do mês da nota (setembro/2026)
  await page.goto('/#/gastos');
  await page.getByLabel('Mês').selectOption('2026-09');
  await expect(page.getByTestId('spend-total')).toContainText('58,50');
  await expect(page.getByTestId('spend-store')).toContainText('11.222.333/0001-81');
  await expect(page.getByTestId('spend-purchase')).toContainText('19/09/2026');
  await expect(page.getByTestId('spend-category').first()).toContainText('Outros');
});

test('adicionar produto manual e editar quantidade gera ajuste', async ({ page }) => {
  await importNota(page, false);
  await page.goto('/#/despensa');
  await expect(page.getByTestId('pantry-empty')).toBeVisible(); // desmarcado: nada entrou

  // Nota já importada: botão idempotente
  await page.goto('/#/notas');
  await page.getByRole('button', { name: 'Adicionar à despensa' }).click();
  await page.getByRole('button', { name: 'Adicionar à despensa' }).click();
  await page.goto('/#/despensa');
  await expect(page.getByTestId('pantry-list').getByTestId('pantry-row')).toHaveCount(2);
  await expect(page.getByTestId('pantry-list').getByTestId('pantry-row').filter({ hasText: 'Arroz' })).toContainText('2×');

  await page.getByRole('button', { name: 'Adicionar produto' }).click();
  await page.getByLabel('Nome do produto').fill('Banana');
  await page.getByLabel('Quantidade em estoque').fill('1,5');
  await page.getByLabel('Unidade').selectOption('kg');
  await page.getByLabel('Categoria').selectOption('Hortifruti');
  await page.getByRole('button', { name: 'Salvar produto' }).click();
  const banana = page.getByTestId('pantry-row').filter({ hasText: 'Banana' });
  await expect(banana).toContainText('1,5 kg');

  await page.getByRole('button', { name: 'Editar Banana' }).click();
  await page.getByTestId('pantry-edit').getByLabel('Quantidade', { exact: true }).fill('0,75');
  await page.getByTestId('pantry-edit').getByRole('button', { name: 'Salvar' }).click();
  await expect(banana).toContainText('0,75 kg');
  await page.getByRole('button', { name: 'Histórico de Banana' }).click();
  await expect(page.getByTestId('pantry-history')).toContainText('Ajuste');
});
