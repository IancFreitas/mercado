/** Selo no ícone do app (Badging API). Silencioso se a API não existir ou falhar. */
type BadgeNav = { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

export async function updateAppBadge(count: number, nav: BadgeNav | undefined = typeof navigator === 'undefined' ? undefined : (navigator as BadgeNav)): Promise<boolean> {
  try {
    if (!nav) return false;
    if (count > 0 && typeof nav.setAppBadge === 'function') {
      await nav.setAppBadge(count);
      return true;
    }
    if (typeof nav.clearAppBadge === 'function') {
      await nav.clearAppBadge();
      return true;
    }
    if (count <= 0 && typeof nav.setAppBadge === 'function') {
      await nav.setAppBadge(0);
      return true;
    }
  } catch {
    /* sem permissão/suporte: ignora */
  }
  return false;
}
