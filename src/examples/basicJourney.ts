import type { Page } from 'playwright';

export default async function run(page: Page): Promise<void> {
  await page.goto('https://www.transformuk.com');
}
