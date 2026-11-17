import type { PageRecord } from './types';

export function lexicalScore(query: string, page: Pick<PageRecord, 'title' | 'url' | 'text'>): number {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? [];
  if (!terms.length) return 0;
  const title = page.title.toLowerCase(), url = page.url.toLowerCase(), text = page.text.toLowerCase();
  let score = 0;
  for (const term of terms) score += title.includes(term) ? 1 : url.includes(term) ? 0.75 : text.includes(term) ? 0.4 : 0;
  return score / terms.length;
}
