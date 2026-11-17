import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterVectors, nmi, representativeIndices } from '../src/shared/clustering';
import { canonicalUrl, DEFAULT_SETTINGS, excluded } from '../src/shared/types';
import { compress, cosine, cosineInt8, hammingSimilarity, normalize, popcount, quantizeBinary, quantizeInt8 } from '../src/shared/quantization';
import { retrievalMetrics, percentiles } from '../src/benchmark/runner';
import dataset from '../src/benchmark/synthetic_dataset.json';
import { validateCloudResponse, validateEndpoint } from '../src/background/cloud';

test('quantization stores precisely 1536, 384, and 48 bytes for a 384-dimensional vector', () => {
  const vector = normalize(Float32Array.from({ length: 384 }, (_, i) => Math.sin(i)));
  assert.equal(compress(vector, 'float32').byteLength, 1536);
  assert.equal(compress(vector, 'int8').byteLength, 384);
  assert.equal(compress(vector, 'binary').byteLength, 48);
  assert.ok(Math.abs(cosine(vector, vector) - 1) < 1e-6);
  assert.ok(Math.abs(cosineInt8(quantizeInt8(vector), quantizeInt8(vector)) - 1) < 1e-6);
});
test('int8 clamps out-of-range values; zero norms and dimension mismatches are handled', () => {
  assert.deepEqual([...quantizeInt8(Float32Array.of(-2, -1, 0, 1, 2))], [-127, -127, 0, 127, 127]);
  assert.equal(cosine([0, 0], [1, 2]), 0);
  assert.throws(() => cosine([1], [1, 2]), /dimensions/);
});
test('packed binary similarity handles signed 32-bit values and partial words', () => {
  assert.equal(popcount(0xffffffff), 32); assert.equal(popcount(0x80000000), 1);
  const positive = quantizeBinary(new Float32Array(384).fill(1)), negative = quantizeBinary(new Float32Array(384).fill(-1));
  assert.equal(hammingSimilarity(positive, positive), 1); assert.equal(hammingSimilarity(positive, negative), 0);
  assert.equal(hammingSimilarity(Uint32Array.of(0xffffffff, 0xffffffff), Uint32Array.of(0, 0), 33), 0);
  assert.throws(() => hammingSimilarity(positive, Uint32Array.of(0)), /dimensions/);
});
test('average linkage separates independent topics and returns centroid representatives', () => {
  const vectors = [[1, 0, 0], [0.99, 0.05, 0], [0, 1, 0], [0, 0.99, 0.05], [0, 0, -1]];
  const clusters = clusterVectors(vectors).map(cluster => [...cluster].sort()).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(clusters, [[0, 1], [2, 3], [4]]);
  assert.equal(representativeIndices(vectors, [0, 1], 1).length, 1);
  assert.deepEqual(clusterVectors([]), []);
  assert.ok(Math.abs(nmi(['a', 'a', 'b', 'b'], [1, 1, 0, 0]) - 1) < 1e-9);
  assert.equal(nmi(['a', 'a', 'b', 'b'], [0, 1, 0, 1]), 0);
  assert.equal(nmi(['a', 'a'], [0, 0]), 1);
});
test('URL normalization rejects executable schemes and credentials; exclusions match subdomains', () => {
  assert.equal(canonicalUrl('https://example.com/path?q=x#part'), 'https://example.com/path?q=x');
  for (const url of ['javascript:alert(1)', 'file:///private', 'chrome://history', 'https://user:pass@example.com']) assert.equal(canonicalUrl(url), null);
  const settings = { ...DEFAULT_SETTINGS, excludedHosts: ['example.com'] };
  assert.ok(excluded('https://mail.example.com', settings)); assert.ok(!excluded('https://notexample.com', settings));
});
test('benchmark uses 240 unique documents and 40 explicit six-document relevance judgments', () => {
  assert.equal(dataset.documents.length, 240); assert.equal(dataset.queries.length, 40);
  const ids = new Set(dataset.documents.map(doc => doc.id)); assert.equal(ids.size, 240);
  for (const query of dataset.queries) { assert.equal(query.relevantIds.length, 6); assert.ok(query.relevantIds.every(id => ids.has(id))); }
  for (const topic of new Set(dataset.documents.map(doc => doc.topic))) assert.equal(dataset.documents.filter(doc => doc.topic === topic).length, 30);
  const result = retrievalMetrics(['irrelevant', 'a', 'b'], ['a', 'b']);
  assert.equal(result.recallAt1, 0); assert.equal(result.recallAt5, 1); assert.equal(result.mrrAt10, 0.5);
  assert.equal(percentiles([1, 2, 3, 4, 5]).p95Ms, 5);
});
test('cloud responses cannot modify group memberships; names are bounded and endpoints validated', () => {
  const group = { id: 0, title: 'Local Name', color: 'blue' as const, tabs: [], representatives: [] };
  const output = validateCloudResponse({ groups: [{ clusterId: 0, title: 'One Two Three Four Five', color: 'green', tabs: [666] }], summary: 'Session' }, [group]);
  assert.equal(output.groups[0].title, 'One Two Three'); assert.deepEqual(output.groups[0].tabs, []);
  assert.equal(validateCloudResponse({ groups: [{ clusterId: 0, title: 'X', color: 'invalid' }] }, [group]).groups[0].title, 'Local Name');
  assert.throws(() => validateEndpoint('http://remote.example/api'), /HTTPS/);
  assert.throws(() => validateEndpoint('https://user:key@example.com/api'), /credentials/);
  assert.equal(validateEndpoint('http://localhost:1234/v1/chat/completions'), 'http://localhost:1234/v1/chat/completions');
});
