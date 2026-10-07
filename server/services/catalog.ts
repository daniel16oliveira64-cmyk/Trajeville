import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { DomainError } from '../domain/errors.ts';
import {
  CATEGORIES, isSize, sortSizes, type CategoryCode, type SizeCode,
} from '../domain/constants.ts';
import { getAvailability, getStockBreakdown, openMaintenance, futurePeak } from '../domain/availability.ts';

export interface ProductInput {
  name: string; category: CategoryCode; description?: string; includedPieces?: string;
  accessories?: string; notes?: string; status?: 'ATIVO' | 'INATIVO' | 'RASCUNHO';
  sizes: Array<{ size: SizeCode; stock: number }>; isDemo?: boolean;
}

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function validateSizes(sizes: ProductInput['sizes']) {
  if (!Array.isArray(sizes) || sizes.length === 0) throw new DomainError('VALIDATION', 'Selecione ao menos um tamanho para o traje.');
  const seen = new Set<string>();
  for (const s of sizes) {
    if (!isSize(s.size)) throw new DomainError('VALIDATION', `Tamanho inválido: ${String(s.size)}. Use PP, P, M, G, GG, XG ou XXG.`);
    if (seen.has(s.size)) throw new DomainError('VALIDATION', `Tamanho repetido: ${s.size}.`);
    seen.add(s.size);
    if (!Number.isInteger(s.stock) || s.stock < 0 || s.stock > 10_000) throw new DomainError('VALIDATION', `Estoque inválido para o tamanho ${s.size}.`);
  }
}

export function createProduct(db: DB, input: ProductInput): number {
  const name = (input.name ?? '').trim();
  if (name.length < 3 || name.length > 120) throw new DomainError('VALIDATION', 'Informe um nome entre 3 e 120 caracteres.');
  if (!CATEGORIES.includes(input.category)) throw new DomainError('VALIDATION', 'Categoria inválida.');
  validateSizes(input.sizes);
  return tx(db, () => {
    const cat = db.prepare('SELECT id FROM categories WHERE code=?').get(input.category) as { id: number };
    let slug = slugify(name), n = 1;
    while (db.prepare('SELECT 1 FROM products WHERE slug=?').get(slug)) slug = `${slugify(name)}-${++n}`;
    const r = db.prepare(`INSERT INTO products(slug,name,category_id,description,included_pieces,accessories,notes,status,is_demo)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(slug, name, cat.id, input.description ?? '', input.includedPieces ?? '',
      input.accessories ?? '', input.notes ?? '', input.status ?? 'RASCUNHO', input.isDemo ? 1 : 0);
    const id = Number(r.lastInsertRowid);
    for (const s of input.sizes) {
      db.prepare('INSERT INTO product_sizes(product_id,size_code) VALUES(?,?)').run(id, s.size);
      db.prepare('INSERT INTO inventory(product_id,size_code,total_stock) VALUES(?,?,?)').run(id, s.size, s.stock);
    }
    return id;
  });
}

/** Adiciona um tamanho que o produto ainda não possui. */
export function addSize(db: DB, productId: number, size: SizeCode, stock: number): void {
  validateSizes([{ size, stock }]);
  tx(db, () => {
    if (db.prepare('SELECT 1 FROM product_sizes WHERE product_id=? AND size_code=?').get(productId, size))
      throw new DomainError('CONFLICT', `O traje já possui o tamanho ${size}.`);
    db.prepare('INSERT INTO product_sizes(product_id,size_code) VALUES(?,?)').run(productId, size);
    db.prepare('INSERT INTO inventory(product_id,size_code,total_stock) VALUES(?,?,?)').run(productId, size, stock);
  });
}

/** Remove um tamanho — somente se nunca foi usado em reserva nem manutenção. */
export function removeSize(db: DB, productId: number, size: SizeCode): void {
  tx(db, () => {
    const used = db.prepare('SELECT 1 FROM reservation_items WHERE product_id=? AND size_code=? LIMIT 1').get(productId, size)
      || db.prepare('SELECT 1 FROM maintenance WHERE product_id=? AND size_code=? LIMIT 1').get(productId, size);
    if (used) throw new DomainError('CONFLICT', `O tamanho ${size} possui histórico de reservas e não pode ser removido. Zere o estoque dele.`);
    db.prepare('DELETE FROM product_sizes WHERE product_id=? AND size_code=?').run(productId, size);
  });
}

/**
 * O admin edita SOMENTE o estoque total. Não permite reduzir abaixo do que já está
 * comprometido (maior ocupação futura + manutenção), evitando overbooking retroativo.
 */
export function setTotalStock(db: DB, productId: number, size: SizeCode, newTotal: number, today: string): void {
  if (!Number.isInteger(newTotal) || newTotal < 0 || newTotal > 10_000) throw new DomainError('VALIDATION', 'Estoque total inválido.');
  tx(db, () => {
    const maint = openMaintenance(db, productId, size);
    const peak = futurePeak(db, productId, size, today);
    if (newTotal < maint + peak)
      throw new DomainError('CONFLICT', `Não é possível reduzir para ${newTotal}: ${peak} unidade(s) estão comprometidas em reservas e ${maint} em manutenção.`);
    const r = db.prepare('UPDATE inventory SET total_stock=? WHERE product_id=? AND size_code=?').run(newTotal, productId, size);
    if (r.changes === 0) throw new DomainError('VALIDATION', 'Este traje não possui o tamanho informado.');
  });
}

export interface ProductView {
  id: number; slug: string; name: string; category: CategoryCode; description: string;
  includedPieces: string; accessories: string; notes: string; status: string; isDemo: boolean;
  sizes: SizeCode[]; primaryImage: string | null; images: Array<{ id: number; path: string; alt: string; isPrimary: boolean }>;
}

function hydrate(db: DB, row: any): ProductView {
  const sizes = (db.prepare('SELECT size_code AS s FROM product_sizes WHERE product_id=?').all(row.id) as { s: SizeCode }[]).map((r) => r.s);
  const images = (db.prepare('SELECT id,path,alt,is_primary AS p FROM product_images WHERE product_id=? ORDER BY is_primary DESC, position, id').all(row.id) as any[])
    .map((i) => ({ id: i.id, path: i.path, alt: i.alt, isPrimary: !!i.p }));
  return {
    id: row.id, slug: row.slug, name: row.name, category: row.category, description: row.description,
    includedPieces: row.included_pieces, accessories: row.accessories, notes: row.notes, status: row.status,
    isDemo: !!row.is_demo, sizes: sortSizes(sizes), images,
    primaryImage: images[0]?.path ?? null,   // null => frontend exibe placeholder neutro, nunca foto genérica
  };
}

export function listProducts(db: DB, opts: { category?: CategoryCode; onlyActive?: boolean } = {}): ProductView[] {
  const rows = db.prepare(`SELECT p.*, c.code AS category FROM products p JOIN categories c ON c.id=p.category_id
     WHERE (? IS NULL OR c.code=?) AND (?=0 OR p.status='ATIVO') ORDER BY p.name`)
    .all(opts.category ?? null, opts.category ?? null, opts.onlyActive ? 1 : 0);
  return rows.map((r) => hydrate(db, r));
}
export function getProductBySlug(db: DB, slug: string): ProductView | null {
  const row = db.prepare(`SELECT p.*, c.code AS category FROM products p JOIN categories c ON c.id=p.category_id WHERE p.slug=?`).get(slug);
  return row ? hydrate(db, row) : null;
}

/** Disponibilidade pública por tamanho (somente números; nada administrativo). */
export function productSizeAvailability(db: DB, productId: number, period: { from: string; to: string }, today: string) {
  const sizes = db.prepare('SELECT size_code AS s FROM product_sizes WHERE product_id=?').all(productId) as { s: SizeCode }[];
  return sortSizes(sizes.map((s) => s.s)).map((size) => ({
    size, available: getAvailability(db, { productId, size, ...period, today }).available,
  }));
}

/** Visão administrativa por produto + tamanho. */
export function adminStock(db: DB, productId: number, asOf: string, today: string) {
  const sizes = db.prepare('SELECT size_code AS s FROM product_sizes WHERE product_id=?').all(productId) as { s: SizeCode }[];
  return sortSizes(sizes.map((s) => s.s)).map((size) => ({ size, ...getStockBreakdown(db, productId, size, asOf, today) }));
}

// ---- Imagens (somente metadados; o upload de arquivo é feito na camada de API) ----
export function addProductImage(db: DB, productId: number, path: string, alt = ''): number {
  return tx(db, () => {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM product_images WHERE product_id=?').get(productId) as { c: number }).c;
    const r = db.prepare('INSERT INTO product_images(product_id,path,alt,position,is_primary) VALUES(?,?,?,?,?)').run(productId, path, alt, count, count === 0 ? 1 : 0);
    return Number(r.lastInsertRowid);
  });
}
export function setPrimaryImage(db: DB, productId: number, imageId: number): void {
  tx(db, () => {
    if (!db.prepare('SELECT 1 FROM product_images WHERE id=? AND product_id=?').get(imageId, productId))
      throw new DomainError('NOT_FOUND', 'Imagem não pertence a este traje.');
    db.prepare('UPDATE product_images SET is_primary=0 WHERE product_id=?').run(productId);
    db.prepare('UPDATE product_images SET is_primary=1 WHERE id=?').run(imageId);
  });
}
export function reorderImages(db: DB, productId: number, orderedIds: number[]): void {
  tx(db, () => orderedIds.forEach((id, i) =>
    db.prepare('UPDATE product_images SET position=? WHERE id=? AND product_id=?').run(i, id, productId)));
}
export function deleteImage(db: DB, productId: number, imageId: number): void {
  tx(db, () => {
    const img = db.prepare('SELECT is_primary AS p FROM product_images WHERE id=? AND product_id=?').get(imageId, productId) as { p: number } | undefined;
    if (!img) throw new DomainError('NOT_FOUND', 'Imagem não encontrada.');
    db.prepare('DELETE FROM product_images WHERE id=?').run(imageId);
    if (img.p) { // promove a próxima imagem do MESMO produto como principal
      const next = db.prepare('SELECT id FROM product_images WHERE product_id=? ORDER BY position,id LIMIT 1').get(productId) as { id: number } | undefined;
      if (next) db.prepare('UPDATE product_images SET is_primary=1 WHERE id=?').run(next.id);
    }
  });
}
