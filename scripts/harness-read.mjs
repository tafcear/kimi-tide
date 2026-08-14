// harness-read.mjs <sessionFile> — read a stored session exactly like the
// harness does: JsonlSessionPersistence + a bare cordis Context, through the
// prepare (assertEventsSupported) + readFrom path the web history load uses.
import { Context } from 'file:///C:/Users/tafce/AppData/Local/npm-cache/_npx/b86ed90107c62dab/node_modules/@deepseek-ai/cordis/lib/index.js';
import { JsonlSessionPersistence } from 'file:///C:/Users/tafce/AppData/Local/npm-cache/_npx/b86ed90107c62dab/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js';

const id = process.argv[2];
const root = process.argv[3] ?? 'D:/Data/sess-debug/harness-root';
const ctx = new Context();
ctx.sessions = {
  list: () => [],
  get: () => undefined,
  prepare: (_id, { seed, meta }) => ({ header: meta, events: seed }),
};
const persistence = new JsonlSessionPersistence(ctx, {
  root,
  compression: 'zstd',
});
try {
  const prepared = await persistence.prepare(id);
  console.log('PREPARE OK (assertEventsSupported passed)');
  const { meta, events } = await persistence.readFrom(id, 0);
  console.log('meta:', JSON.stringify(meta).slice(0, 220));
  console.log('events:', events.length);
  const kimi = events.filter((e) => e.type === 'kimi/session');
  console.log('kimi/session events:', kimi.length, '(all ignorable:', kimi.every((e) => e.ignorable === true) + ')');
  const firstUser = events.find((e) => e.type === 'user/message');
  console.log('first user/message seq:', firstUser?.seq, JSON.stringify(firstUser?.data?.content?.[0]).slice(0, 160));
  console.log('last event:', JSON.stringify(events.at(-1)).slice(0, 200));
} catch (e) {
  console.log('HARNESS LOAD FAILED:', e?.message ?? e);
  process.exit(1);
} finally {
  try { ctx.dispose?.(); } catch {}
}
