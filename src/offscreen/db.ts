import { openDB, type DBSchema } from 'idb';
import type { PageRecord } from '../shared/types';

interface MemTabDB extends DBSchema {
  pages: { key: string; value: PageRecord; indexes: { 'by-date': number } };
}
const database = openDB<MemTabDB>('memtab-memory', 1, {
  upgrade(db) { const store = db.createObjectStore('pages', { keyPath: 'url' }); store.createIndex('by-date', 'updatedAt'); },
});
export async function getPages(): Promise<PageRecord[]> { return (await database).getAll('pages'); }
export async function savePages(pages: PageRecord[]): Promise<void> {
  const transaction = (await database).transaction('pages', 'readwrite');
  for (const page of pages) transaction.store.put(page);
  await transaction.done;
}
export async function deletePages(urls: string[]): Promise<void> {
  const transaction = (await database).transaction('pages', 'readwrite');
  for (const url of urls) transaction.store.delete(url);
  await transaction.done;
}
export async function clearPages(): Promise<void> { await (await database).clear('pages'); }
