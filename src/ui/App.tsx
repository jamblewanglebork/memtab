import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, Braces, Check, ChevronRight, Clock3, Code2, Command, Download, ExternalLink, FlaskConical, FolderHeart, Globe2, LayoutGrid, LoaderCircle, LockKeyhole, MoreHorizontal, Search, Settings2, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import type { EngineStatus, Filter, SearchResult, Settings, WorkspacePlan } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { domain, getWindowId, inExtension, openPage, relativeTime, request, size } from './api';
import { SettingsView } from './Settings';

type View = 'library' | 'workspace' | 'settings';
const FILTERS: { key: Filter; title: string; icon: typeof Search }[] = [
  { key: 'all', title: 'All memories', icon: LayoutGrid }, { key: 'tabs', title: 'Open tabs', icon: Globe2 },
  { key: 'bookmarks', title: 'Bookmarks', icon: Bookmark }, { key: 'history', title: 'History', icon: Clock3 },
];
export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>memtab<span className="brand-dot">.</span></span>{!compact && <span className="brand-beta">LOCAL</span>}</div>;
}
export function App() {
  const popup = location.pathname.endsWith('popup.html');
  const [view, setView] = useState<View>(location.hash === '#settings' ? 'settings' : 'library');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [plan, setPlan] = useState<WorkspacePlan | null>(null);
  const [latency, setLatency] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const windowId = useRef<number | undefined>(undefined);
  const sequence = useRef(0);

  const refreshStatus = useCallback(async () => {
    const value = await request<EngineStatus>('GET_STATUS'); setStatus(value); return value;
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([request<Settings>('GET_SETTINGS'), request<EngineStatus>('GET_STATUS'), getWindowId()])
      .then(([config, state, id]) => { if (!active) return; setSettings(config); setStatus(state); windowId.current = id; })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    void request('SYNC_TABS').then(() => { if (active) setRefresh(value => value + 1); }).catch(() => {});
    const timer = setInterval(() => { if (active) void refreshStatus().catch(() => {}); }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [refreshStatus]);
  useEffect(() => {
    const current = ++sequence.current;
    const timer = setTimeout(() => {
      setSearching(true);
      const started = performance.now();
      request<SearchResult[]>('SEARCH_QUERY', { query, filter, topK: 50, windowId: windowId.current })
        .then(value => { if (sequence.current !== current) return; setResults(value); setSelected(0); setLatency(performance.now() - started); })
        .catch(error => { if (sequence.current === current) setError(error.message); })
        .finally(() => { if (sequence.current === current) setSearching(false); });
    }, query ? 50 : 0);
    return () => clearTimeout(timer);
  }, [query, filter, refresh, status?.model]);
  useEffect(() => { if (view === 'library') searchInput.current?.focus(); }, [view]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setView('library'); searchInput.current?.focus(); }
      if (event.key === 'Escape') { if (view !== 'library') setView('library'); else if (query) setQuery(''); else if (popup) window.close(); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [view, query, popup]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);

  async function action(label: string, task: () => Promise<unknown>) {
    if (busy) return;
    setBusy(label); setError('');
    try { await task(); await refreshStatus(); setRefresh(value => value + 1); }
    catch (error) { setError(error instanceof Error ? error.message : 'Something went wrong.'); }
    finally { setBusy(''); }
  }
  async function activate(result: SearchResult) {
    await action('Opening page', async () => { await request('OPEN_RESULT', { url: result.url, tabId: result.tabId }); if (popup && inExtension) window.close(); });
  }
  function selectFilter(value: Filter) { setFilter(value); setView('library'); setQuery(''); }
  const modelReady = settings.semanticEnabled && status?.model === 'ready';
  const sourceLabel = filter === 'all' ? 'My library' : FILTERS.find(item => item.key === filter)!.title;
  const statusLabel = status?.model === 'loading' ? `Loading model · ${status.progress}%` : status?.indexing ? `Indexing · ${status.embedded}/${status.count}` : !settings.indexingEnabled ? 'Capture paused' : modelReady ? 'Semantic search ready' : 'Keyword search ready';

  return <div className={`app ${popup ? 'popup' : ''}`}>
    {!popup && <aside className="sidebar">
      <Brand />
      <div className="sidebar-section">YOUR SPACE</div>
      <nav aria-label="Library navigation">{FILTERS.map(({ key, title, icon: Icon }) => <button key={key} className={`nav-item ${view === 'library' && filter === key ? 'active' : ''}`} onClick={() => selectFilter(key)}>
        <Icon size={18} /><span>{key === 'all' ? 'My library' : title}</span>{key === 'all' && status && <span className="nav-count">{status.count.toLocaleString()}</span>}{key === 'bookmarks' && status && <span className="nav-count">{status.bookmarks.toLocaleString()}</span>}
      </button>)}</nav>
      <div className="sidebar-section tools-label">TOOLS</div>
      <button className={`nav-item ${view === 'workspace' ? 'active' : ''}`} onClick={() => setView('workspace')}><Sparkles size={18} /><span>Organize workspace</span></button>
      <button className="nav-item" onClick={() => openPage('benchmark.html')}><FlaskConical size={18} /><span>Benchmark</span><ArrowUpRight size={14} className="muted" /></button>
      <div className="sidebar-bottom">
        <div className="private-card"><div className="private-icon"><ShieldCheck size={21} /></div><strong>A memory that stays yours.</strong><p>Your search index lives on this device. Always.</p><span><span className="status-dot" /> Local-first by design</span></div>
        <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}><Settings2 size={18} /><span>Settings</span></button>
        <div className="sidebar-version">MemTab <span>v1.0</span></div>
      </div>
    </aside>}
    <div className="main-shell">
      <header className="topbar">
        {popup ? <Brand compact /> : <div className="breadcrumb">Your workspace <ChevronRight size={13} /><strong>{view === 'library' ? sourceLabel : view === 'settings' ? 'Settings' : 'Organize workspace'}</strong></div>}
        <div className="topbar-actions"><span className="local-pill"><LockKeyhole size={12} /> On-device search</span>{popup ? <><button className="icon-button" title="Open full library" aria-label="Open full library" onClick={() => openPage('library.html')}><ExternalLink size={17} /></button><button className="icon-button" title="Settings" aria-label="Settings" onClick={() => setView(view === 'settings' ? 'library' : 'settings')}><Settings2 size={17} /></button></> : <button className="shortcut" onClick={() => { setView('library'); searchInput.current?.focus(); }} aria-label="Focus search"><Command size={13} /> K</button>}</div>
      </header>
      {!inExtension && <div className="preview-banner">Browser preview · sample data. Load <code>dist/</code> in Chrome to use your own tabs and bookmarks.</div>}
      <main className="main-content">
        {(error || notice) && <div className={`toast ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <span>{error}</span> : <><Check size={17} /><span>{notice}</span></>}<button className="icon-button" aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}><X size={16} /></button></div>}
        {view === 'settings' ? <SettingsView settings={settings} status={status} busy={busy} onBack={() => setView('library')}
          onSave={config => action('Saving settings', async () => { setSettings(await request<Settings>('SAVE_SETTINGS', config)); setNotice('Settings saved.'); })}
          onEnable={() => action('Loading local model', async () => { await request('ENABLE_MODEL'); setSettings(await request<Settings>('GET_SETTINGS')); setNotice('Local semantic model is ready.'); })}
          onImport={kind => action(`Importing ${kind}`, async () => { const value = await request<{ imported: number; label: string }>('IMPORT', kind); setNotice(`Imported ${value.imported.toLocaleString()} ${value.label}.`); })}
          onClear={() => action('Clearing memory', async () => { await request('CLEAR_MEMORY'); setSettings(await request<Settings>('GET_SETTINGS')); setNotice('Memory cleared. Capture is paused.'); })} />
          : view === 'workspace' ? <div className="workspace-view">
            <button className="back-button" onClick={() => setView('library')}><ArrowLeft size={15} /> Back to library</button>
            <div className="eyebrow">MAKE ROOM TO THINK</div><h1>A calmer workspace.</h1><p className="hero-subtitle">Bring related tabs together, and pick up where you left off.</p>
            <div className="workspace-intro"><span className="feature-icon"><Sparkles size={26} /></span><div><h3>Let your tabs find their people.</h3><p>MemTab groups unpinned web tabs in this window by topic. Review the groups before applying them.</p><span className="subtle-pill">{settings.cloudEnabled ? 'Cloud naming enabled · representative snippets will be sent' : 'Local grouping · no cloud calls'}</span></div></div>
            <button className="button primary" disabled={!!busy} onClick={() => void action('Finding related tabs', async () => setPlan(await request<WorkspacePlan>('PREVIEW_WORKSPACE', { windowId: windowId.current })))}>{busy === 'Finding related tabs' ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}{plan ? 'Refresh preview' : 'Preview tab groups'}<ArrowRight size={16} /></button>
            {plan && <div className="plan-results"><div className="session-brief"><div className="eyebrow">SESSION BRIEF</div><p>{plan.summary}</p><span>{plan.ungrouped} unrelated tabs left ungrouped{plan.cloudUsed ? ` · ${plan.tokenReduction.toFixed(1)}% estimated token reduction` : ' · Generated on your device'}</span></div>
              <div className="group-grid">{plan.groups.map(group => <div className="group-card" key={group.id}><h3><span className={`group-dot ${group.color}`} />{group.title}<span>{group.tabs.length} tabs</span></h3>{group.tabs.map(tab => <div className="group-tab" key={tab.tabId}><Globe2 size={14} /><span>{tab.title}</span></div>)}</div>)}</div>
              {plan.groups.length > 0 && <button className="button primary" disabled={!!busy} onClick={() => void action('Applying tab groups', async () => { const value = await request<{ applied: number }>('APPLY_WORKSPACE'); setNotice(`Created ${value.applied} Chrome tab groups.`); setPlan(null); })}>{busy === 'Applying tab groups' ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}Apply {plan.groups.length} tab groups</button>}
            </div>}
          </div> : <>
            <section className="hero">
              <div className="hero-copy"><div className="eyebrow"><span className="tiny-sparkle">✳</span> YOUR PERSONAL WEB MEMORY</div><h1>Your browser,<br /><span>remembered.</span></h1><p className="hero-subtitle">That article. That rabbit hole. That tab you closed.<br className="desktop-break" /> Find your way back to what matters.</p></div>
              {!popup && <div className="memory-art" aria-hidden="true"><div className="art-orbit" /><div className="art-card art-back"><Bookmark size={19} /><i /><i /></div><div className="art-card art-middle"><Code2 size={22} /><i /><i /></div><div className="art-card art-front"><span className="art-icon"><Braces size={25} /></span><div><strong>A thought, saved.</strong><span>Ready when you are.</span></div><span className="art-check"><Check size={12} /></span></div><span className="art-star star-one">✳</span><span className="art-star star-two">+</span></div>}
            </section>
            {!popup && <div className="stats-strip"><div><span className="stat-icon"><FolderHeart size={17} /></span><strong>{status ? status.count.toLocaleString() : '—'}</strong><span>memories saved</span></div><span className="stats-divider" /><div><Bookmark size={16} /><strong>{status ? status.bookmarks.toLocaleString() : '—'}</strong><span>bookmarks</span></div><span className="stats-divider" /><div><ShieldCheck size={16} /><strong>100%</strong><span>local search</span></div><div className="engine-status"><span className={`status-dot ${status?.model === 'loading' || status?.indexing ? 'pulsing' : ''}`} />{statusLabel}</div></div>}
            <section className="search-section" aria-label="Search your browser memory">
              <div className="search-box"><Search size={22} /><input ref={searchInput} value={query} onChange={event => setQuery(event.target.value)} placeholder={modelReady ? 'Describe what you’re looking for…' : 'Search your tabs, bookmarks, and history…'} aria-label="Search your tabs, bookmarks, and history" onKeyDown={event => {
                if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(value => Math.min(results.length - 1, value + 1)); }
                if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(value => Math.max(0, value - 1)); }
                if (event.key === 'Enter' && results[selected]) { event.preventDefault(); void activate(results[selected]); }
              }} />{searching ? <LoaderCircle size={18} className="spin" /> : query ? <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={17} /></button> : <kbd>{popup ? 'Alt K' : '⌘ / Ctrl K'}</kbd>}</div>
              {!query && <div className="search-hint"><Sparkles size={13} />{modelReady ? <>Try an idea, like <button onClick={() => setQuery('that guide on fixing memory leaks in C')}>“that guide on fixing memory leaks in C”</button></> : <>Search by title or URL. <button onClick={() => setView('settings')}>Enable search by meaning <ArrowRight size={12} /></button></>}</div>}
              <div className="filter-bar"><div className="filter-tabs" role="group" aria-label="Filter results">{FILTERS.map(({ key, title, icon: Icon }) => <button key={key} className={filter === key ? 'selected' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}><Icon size={14} />{title}</button>)}</div>{!popup && <button className="text-button" onClick={() => setView('settings')}><Download size={14} />Import</button>}</div>
            </section>
            {status?.count === 0 && !loading && <div className="onboarding"><span className="feature-icon"><FolderHeart size={25} /></span><div><h3>Give your memory a starting point.</h3><p>Import bookmarks and the last 90 days of history. Pages you visit next will be captured automatically.</p><div className="inline-actions"><button className="button small" disabled={!!busy} onClick={() => void action('Importing bookmarks', async () => { const value = await request<{ imported: number }>('IMPORT', 'bookmarks'); setNotice(`Imported ${value.imported} bookmarks.`); })}><Bookmark size={14} />Import bookmarks</button><button className="button small" disabled={!!busy} onClick={() => void action('Importing history', async () => { const value = await request<{ imported: number }>('IMPORT', 'history'); setNotice(`Imported ${value.imported} history entries.`); })}><Clock3 size={14} />Import history</button></div></div></div>}
            <div className="results-heading"><h2>{query ? 'Search results' : 'Recently remembered'}<span>{results.length}{results.length === 50 ? '+' : ''}</span></h2><span>{query && latency > 0 ? `${Math.round(latency)} ms · ${modelReady ? 'hybrid search' : 'keyword search'}` : <><Clock3 size={12} /> Most recent first</>}</span></div>
            <div className="results-list" aria-live="polite" aria-busy={searching || loading}>
              {loading ? <div className="empty-state"><LoaderCircle size={25} className="spin" /><h3>Opening your local memory…</h3></div> : results.length ? results.map((result, i) => <div className={`result-row ${query && i === selected ? 'keyboard-selected' : ''}`} key={result.url}>
                <button className="result-main" onClick={() => void activate(result)} onMouseEnter={() => setSelected(i)}>
                  <span className={`site-icon tone-${domain(result.url).length % 5}`}>{result.url.includes('github') || result.url.includes('developer') ? <Code2 size={21} /> : result.url.includes('valgrind') ? <Braces size={21} /> : <span>{domain(result.url).charAt(0).toUpperCase()}</span>}</span>
                  <span className="result-content"><span className="result-title-line"><strong>{result.title}</strong><ArrowUpRight size={14} className="result-arrow" /></span><span className="result-meta"><span className="result-domain">{domain(result.url)}</span><span className="meta-dot">·</span><span>{relativeTime(result.updatedAt)}</span>{!result.captured && <span className="metadata-label">Title & URL only</span>}</span><span className="result-snippet">{result.snippet || 'Imported from your browser. Visit the page to remember its contents.'}</span></span>
                  <span className="result-badges">{result.isOpen && <span className="badge open"><span />Open tab</span>}{result.sources.includes('bookmark') && <span className="badge bookmark"><Bookmark size={11} />Bookmark</span>}{!result.isOpen && !result.sources.includes('bookmark') && <span className="badge history"><Clock3 size={11} />History</span>}{query && result.semantic && <span className="similarity">Similarity {result.score.toFixed(2)}</span>}</span>
                </button><button className="forget-button" aria-label={`Forget ${result.title}`} title="Remove from MemTab memory" disabled={!!busy} onClick={() => void action('Forgetting page', async () => { await request('FORGET_PAGE', result.url); setNotice('Page removed from MemTab.'); })}><Trash2 size={14} /></button>
              </div>) : <div className="empty-state"><Search size={28} /><h3>{query ? 'Nothing here just yet.' : 'Your next discovery starts here.'}</h3><p>{query ? 'Try another phrase, or import more of your bookmarks and history.' : 'Visit a webpage or import your bookmarks to start building your memory.'}</p></div>}
            </div>
            {!popup && <div className="library-bottom"><div><Sparkles size={16} /><span>Too many tabs, too little headspace?</span><button onClick={() => setView('workspace')}>Organize your workspace <ArrowRight size={13} /></button></div><span>{status?.embedded ?? 0} embedded · {size(status?.vectorBytes ?? 0)} vectors</span></div>}
          </>}
      </main>
      <footer className="app-footer"><span><LockKeyhole size={12} />{popup ? statusLabel : 'Your memories live here. On your device.'}</span><div>{popup ? <button onClick={() => setView('workspace')}><Sparkles size={12} />Organize tabs</button> : <span><kbd>↑</kbd><kbd>↓</kbd> to navigate <kbd>↵</kbd> to open</span>}<button onClick={() => openPage('benchmark.html')}>{popup ? <FlaskConical size={13} /> : null}{popup ? 'Benchmark' : 'Built to remember.'}</button></div></footer>
    </div>
  </div>;
}
