// End-to-end smoke test: drives the built Electron app against a throwaway library.
// Needs `npm run build` first and network access to arxiv.org. The "model" is a local
// stand-in server (OpenAI-compatible) so no API key is involved; it verifies the app's
// plumbing, not the quality of any real model.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const repo = resolve(new URL('../..', import.meta.url).pathname);
const work = mkdtempSync(join(tmpdir(), 'allpaper-smoke-'));
const userData = join(work, 'userdata');
const library = join(work, 'library');
mkdirSync(userData, { recursive: true });
mkdirSync(library, { recursive: true });

const model = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const system = body.messages?.find((m) => m.role === 'system')?.content ?? '';
    const user = body.messages?.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    let text = 'ok';
    if (system.includes('专业翻译')) text = `【测试译文】${user.replace(/^（所在章节：[^）]*）\n/, '')}`;
    else if (system.includes('科研助手')) text = '测试回答：问题见 [P3]，不存在的引用 [P99999]。';
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const piece of text.match(/.{1,10}/gs)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    }
  });
});
await new Promise((ok) => model.listen(0, '127.0.0.1', ok));
const port = model.address().port;
writeFileSync(join(userData, 'settings.json'), JSON.stringify({
  libraryPath: library, aiProvider: 'openai-compatible', aiBaseUrl: `http://127.0.0.1:${port}/v1`,
  aiModelTranslation: 'stub', aiModelWriting: 'stub', aiModelReasoning: 'stub'
}));

const app = await electron.launch({ args: [repo, `--user-data-dir=${userData}`], cwd: repo });
const page = await app.firstWindow();
const problems = [];
page.on('pageerror', (e) => problems.push(String(e)));
const step = (name) => console.log(`✓ ${name}`);

try {
  await page.waitForSelector('.lib-search input');
  await page.locator('.lib-search input').fill('https://arxiv.org/abs/1706.03762');
  await page.locator('.lib-search button[type=submit]').click();
  await page.waitForSelector('.paper-row', { timeout: 120_000 }).catch(async (error) => {
    const notice = await page.locator('.notice').allInnerTexts();
    throw new Error(`import did not finish; notices: ${JSON.stringify(notice)}`, { cause: error });
  });
  step('arXiv link imported');

  await page.locator('.paper-row').first().click();
  await page.getByRole('button', { name: '打开阅读视图' }).click();
  await page.waitForSelector('.rd-block');
  assert.ok(await page.locator('.rd-article math').count() > 5, 'formulas render as MathML');
  await page.waitForSelector('.rd-trans:not(.rd-trans-loading)', { timeout: 30_000 });
  assert.match(await page.locator('.rd-trans').first().innerText(), /测试译文/);
  step('reading view with translation under paragraphs');

  await page.locator('.project-picker input').fill('Smoke project');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.waitForSelector('.note-prose');
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.querySelector('.rd-article'), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.length > 80 && node.parentElement.closest('.rd-orig.rd-paragraph')) break;
    }
    node.parentElement.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 60);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('.rd-article').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.locator('.selbar button', { hasText: '摘录' }).click();
  await page.waitForSelector('.note-prose blockquote .cite-chip');
  await page.waitForSelector('mark[data-ann]', { timeout: 10_000 });
  step('excerpt becomes a quote with a citation chip in the project note');

  await page.locator('.rd-tabs button', { hasText: '助手' }).click();
  await page.getByRole('button', { name: '速览本文' }).first().click();
  await page.waitForSelector('.msg-assistant .ref-chip');
  assert.ok(await page.locator('.msg-assistant .ref-bad').count() === 1, 'unknown paragraph citation is flagged');
  step('assistant answers with verified paragraph citations');

  await page.waitForTimeout(1500);
  const noteFile = join(library, 'projects', readdirSync(join(library, 'projects'))[0], 'note.md');
  assert.match(readFileSync(noteFile, 'utf8'), /\[@vaswani\d+\w*#[0-9a-f]{8}\]/);
  step('note.md holds a Pandoc-style citation with an anchor');
  assert.deepEqual(problems, []);
  console.log('smoke test passed');
} finally {
  await app.close();
  model.close();
}
