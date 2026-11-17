(() => {
  const state = window as Window & { __memtabExtractor?: boolean };
  if (state.__memtabExtractor || window !== window.top) return;
  state.__memtabExtractor = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSignature = '', lastCapture = 0, lastUrl = location.href;
  const REMOVE = 'script,style,noscript,nav,footer,aside,form,input,textarea,select,[contenteditable="true"],[role="banner"],[role="navigation"],[aria-hidden="true"],[hidden],.advertisement,.ads,.cookie-banner';
  function capture() {
    timer = undefined;
    if (!document.body || document.visibilityState === 'hidden') return;
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(REMOVE).forEach(element => element.remove());
    const main = clone.querySelector('article,main,[role="main"]') ?? clone;
    const headings = [...main.querySelectorAll('h1,h2,h3')].map(heading => heading.textContent).join(' ').slice(0, 300);
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let body = '', node: Node | null;
    while ((node = walker.nextNode()) && body.length < 6000) body += ` ${node.textContent}`;
    const text = `${headings} ${body}`.replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (text.length < 40) return;
    const signature = `${location.href}\n${document.title}\n${text}`;
    if (signature === lastSignature) return;
    lastSignature = signature; lastCapture = Date.now();
    void chrome.runtime.sendMessage({ target: 'background', type: 'INGEST_PAGE', payload: { url: location.href, title: document.title, text } }).catch(() => { /* The extension can be reloaded independently of this page. */ });
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(capture, Math.max(1500, 15000 - (Date.now() - lastCapture)));
  }
  new MutationObserver(() => { if (!timer) schedule(); }).observe(document.documentElement, { childList: true, subtree: true });
  // Poll URL changes for SPAs whose route navigation makes no DOM mutation.
  setInterval(() => { if (lastUrl !== location.href) { lastUrl = location.href; lastCapture = 0; schedule(); } }, 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(); });
  window.addEventListener('pagehide', () => { if (timer) clearTimeout(timer); });
  schedule();
})();
