import { test, expect } from '@playwright/test';

for (const language of ['ko', 'en']) {
  test(`new document menu routes Markdown and Text commands (${language})`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).hostCommands = [];
      (window as any).chrome = { webview: {
        addEventListener() {},
        postMessage(packet: any) { if (packet.type === 'command') (window as any).hostCommands.push(packet.name); },
      } };
    });
    await page.goto(`/?native=1&lang=${language}`);
    await page.waitForFunction(() => !!(window as any).folio);
    const commands = () => page.evaluate(() => (window as any).hostCommands);
    const trigger = page.locator('#host-new');
    const menu = page.locator('#host-new-menu');
    const markdown = menu.getByRole('menuitem', { name: 'Markdown (.md) Ctrl+N' });
    const text = menu.getByRole('menuitem', { name: language === 'en' ? 'Text (.txt)' : '텍스트 (.txt)' });

    await expect(trigger).toHaveAccessibleName(language === 'en' ? '+ New' : '＋ 새 문서');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(markdown).toBeFocused();
    await expect(text).toBeVisible();
    expect(await commands()).toEqual([]);
    await text.click();
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await commands()).toEqual(['newText']);

    await trigger.click();
    await markdown.click();
    expect(await commands()).toEqual(['newText', 'new']);
    await trigger.press('Control+n');
    expect(await commands()).toEqual(['newText', 'new', 'new']);

    await trigger.press('ArrowDown');
    await expect(markdown).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(text).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await commands()).toEqual(['newText', 'new', 'new', 'newText']);
    await trigger.press('ArrowUp');
    await expect(text).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.locator('#host-filter').click();
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await page.locator('#host-more').click();
    await expect(menu).toBeHidden();
    await expect(page.locator('#host-menu')).toBeVisible();
    await page.locator('#host-menu [data-host-command="newText"]').click();
    expect(await commands()).toEqual(['newText', 'new', 'new', 'newText', 'newText']);
    await trigger.click();
    await page.keyboard.press('Tab');
    await expect(menu).toBeHidden();
    await expect(page.locator('[data-host-command="open"]')).toBeFocused();
  });
}
