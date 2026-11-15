import fs from 'node:fs';
import path from 'node:path';
// Records the managed browser page via CDP screencast until .tmp/stop-record exists.
export default async function run({ page, cdp, workspaceRoot }) {
  const dir = path.join(workspaceRoot, '.tmp', 'frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const stop = path.join(workspaceRoot, '.tmp', 'stop-record');
  fs.rmSync(stop, { force: true });
  const session = cdp ?? (await page.context().newCDPSession(page));
  let n = 0;
  const t0 = Date.now();
  session.on('Page.screencastFrame', async (f) => {
    const ms = Date.now() - t0;
    fs.writeFileSync(path.join(dir, `${String(n++).padStart(6, '0')}_${ms}.jpg`), Buffer.from(f.data, 'base64'));
    try { await session.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
  while (!fs.existsSync(stop) && Date.now() - t0 < 100000) await new Promise((r) => setTimeout(r, 200));
  await session.send('Page.stopScreencast');
  return { frames: n, ms: Date.now() - t0 };
}
