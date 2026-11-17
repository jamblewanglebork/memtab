import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const modelTest = process.argv.includes('--model');
const artifacts = resolve('artifacts');
await mkdir(artifacts, { recursive: true });
const cloudPayloads = [];
const fixture = createServer((req, res) => {
  if (req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const content = JSON.parse(body); const groups = JSON.parse(content.messages[1].content); cloudPayloads.push(groups);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ groups: groups.map(group => ({ clusterId: group.clusterId, title: 'Native Debugging', color: 'green' })), summary: 'Working on native program reliability.' }) } }] }));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  const other = req.url?.includes('cooking');
  const title = other ? 'Weeknight tomato pasta cooking' : `Valgrind heap debugging ${req.url?.includes('two') ? 'and allocation ownership' : 'and memory leaks'}`;
  const article = other ? 'Tomatoes, garlic, pasta water, olive oil, and fresh basil make an easy weeknight meal. Simmer a sauce and toss the noodles until glossy.' : 'Debug memory leaks in native C and C++ programs with Valgrind Memcheck. Track heap allocations, free owned buffers, detect invalid pointers, and inspect lost blocks.';
  res.end(`<!doctype html><title>${title}</title><nav>BOILERPLATE_SECRET should not be captured</nav><main><h1>${title}</h1><p>${article.repeat(5)}</p></main><form><input value="FORM_SECRET"><textarea>FORM_SECRET</textarea></form>`);
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${fixture.address().port}`;
let context;
try {
  context = await chromium.launchPersistentContext(resolve(`.test-profile/run-${Date.now()}`), {
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true, viewport: { width: 1440, height: 1080 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--enable-precise-memory-info'],
  });
  // Recent branded Chrome removed --load-extension. Its explicit debugging API loads the test extension.
  const cdp = await context.browser().newBrowserCDPSession();
  console.log((await cdp.send('Browser.getVersion')).product);
  await cdp.send('Extensions.loadUnpacked', { path: resolve('dist') });
  let workers = context.serviceWorkers();
  const worker = workers[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(worker.url()).host;
  const browserErrors = [];
  context.on('page', page => page.on('pageerror', error => browserErrors.push(error.message)));
  const apiPage = await context.newPage();
  await apiPage.goto(`chrome-extension://${id}/library.html`);
  async function api(type, payload) {
    const response = await apiPage.evaluate(async ({ type, payload }) => chrome.runtime.sendMessage({ target: 'background', type, payload }), { type, payload });
    if (!response?.ok) throw new Error(`${type}: ${response?.error}`);
    return response.data;
  }
  async function until(check, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
    throw new Error('Timed out waiting for browser state');
  }
  await until(async () => { try { return Boolean(await api('GET_SETTINGS')); } catch { return false; } });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/library.html`);
  await page.getByRole('heading', { name: /Your browser,/ }).waitFor();
  const source = await context.newPage();
  await source.goto(`${origin}/native-one`);
  await until(async () => (await api('GET_STATUS')).captured > 0);
  const raw = await worker.evaluate(async () => chrome.runtime.sendMessage({ target: 'offscreen', type: 'SEARCH', payload: { query: '', topK: 50 } }));
  assert.equal(raw.ok, true);
  assert.ok(raw.data.some(item => item.captured && item.snippet.includes('heap allocations')));
  assert.ok(raw.data.every(item => !item.snippet.includes('BOILERPLATE_SECRET') && !item.snippet.includes('FORM_SECRET')));
  const bookmark = await worker.evaluate(async origin => chrome.bookmarks.create({ title: 'Saved linear algebra notes', url: `${origin}/bookmark-matrix` }), origin);
  await worker.evaluate(async origin => chrome.history.addUrl({ url: `${origin}/old-history` }), origin);
  assert.ok((await api('IMPORT', 'bookmarks')).imported >= 1);
  assert.ok((await api('IMPORT', 'history')).imported >= 1);
  const bookmarkResults = await api('SEARCH_QUERY', { query: 'linear algebra', filter: 'bookmarks', topK: 20 });
  assert.ok(bookmarkResults.some(item => item.url === `${origin}/bookmark-matrix` && !item.captured));
  const open = await api('SEARCH_QUERY', { query: 'Valgrind', filter: 'tabs', topK: 20 });
  assert.ok(open.some(item => item.isOpen));
  const snapshot = open.find(item => item.url === `${origin}/native-one`);
  await source.close();
  const closed = await api('SEARCH_QUERY', { query: 'Valgrind', filter: 'history', topK: 20 });
  assert.ok(closed.some(item => item.url === snapshot.url && !item.isOpen));
  await api('OPEN_RESULT', snapshot); // Stale tab IDs reopen safely.
  const blank = await context.newPage();
  await blank.goto(`${origin}/cooking`);
  const contentPermissions = await worker.evaluate(async origin => {
    const [tab] = await chrome.tabs.query({ url: `${origin}/cooking` });
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => chrome.runtime.sendMessage({ target: 'background', type: 'GET_SETTINGS' }) });
    return results[0].result;
  }, origin);
  assert.equal(contentPermissions.ok, false, 'Webpage content scripts cannot read API keys/settings');
  await page.reload();
  await page.getByRole('button', { name: /Valgrind heap debugging/ }).first().waitFor();
  await page.screenshot({ path: resolve(artifacts, 'library.png'), fullPage: true });
  await page.getByRole('textbox', { name: 'Search your tabs, bookmarks, and history' }).fill('linear algebra');
  await page.getByRole('button', { name: /Saved linear algebra notes/ }).first().waitFor();
  await page.screenshot({ path: resolve(artifacts, 'search.png'), fullPage: true });
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.setViewportSize({ width: 600, height: 600 });
  await page.getByRole('textbox', { name: 'Search your tabs, bookmarks, and history' }).waitFor();
  await page.screenshot({ path: resolve(artifacts, 'popup.png') });
  await page.goto(`chrome-extension://${id}/library.html#settings`);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole('heading', { name: 'A few thoughtful settings.' }).waitFor();
  await page.screenshot({ path: resolve(artifacts, 'settings.png'), fullPage: true });
  if (modelTest) {
    console.log('Loading the real q8 MiniLM model in the MV3 offscreen document...');
    await api('ENABLE_MODEL');
    await until(async () => { const status = await api('GET_STATUS'); if (status.error) throw new Error(status.error); return !status.indexing && status.embedded === status.count; }, 180000);
    const semantic = await api('SEARCH_QUERY', { query: 'the tool for finding native programs that keep consuming more RAM', filter: 'all', topK: 10 });
    assert.ok(semantic.some(item => item.semantic && item.title.includes('Valgrind')));
    await api('SAVE_SETTINGS', { semanticEnabled: false });
    await api('ENABLE_MODEL');
    assert.equal((await api('GET_STATUS')).model, 'ready', 'Re-enabling an already loaded model works');
    const related = await context.newPage(); await related.goto(`${origin}/native-two`);
    await until(async () => { const status = await api('GET_STATUS'); return status.captured >= 3 && !status.indexing; });
    const localPlan = await api('PREVIEW_WORKSPACE');
    assert.ok(localPlan.groups.length > 0); assert.equal(cloudPayloads.length, 0, 'Local organization makes no cloud calls');
    await api('SAVE_SETTINGS', { cloudEnabled: true, endpoint: `${origin}/v1/chat/completions`, model: 'mock-chat-model', apiKey: '' });
    const cloudPlan = await api('PREVIEW_WORKSPACE');
    assert.equal(cloudPlan.cloudUsed, true); assert.ok(cloudPlan.groups.every(group => group.title === 'Native Debugging'));
    assert.ok(cloudPayloads.every(groups => groups.every(group => group.representatives.length <= 2)));
    assert.ok(!JSON.stringify(cloudPayloads).includes(origin), 'Cloud payloads omit URLs');
    assert.ok((await api('APPLY_WORKSPACE')).applied > 0);
    const config = await api('GET_SETTINGS');
    await api('SAVE_SETTINGS', { ...config, indexingEnabled: false });
    await context.setOffline(true);
    const offline = await api('SEARCH_QUERY', { query: 'diagnosing lost allocations in a native application', filter: 'all', topK: 10 });
    assert.ok(offline.some(result => result.semantic), 'Semantic query inference works offline after model loading');
    await context.setOffline(false);
    console.log('Running the complete 240-document / 40-query benchmark...');
    await api('BENCHMARK_START');
    await until(async () => { const state = await api('BENCHMARK_STATUS'); if (state.error) throw new Error(state.error); return !state.running && Boolean(state.report); }, 300000);
    const state = await api('BENCHMARK_STATUS');
    assert.equal(state.report.documentCount, 240); assert.equal(state.report.modes.length, 3);
    await writeFile(resolve(artifacts, 'benchmark-report.json'), JSON.stringify(state.report, null, 2));
    await page.goto(`chrome-extension://${id}/benchmark.html`);
    await page.getByRole('heading', { name: 'Results from this device' }).waitFor();
    await page.screenshot({ path: resolve(artifacts, 'benchmark.png'), fullPage: true });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV', exact: true }).click();
    await (await download).saveAs(resolve(artifacts, 'benchmark-report.csv'));
    console.log(JSON.stringify({ queryInference: state.report.queryInference, modes: state.report.modes, clustering: state.report.clustering, tokens: state.report.tokens }, null, 2));
  } else {
    await page.goto(`chrome-extension://${id}/benchmark.html`);
    await page.getByRole('button', { name: 'Run benchmark' }).waitFor();
    await page.screenshot({ path: resolve(artifacts, 'benchmark-idle.png'), fullPage: true });
  }
  await api('CLEAR_MEMORY');
  assert.equal((await api('GET_STATUS')).count, 0);
  assert.equal((await api('GET_SETTINGS')).indexingEnabled, false);
  assert.ok((await worker.evaluate(async id => chrome.bookmarks.get(id), bookmark.id)).length === 1, 'Clearing MemTab preserves Chrome bookmarks');
  assert.deepEqual(browserErrors, [], 'No uncaught extension page errors');
    console.log(`Browser integration checks passed${modelTest ? ', including actual semantic inference, grouping, mock provider integration, benchmark, and CSV export' : ''}. Screenshots: artifacts/`);
} finally {
  if (context) await context.close();
  await new Promise(resolve => fixture.close(resolve));
}
