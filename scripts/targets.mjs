export default async function run({ page, frame }) {
  return await (frame ?? page).evaluate(() => {
    const d = window.__dailyStack;
    const root = d.board.root;
    root.updateWorldMatrix(true, true);
    const C = 0.06, G = 4;
    const out = [];
    const pieces = [...d.game.blueprint.pieces].sort((a, b) => a.y - b.y);
    for (const p of pieces) {
      const ox = p.kind === 'bar' && p.rot === 0 ? 1 : 0.5;
      const oz = p.kind === 'bar' && p.rot === 1 ? 1 : 0.5;
      const v = root.position.clone();
      v.set((p.x + ox - G / 2) * C, p.y * C + 0.028 + 0.03, (p.z + oz - G / 2) * C);
      root.localToWorld(v);
      out.push({ id: p.id, kind: p.kind, rot: p.rot, y: p.y, pos: { x: v.x, y: v.y, z: v.z } });
    }
    return { out, solved: d.game.solved, rootPos: root.position.toArray() };
  });
}
