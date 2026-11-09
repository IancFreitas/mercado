import { expect, test, type Page } from '@playwright/test';
import { mod11 } from '../../src/nfce/accessKey';

// Chaves SINTÉTICAS (não são notas reais), com número diferente por nota.
function keyFor(n: number): string {
  const k43 = '35' + '2609' + '11222333000181' + '65' + '006' + String(n).padStart(9, '0') + '9' + '12345678';
  return k43 + mod11(k43);
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

function noteText(n: number, date: string): string {
  return `ARROZ TIPO 1 5KG (Código: 100001 )
Qtde.:2   UN: UN   Vl. Unit.:   25,5 \tVl. Total
51,00
Qtd. total de itens: 1
Valor total R$: 51,00
Valor a pagar R$: 51,00
Forma de pagamento: Valor pago R$:
Cartão de Crédito 51,00
Informações gerais da Nota
EMISSÃO NORMAL

Número: ${n} Série: 6 Emissão: ${date} 12:00:00 - Via Consumidor
Chave de acesso
${keyFor(n)}
`;
}

async function importNote(page: Page, n: number, date: string) {
  await page.goto('/#/notas');
  await page.getByLabel('Chave de acesso').fill(keyFor(n));
  await page.getByRole('button', { name: 'Usar chave' }).click();
  await page.getByRole('button', { name: 'Registrar nota' }).click();
  await page.getByRole('button', { name: 'Importar itens' }).first().click();
  await page.getByLabel('Texto da nota').fill(noteText(n, date));
  await page.getByRole('button', { name: 'Ler texto' }).click();
  await expect(page.getByTestId('import-preview')).toContainText('1 itens');
  await expect(page.getByLabel('Adicionar à despensa')).toBeChecked();
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByTestId('purchase-list')).toContainText(date);
}

test('duas notas do mesmo produto geram sugestão na lista; Adicionar não duplica', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar minha Casa' }).click();
  await page.getByLabel('Seu nome').fill('Ian');
  await page.getByRole('button', { name: 'Começar' }).click();

  await importNote(page, 12345, daysAgo(40));
  await importNote(page, 12346, daysAgo(22));

  await page.goto('/#/inicio');
  await expect(page.getByTestId('home-suggestion')).toContainText('Arroz Tipo 1 5KG');

  await page.goto('/#/lista');
  const row = page.getByTestId('suggestion-row').filter({ hasText: 'Arroz' });
  await expect(row).toContainText('Confiança baixa');
  await row.getByRole('button', { name: 'Por que sugeriu?' }).click();
  await expect(page.getByTestId('suggestion-why')).toContainText('Última compra em');

  await row.getByRole('button', { name: /^Adicionar Arroz/ }).click();
  const pending = page.getByTestId('pending-list');
  await expect(pending.getByText('Arroz Tipo 1 5KG', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('suggestion-row')).toHaveCount(0); // já está na lista: sem duplicar

  // Despensa mostra a previsão e o interruptor
  await page.goto('/#/despensa');
  await page.getByRole('button', { name: /Histórico de Arroz/ }).click();
  await expect(page.getByTestId('prediction-box')).toContainText('Prever reposição');
  await expect(page.getByTestId('prediction-text')).toContainText('Confiança baixa');
});

test('Adiar e Não sugerir mais escondem a sugestão; reativar na Despensa traz de volta', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar minha Casa' }).click();
  await page.getByLabel('Seu nome').fill('Ian');
  await page.getByRole('button', { name: 'Começar' }).click();
  await importNote(page, 22345, daysAgo(40));
  await importNote(page, 22346, daysAgo(22));

  await page.goto('/#/lista');
  await page.getByRole('button', { name: /^Adiar sugestão de Arroz/ }).click();
  await expect(page.getByTestId('suggestion-row')).toHaveCount(0);

  await page.goto('/#/despensa');
  await page.getByRole('button', { name: /Histórico de Arroz/ }).click();
  await expect(page.getByTestId('prediction-box')).toContainText('Sugestão adiada até');
  await page.getByLabel('Prever reposição').uncheck();
  await expect(page.getByTestId('prediction-box')).toContainText('Desligado');
  await page.getByLabel('Prever reposição').check();

  // reativar limpa o adiamento
  await page.goto('/#/lista');
  await expect(page.getByTestId('suggestion-row').filter({ hasText: 'Arroz' })).toBeVisible();
  await page.getByRole('button', { name: /^Não sugerir mais Arroz/ }).click();
  await expect(page.getByTestId('suggestion-row')).toHaveCount(0);
});
