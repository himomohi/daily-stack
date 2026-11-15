export default async function run({ page }) {
  const before = page.viewportSize();
  await page.setViewportSize({ width: 1600, height: 900 });
  return { before, after: page.viewportSize() };
}
