export default async function run({ page, frame }) {
  return await (frame ?? page).evaluate(() => { localStorage.removeItem('daily-stack-tutorial-done'); localStorage.removeItem('daily-stack-v1'); return Object.keys(localStorage); });
}
