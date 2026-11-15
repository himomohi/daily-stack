export default async function run({ page, frame }) {
  return await (frame ?? page).evaluate(() => {
    const d = window.__dailyStack;
    return { pieces: d.game.blueprint.pieces, dateKey: d.game.blueprint.dateKey, solved: d.game.solved };
  });
}
