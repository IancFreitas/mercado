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
