import type { QuantizationMode, Vector } from './types';

export function normalize(vec: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(vec);
  let norm = 0;
  for (const value of out) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm) for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error('Vector dimensions differ');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export function quantizeInt8(vec: Float32Array): Int8Array {
  return Int8Array.from(vec, v => Math.round(Math.max(-1, Math.min(1, v)) * 127));
}
export const cosineInt8 = cosine;
export function quantizeBinary(vec: Float32Array): Uint32Array {
  const packed = new Uint32Array(Math.ceil(vec.length / 32));
  for (let i = 0; i < vec.length; i++) if (vec[i] >= 0) packed[i >>> 5] |= 1 << (i & 31);
  return packed;
}
export function popcount(value: number): number {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
export function hammingSimilarity(a: Uint32Array, b: Uint32Array, dimensions = 384): number {
  if (a.length !== b.length || a.length !== Math.ceil(dimensions / 32)) throw new Error('Vector dimensions differ');
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let value = a[i] ^ b[i];
    if (i === a.length - 1 && dimensions % 32) value &= 0xffffffff >>> (32 - dimensions % 32);
    distance += popcount(value);
  }
  return 1 - distance / dimensions;
}
export function compress(vector: Float32Array, mode: QuantizationMode): Vector {
  return mode === 'int8' ? quantizeInt8(vector) : mode === 'binary' ? quantizeBinary(vector) : vector.slice();
}
export function expand(vector: Vector, mode: QuantizationMode, dimensions = 384): Float32Array {
  if (mode !== 'binary') return normalize(vector);
  return normalize(Float32Array.from({ length: dimensions }, (_, i) => (vector[i >>> 5] >>> (i & 31)) & 1 ? 1 : -1));
}
export function similarity(a: Vector, b: Vector, mode: QuantizationMode): number {
  return mode === 'binary' ? hammingSimilarity(a as Uint32Array, b as Uint32Array) : cosine(a, b);
}
