import { cosine, normalize } from './quantization';
import type { GroupPlan, TabVector } from './types';

// Average linkage. Update pair distances by weighted averages rather than recomputing member pairs.
export function clusterVectors(vectors: ArrayLike<number>[], threshold = 0.45): number[][] {
  const n = vectors.length;
  const clusters = new Map<number, number[]>(vectors.map((_, i) => [i, [i]]));
  const distance = Array.from({ length: n }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) distance[i][j] = distance[j][i] = 1 - cosine(vectors[i], vectors[j]);
  while (clusters.size > 1) {
    let best = threshold, a = -1, b = -1;
    const ids = [...clusters.keys()];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const d = distance[ids[i]][ids[j]];
      if (d <= best) { best = d; a = ids[i]; b = ids[j]; }
    }
    if (a === -1) break;
    const left = clusters.get(a)!, right = clusters.get(b)!;
    for (const id of ids) if (id !== a && id !== b) {
      distance[a][id] = distance[id][a] = (distance[a][id] * left.length + distance[b][id] * right.length) / (left.length + right.length);
    }
    clusters.set(a, [...left, ...right]);
    clusters.delete(b);
  }
  return [...clusters.values()];
}
export function representativeIndices(vectors: ArrayLike<number>[], members: number[], count = 2): number[] {
  if (!members.length) return [];
  const centroid = new Float32Array(vectors[members[0]].length);
  for (const index of members) for (let d = 0; d < centroid.length; d++) centroid[d] += vectors[index][d];
  const unit = normalize(centroid);
  return [...members].sort((a, b) => cosine(vectors[b], unit) - cosine(vectors[a], unit)).slice(0, count);
}
const STOPWORDS = new Set('the a an and or to of for in on with your how is are from by at as this that guide tutorial introduction using what learn new home page www com org html https http'.split(' '));
export function localLabel(titles: string[]): string {
  const counts = new Map<string, number>();
  for (const title of titles) for (const word of new Set(title.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [])) {
    if (!STOPWORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const words = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w[0].toUpperCase() + w.slice(1));
  return words.join(' ') || 'Related Pages';
}
export function planGroups(tabs: TabVector[]): GroupPlan[] {
  const vectors = tabs.map(tab => tab.vector);
  const colors: chrome.tabGroups.ColorEnum[] = ['blue', 'green', 'purple', 'orange', 'cyan', 'pink', 'yellow', 'red'];
  return clusterVectors(vectors).filter(members => members.length >= 2).map((members, id) => ({
    id, title: localLabel(members.map(i => tabs[i].title)), color: colors[id % colors.length],
    tabs: members.map(i => tabs[i]), representatives: representativeIndices(vectors, members).map(i => tabs[i]),
  }));
}
export function nmi(truth: Array<string | number>, predicted: Array<string | number>): number {
  if (truth.length !== predicted.length) throw new Error('Labels must have equal length');
  const n = truth.length;
  if (!n) return 0;
  const a = new Map<string | number, number>(), b = new Map<string | number, number>(), joint = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    a.set(truth[i], (a.get(truth[i]) ?? 0) + 1); b.set(predicted[i], (b.get(predicted[i]) ?? 0) + 1);
    const key = JSON.stringify([truth[i], predicted[i]]); joint.set(key, (joint.get(key) ?? 0) + 1);
  }
  const entropy = (counts: Map<string | number, number>) => -[...counts.values()].reduce((sum, count) => sum + count / n * Math.log(count / n), 0);
  const ha = entropy(a), hb = entropy(b);
  if (!ha && !hb) return 1;
  let mutual = 0;
  for (const [key, count] of joint) {
    const [x, y] = JSON.parse(key);
    mutual += count / n * Math.log(count * n / (a.get(x)! * b.get(y)!));
  }
  return ha + hb ? 2 * mutual / (ha + hb) : 1;
}
