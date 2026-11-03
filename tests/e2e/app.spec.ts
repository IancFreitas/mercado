import { expect, test, type Page } from '@playwright/test';

async function createHouse(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar minha Casa' }).click();
  await page.getByLabel('Seu nome').fill('Ian');
  await page.getByLabel('Nome da Casa').fill('Casa Teste');
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(page.getByRole('heading', { name: 'Casa Teste' })).toBeVisible();
}

async function addItem(page: Page, name: string) {
  await page.getByLabel('Nome do item').fill(name);
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(page.getByTestId('pending-list').getByText(name, { exact: true })).toBeVisible();
}

test('onboarding individual, lista e persistência local', async ({ page }) => {
  await createHouse(page);
  await expect(page.getByTestId('sync-badge')).toHaveText(/Só neste aparelho/);
  await page.getByRole('button', { name: 'Lista' }).first().click();
  await addItem(page, 'Leite');
  await addItem(page, 'Pão');
  // Duplicado soma quantidade
  await page.getByLabel('Nome do item').fill('leite');
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(page.getByTestId('pending-list').getByText(/2×/)).toBeVisible();
  // Marcar item
  await page.getByRole('checkbox', { name: 'Marcar Pão' }).click();
  await expect(page.getByTestId('cart-list').getByText('Pão')).toBeVisible();
  // Recarregar: dados persistem
  await page.reload();
  await expect(page.getByTestId('pending-list').getByText('Leite')).toBeVisible();
  await expect(page.getByTestId('cart-list').getByText('Pão')).toBeVisible();
});

test('funciona offline após primeira visita (service worker)', async ({ page, context }) => {
  await createHouse(page);
  await page.waitForFunction(async () => !!(await navigator.serviceWorker?.ready)?.active);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Casa Teste' })).toBeVisible();
  await expect(page.getByText(/Você está offline/)).toBeVisible();
  await page.getByRole('button', { name: 'Lista' }).first().click();
  await addItem(page, 'Arroz');
  await context.setOffline(false);
});

test('deep link de Atalhos adiciona item (#/lista?add=)', async ({ page }) => {
  await createHouse(page);
  await page.goto('/#/lista?add=Caf%C3%A9&qtd=2');
  await page.getByTestId('deeplink-confirm').getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByTestId('pending-list').getByText('Café')).toBeVisible();
  await expect(page.getByTestId('pending-list').getByText(/2×/)).toBeVisible();
  await expect(page).toHaveURL(/#\/lista$/);
  // Sem confirmação, nada é gravado (QA-15)
  await page.goto('/#/lista?add=Intruso');
  await page.getByTestId('deeplink-confirm').getByRole('button', { name: 'Ignorar' }).click();
  await expect(page.getByText('Intruso')).toHaveCount(0);
});

test('backup: exportar e restaurar em outro "aparelho"', async ({ page, browser }) => {
  await createHouse(page);
  await page.getByRole('button', { name: 'Lista' }).first().click();
  await addItem(page, 'Feijão');
  await page.getByRole('button', { name: 'Casa' }).last().click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar backup' }).click();
  const path = await (await dl).path();
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto('/');
  await p2.locator('input[type=file]').setInputFiles(path!);
  await expect(p2.getByRole('heading', { name: 'Casa Teste' })).toBeVisible();
  await p2.getByRole('button', { name: 'Lista' }).first().click();
  await expect(p2.getByTestId('pending-list').getByText('Feijão')).toBeVisible();
  await ctx2.close();
});

test('manifest PWA e CSP presentes', async ({ page, request }) => {
  await page.goto('/');
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m.display).toBe('standalone');
  expect(m.icons.length).toBeGreaterThan(0);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});
