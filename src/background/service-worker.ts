import { canonicalUrl, DEFAULT_SETTINGS, excluded, type Filter, type Message, type PageInput, type Reply, type SearchResult, type Settings, type WorkspacePlan } from '../shared/types';
import { lexicalScore } from '../shared/retrieval';
import { planGroups } from '../shared/clustering';
import { nameGroups, prunedPayload, validateEndpoint } from './cloud';

let creation: Promise<void> | null = null;
let configuration: Promise<void> | null = null;
async function settings(): Promise<Settings> {
  const data = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...data.settings };
}
async function ensureOffscreen() {
  if (creation) return creation;
  creation = (async () => {
    if (!await chrome.offscreen.hasDocument()) {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Run local semantic embeddings and retain a compressed search index between requests.' });
      configuration = null;
    }
  })();
  try { await creation; } finally { creation = null; }
}
async function raw<T>(type: string, payload?: unknown): Promise<T> {
  const response: Reply<T> = await chrome.runtime.sendMessage({ target: 'offscreen', type, payload });
  if (!response?.ok) throw new Error(response?.error || 'The local engine did not respond. Please retry.');
  return response.data;
}
async function engine<T>(type: string, payload?: unknown): Promise<T> {
  await ensureOffscreen();
  if (!configuration) configuration = settings().then(config => raw('CONFIGURE', config)).then(() => {}).catch(error => { configuration = null; throw error; });
  await configuration;
  return raw<T>(type, payload);
}
async function saveSettings(input: Partial<Settings>) {
  const current = await settings();
  const next = { ...current, ...input };
  if (!['float32', 'int8', 'binary'].includes(next.mode)) throw new Error('Unknown vector precision.');
  if (!['openai', 'gemini'].includes(next.provider)) throw new Error('Unknown cloud provider.');
  next.maxPages = Math.max(100, Math.min(20000, Math.floor(Number(next.maxPages) || 5000)));
  next.excludedHosts = next.excludedHosts.map(host => host.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]).filter(Boolean);
  if (next.endpoint) next.endpoint = validateEndpoint(next.endpoint);
  await chrome.storage.local.set({ settings: next });
  await ensureOffscreen();
  configuration = raw('CONFIGURE', next).then(() => {});
  await configuration;
  return next;
}
async function currentTabs(windowId?: number) {
  const tabs = await chrome.tabs.query(windowId === undefined ? { currentWindow: true } : { windowId });
  return tabs.filter(tab => !tab.incognito && tab.id !== undefined && canonicalUrl(tab.url ?? ''));
}
async function syncOpenTabs() {
  const config = await settings();
  if (!config.indexingEnabled) return;
  const tabs = await chrome.tabs.query({});
  const inputs: PageInput[] = tabs.filter(tab => !tab.incognito && canonicalUrl(tab.url ?? '') && !excluded(tab.url!, config)).map(tab => ({
    url: tab.url!, title: tab.title || tab.url!, text: `${tab.title || ''} ${tab.url}`, source: 'history', updatedAt: tab.lastAccessed || Date.now(),
  }));
  await engine('INGEST', inputs);
}
async function search(payload: { query: string; filter: Filter; topK: number; windowId?: number }) {
  const config = await settings();
  const query = String(payload.query ?? '').slice(0, 300);
  const [records, tabs] = await Promise.all([
    engine<SearchResult[]>('SEARCH', { query, topK: config.maxPages }), chrome.tabs.query({}),
  ]);
  const open = new Map<string, chrome.tabs.Tab>();
  for (const tab of tabs) {
    const url = canonicalUrl(tab.url ?? '');
    if (url && !tab.incognito && !excluded(url, config)) {
      if (!open.has(url) || tab.windowId === payload.windowId) open.set(url, tab);
    }
  }
  const results = new Map(records.map(record => [record.url, record]));
  for (const [url, tab] of open) {
    const existing = results.get(url);
    if (existing) { Object.assign(existing, { isOpen: true, tabId: tab.id, windowId: tab.windowId }); continue; }
    const score = lexicalScore(query, { title: tab.title || url, url, text: '' });
    if (query && !score) continue;
    results.set(url, { url, title: tab.title || url, snippet: '', sources: ['history'], captured: false, semantic: false,
      score, updatedAt: tab.lastAccessed || Date.now(), isOpen: true, tabId: tab.id, windowId: tab.windowId });
  }
  return [...results.values()].filter(result => payload.filter === 'tabs' ? result.isOpen
    : payload.filter === 'bookmarks' ? result.sources.includes('bookmark') : payload.filter === 'history' ? result.sources.includes('history') : true)
    .sort((a, b) => query ? b.score - a.score || b.updatedAt - a.updatedAt : b.updatedAt - a.updatedAt)
    .slice(0, Math.min(100, Math.max(1, payload.topK || 40)));
}
function flattenBookmarks(nodes: chrome.bookmarks.BookmarkTreeNode[]): PageInput[] {
  return nodes.flatMap(node => node.url ? [{ url: node.url, title: node.title, text: `${node.title} ${node.url}`, source: 'bookmark' as const, updatedAt: node.dateAdded || Date.now() }] : flattenBookmarks(node.children ?? []));
}
async function importData(kind: 'bookmarks' | 'history') {
  const config = await settings();
  if (kind === 'bookmarks') {
    const inputs = flattenBookmarks(await chrome.bookmarks.getTree());
    const existing = await engine<SearchResult[]>('SEARCH', { query: '', topK: config.maxPages });
    const urls = new Set(inputs.map(input => canonicalUrl(input.url)));
    await engine('REMOVE_SOURCE', { source: 'bookmark', urls: existing.filter(page => page.sources.includes('bookmark') && !urls.has(page.url)).map(page => page.url) });
    return { imported: await engine<number>('INGEST', inputs), label: 'bookmarks' };
  }
  const history = await chrome.history.search({ text: '', startTime: Date.now() - 90 * 86400000, maxResults: config.maxPages });
  return { imported: await engine<number>('INGEST', history.map(item => ({ url: item.url!, title: item.title || item.url!, text: `${item.title || ''} ${item.url}`, source: 'history', updatedAt: item.lastVisitTime || Date.now() }))), label: 'history entries from the last 90 days' };
}
async function preview(windowId?: number): Promise<WorkspacePlan> {
  const config = await settings();
  if (!config.semanticEnabled) throw new Error('Enable the local semantic model in Settings to group tabs by topic.');
  const tabs = (await currentTabs(windowId)).filter(tab => !tab.pinned && !excluded(tab.url!, config));
  if (tabs.length > 240) throw new Error('Organize a window with at most 240 unpinned web tabs.');
  const vectors = await engine<any[]>('TAB_VECTORS', tabs.map(tab => ({ id: tab.id!, windowId: tab.windowId, url: tab.url!, title: tab.title || tab.url! })));
  let groups = planGroups(vectors);
  let summary = groups.length ? `Your workspace has ${groups.length} related topics across ${groups.reduce((sum, group) => sum + group.tabs.length, 0)} tabs.` : 'No closely related tabs found in this window. Try opening a few pages on the same topic.';
  const fullTokens = Math.ceil(JSON.stringify(vectors.map(tab => ({ title: tab.title, snippet: tab.snippet }))).length / 4);
  const prunedTokens = Math.ceil(JSON.stringify(prunedPayload(groups)).length / 4);
  if (config.cloudEnabled && groups.length) {
    const named = await nameGroups(groups, config); groups = named.groups; summary = named.summary || summary;
  }
  const plan = { groups, summary, ungrouped: tabs.length - groups.reduce((sum, group) => sum + group.tabs.length, 0), cloudUsed: config.cloudEnabled && groups.length > 0,
    inputTokens: fullTokens, prunedTokens, tokenReduction: fullTokens ? Math.max(0, (1 - prunedTokens / fullTokens) * 100) : 0 };
  await chrome.storage.session.set({ workspacePlan: plan });
  return plan;
}
async function applyPlan() {
  const { workspacePlan: plan } = await chrome.storage.session.get('workspacePlan') as { workspacePlan?: WorkspacePlan };
  if (!plan) throw new Error('Preview your workspace first.');
  const config = await settings();
  let applied = 0;
  for (const group of plan.groups) {
    const valid: number[] = [];
    for (const tab of group.tabs) {
      try {
        const live = await chrome.tabs.get(tab.tabId);
        if (live.windowId === tab.windowId && canonicalUrl(live.url ?? '') === canonicalUrl(tab.url) && !live.pinned && !live.incognito && !excluded(live.url!, config)) valid.push(tab.tabId);
      } catch { /* Tabs closed since preview are skipped. */ }
    }
    if (valid.length < 2) continue;
    const groupId = await chrome.tabs.group({ tabIds: valid });
    await chrome.tabGroups.update(groupId, { title: group.title, color: group.color, collapsed: false });
    applied++;
  }
  await chrome.storage.session.remove('workspacePlan');
  return { applied };
}
async function activate(result: { url: string; tabId?: number }) {
  const url = canonicalUrl(result.url);
  if (!url) throw new Error('Only HTTP and HTTPS pages can be opened.');
  if (result.tabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(result.tabId);
      if (!tab.incognito && canonicalUrl(tab.url ?? '') === url) {
        await chrome.tabs.update(tab.id!, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); return true;
      }
    } catch { /* A closed or navigated tab is reopened as a new tab. */ }
  }
  await chrome.tabs.create({ url }); return true;
}
async function handle(message: Message, sender: chrome.runtime.MessageSender) {
  // Content scripts may only submit their own page; all administrative commands are extension-page only.
  if (sender.tab) {
    if (message.type !== 'INGEST_PAGE' || sender.frameId !== 0 || sender.tab.incognito) throw new Error('This operation is unavailable from a webpage.');
    const config = await settings();
    const url = canonicalUrl(sender.url ?? '');
    if (!config.indexingEnabled || !url || canonicalUrl(message.payload?.url) !== url || excluded(url, config)) return false;
    return engine('INGEST', [{ url, title: String(message.payload.title || '').slice(0, 300), text: String(message.payload.text || '').slice(0, 1200), captured: true, source: 'history' }]);
  }
  switch (message.type) {
    case 'GET_SETTINGS': return settings();
    case 'SAVE_SETTINGS': return saveSettings(message.payload);
    case 'GET_STATUS': return engine('STATUS');
    case 'SEARCH_QUERY': return search(message.payload);
    case 'IMPORT': return importData(message.payload);
    case 'ENABLE_MODEL': await saveSettings({ semanticEnabled: true }); return engine('ENABLE_MODEL');
    case 'PREVIEW_WORKSPACE': return preview(message.payload?.windowId);
    case 'APPLY_WORKSPACE': return applyPlan();
    case 'OPEN_RESULT': return activate(message.payload);
    case 'CLEAR_MEMORY': await saveSettings({ indexingEnabled: false }); return engine('CLEAR');
    case 'FORGET_PAGE': return engine('REMOVE', [canonicalUrl(message.payload)].filter(Boolean));
    case 'BENCHMARK_START': return engine('BENCHMARK_START');
    case 'BENCHMARK_STATUS': return engine('BENCHMARK_STATUS');
    case 'SYNC_TABS': await syncOpenTabs(); return true;
    default: throw new Error('Unknown MemTab operation.');
  }
}
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (message.target === 'offscreen' || sender.id !== chrome.runtime.id) return;
  // Chrome supplies sender.tab for library pages too; only HTTP(S) senders are content scripts.
  const trusted = sender.url?.startsWith(chrome.runtime.getURL(''));
  const context = trusted ? { ...sender, tab: undefined } : sender;
  if (!trusted && !sender.tab) return;
  handle(message, context).then(data => sendResponse({ ok: true, data } satisfies Reply<unknown>)).catch(error => sendResponse({ ok: false, error: error.message } satisfies Reply<unknown>));
  return true;
});
function safely(task: Promise<unknown>) { void task.catch(error => console.warn('MemTab:', error instanceof Error ? error.message : 'Background operation failed')); }
chrome.runtime.onInstalled.addListener(() => {
  safely((async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    if (!(await chrome.storage.local.get('settings')).settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    await chrome.alarms.create('resume-indexing', { periodInMinutes: 5 });
    await syncOpenTabs();
    await chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
  })());
});
chrome.runtime.onStartup.addListener(() => safely(syncOpenTabs()));
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'resume-indexing') safely(settings().then(config => engine('CONFIGURE', config))); });
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (change.status !== 'complete' || tab.incognito || !canonicalUrl(tab.url ?? '')) return;
  safely((async () => {
    if (!(await settings()).indexingEnabled) return;
    await engine('INGEST', [{ url: tab.url!, title: tab.title || tab.url!, text: `${tab.title || ''} ${tab.url}`, source: 'history' }]);
    // Existing tabs receive the extractor after installing the extension too.
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['extractor.js'] }); } catch { /* Browser-restricted pages cannot be injected. */ }
  })());
});
chrome.bookmarks.onCreated.addListener((_id, node) => safely((async () => { if (node.url && (await settings()).indexingEnabled) await engine('INGEST', flattenBookmarks([node])); })()));
chrome.bookmarks.onChanged.addListener(() => safely((async () => { if ((await settings()).indexingEnabled) await importData('bookmarks'); })()));
chrome.bookmarks.onRemoved.addListener((_id, info) => safely(engine('REMOVE_SOURCE', { source: 'bookmark', urls: flattenBookmarks([info.node]).map(page => page.url) })));
chrome.history.onVisitRemoved.addListener(removed => safely(engine('REMOVE_SOURCE', { source: 'history', urls: removed.allHistory ? undefined : removed.urls })));
