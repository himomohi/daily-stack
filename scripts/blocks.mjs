export default async function run({ page, frame }) {
  return await (frame ?? page).evaluate(() => {
    const root = window.__dailyStack.board.root;
    const res = [];
    root.traverse((o) => { if (o.name && o.name.startsWith('block-')) res.push([o.name, o.parent && o.parent.name, o.position.toArray().map((v) => +v.toFixed(3)), +o.rotation.y.toFixed(2)]); });
    const all = [];
    window.__dailyStack.board.root.parent.traverse((o) => { if (o.name && o.name.startsWith('block-') ) all.push([o.name, o.parent && o.parent.name]); });
    return { res, all };
  });
}
