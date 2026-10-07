import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { DB } from '../db/connection.ts';
import { DomainError } from '../domain/errors.ts';
import { isIsoDate, todayISO } from '../domain/dates.ts';
import { CATEGORIES, isSize, type SizeCode, type Status } from '../domain/constants.ts';
import { getAvailability, getStockBreakdown } from '../domain/availability.ts';
import { login, verifySession, type Session } from '../auth/auth.ts';
import { SETTING_DEFAULTS, getSetting, setSetting } from '../services/settings.ts';
import {
  addProductImage, addSize, createProduct, deleteImage, getProductBySlug, listProducts, removeSize,
  reorderImages, setPrimaryImage, setTotalStock, type ProductView,
} from '../services/catalog.ts';
import { cancelReservation, createReservation, setStatus } from '../services/reservations.ts';
import {
  addAdjustment, completeFitting, refreshOverdue, registerReturn, releaseMaintenance, scheduleFitting,
  sendToMaintenance, updateAdjustment,
} from '../services/operations.ts';
import * as admin from '../services/admin.ts';
import { HttpError, MIME, createLimiter, parseCookies, readBody, sniffImage, statusOf } from './util.ts';
import { metaFor, renderHead, robots, sitemap } from './seo.ts';

export interface AppOptions {
  db: DB; secret: string; uploadDir: string; webDir?: string;
  secure?: boolean; trustProxy?: boolean; siteUrl?: string; now?: () => Date; reserveLimitPerHour?: number;
}

interface Ctx {
  req: IncomingMessage; res: ServerResponse; db: DB; today: string; params: Record<string, string>;
  query: URLSearchParams; session: Session | null; ip: string; origin: string; status: number;
  json(): Promise<any>; raw(limit: number): Promise<Buffer>; setCookie(v: string): void;
}
type Handler = (c: Ctx) => unknown | Promise<unknown>;
interface Route { method: string; re: RegExp; keys: string[]; handler: Handler; auth: 'none' | 'staff' | 'admin' }

const SESSION_COOKIE = 'tjv_session';
const SESSION_TTL = 8 * 3600_000;

// ---------- helpers de validação ----------
const str = (v: unknown, field: string, max = 500, required = false): string => {
  if (v === undefined || v === null || v === '') { if (required) throw new DomainError('VALIDATION', `Informe ${field}.`); return ''; }
  if (typeof v !== 'string') throw new DomainError('VALIDATION', `Valor inválido para ${field}.`);
  if (v.length > max) throw new DomainError('VALIDATION', `${field} é longo demais.`);
  return v;
};
const int = (v: unknown, field: string): number => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new DomainError('VALIDATION', `Valor inválido para ${field}.`);
  return n;
};
const pid = (c: Ctx, k = 'id') => { const n = Number(c.params[k]); if (!Number.isInteger(n) || n < 1) throw new DomainError('NOT_FOUND', 'Registro não encontrado.'); return n; };
const sizeParam = (v: unknown): SizeCode => { if (!isSize(v)) throw new DomainError('VALIDATION', 'Tamanho inválido. Use PP, P, M, G, GG, XG ou XXG.'); return v; };
const obj = (v: unknown): Record<string, any> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new DomainError('VALIDATION', 'Corpo da requisição inválido.'); return v as any; };

export function createApp(opts: AppOptions) {
  const { db } = opts;
  const now = opts.now ?? (() => new Date());
  const routes: Route[] = [];
  const loginIp = createLimiter(20, 15 * 60_000);
  const loginEmail = createLimiter(5, 15 * 60_000);
  const reserveIp = createLimiter(opts.reserveLimitPerHour ?? 12, 60 * 60_000);
  mkdirSync(opts.uploadDir, { recursive: true });
  const uploadRoot = resolve(opts.uploadDir);

  const add = (method: string, path: string, auth: Route['auth'], handler: Handler) => {
    const keys: string[] = [];
    const re = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler, auth });
  };
  const pub = (m: string, p: string, h: Handler) => add(m, p, 'none', h);
  const staff = (m: string, p: string, h: Handler) => add(m, p, 'staff', h);
  const adminOnly = (m: string, p: string, h: Handler) => add(m, p, 'admin', h);

  // ---------- visão pública de produto (nunca expõe estoque total nem dados internos) ----------
  const publicProduct = (p: ProductView, today: string, period?: { from: string; to: string }) => ({
    id: p.id, slug: p.slug, name: p.name, category: p.category, description: p.description,
    includedPieces: p.includedPieces, accessories: p.accessories, notes: p.notes, isDemo: p.isDemo,
    primaryImage: p.primaryImage, images: p.images.map((i) => ({ id: i.id, path: i.path, alt: i.alt || p.name })),
    sizes: p.sizes.map((size) => {
      const a = getAvailability(db, { productId: p.id, size, from: period?.from ?? today, to: period?.to ?? today, today });
      return { size, inStock: a.total - a.maintenance > 0, available: period ? a.available : undefined };
    }),
  });
  const periodFrom = (q: URLSearchParams) => {
    const from = q.get('from'), to = q.get('to');
    if (!from && !to) return undefined;
    if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw new DomainError('DATES', 'Período inválido.');
    return { from, to };
  };
  const publicSettings = () => {
    const keys = ['business_name', 'instagram_url', 'whatsapp_number', 'address', 'opening_hours', 'hero_image', 'logo_image',
      'policy_fitting', 'policy_pickup', 'policy_return', 'policy_reservation', 'policy_cancellation'];
    return Object.fromEntries(keys.map((k) => [k, getSetting(db, k)]));
  };

  // ================= PÚBLICO =================
  pub('GET', '/api/public/settings', () => publicSettings());
  pub('GET', '/api/public/faqs', () => admin.listFaqs(db, true));
  pub('GET', '/api/public/gallery', () => admin.listGallery(db));
  pub('GET', '/api/public/products', (c) => {
    const cat = c.query.get('category');
    if (cat && !(CATEGORIES as readonly string[]).includes(cat)) throw new DomainError('VALIDATION', 'Categoria inválida.');
    const period = periodFrom(c.query);
    return listProducts(db, { category: (cat as any) ?? undefined, onlyActive: true }).map((p) => publicProduct(p, c.today, period));
  });
  pub('GET', '/api/public/products/:slug', (c) => {
    const p = getProductBySlug(db, c.params.slug!);
    if (!p || p.status !== 'ATIVO') throw new DomainError('NOT_FOUND', 'Traje não encontrado.');
    return publicProduct(p, c.today, periodFrom(c.query));
  });
  pub('POST', '/api/public/reservations', async (c) => {
    if (!reserveIp.take(c.ip)) throw new HttpError(429, 'Muitas solicitações em pouco tempo. Tente novamente mais tarde ou fale conosco pelo WhatsApp.', 'RATE_LIMIT');
    const b = obj(await c.json());
    if (b.website) { c.status = 201; return { code: 'TJV-00000000', whatsapp: { configured: false, message: '', url: null } }; }   // honeypot: finge sucesso
    const cust = obj(b.customer);
    if (!Array.isArray(b.items)) throw new DomainError('VALIDATION', 'Escolha ao menos um traje.');
    const items = b.items.map((i: any) => {
      const it = obj(i);
      return { productId: it.productId, size: sizeParam(it.size), quantity: it.quantity,
        participantName: str(it.participantName, 'o nome do participante', 120) || undefined };
    });
    const input = {
      customer: { name: str(cust.name, 'seu nome', 120, true), whatsapp: str(cust.whatsapp, 'seu WhatsApp', 30, true),
        email: str(cust.email, 'seu e-mail', 160) || undefined },
      eventDate: str(b.eventDate, 'a data do evento', 10, true), pickupDate: str(b.pickupDate, 'a data de retirada', 10, true),
      returnDate: str(b.returnDate, 'a data de devolução', 10, true), items,
      groupName: str(b.groupName, 'o nome do grupo', 120) || undefined, notes: str(b.notes, 'as observações', 2000) || undefined,
    };
    const r = createReservation(db, input, { today: c.today });
    const names = new Map<number, string>();
    for (const it of items) if (!names.has(it.productId)) names.set(it.productId, (db.prepare('SELECT name FROM products WHERE id=?').get(it.productId) as { name: string }).name);
    c.status = 201;
    return {
      code: r.code,
      summary: { eventDate: input.eventDate, pickupDate: input.pickupDate, returnDate: input.returnDate, groupName: input.groupName ?? null,
        items: items.map((i) => ({ productName: names.get(i.productId)!, size: i.size, quantity: i.quantity, participantName: i.participantName ?? null })) },
      whatsapp: admin.whatsappFor(db, { code: r.code, customerName: input.customer.name, eventDate: input.eventDate, pickupDate: input.pickupDate,
        returnDate: input.returnDate, items: items.map((i) => ({ productName: names.get(i.productId)!, size: i.size, quantity: i.quantity, participantName: i.participantName })) }),
    };
  });
  /** Verificação em tempo real (apenas informativa). A validação definitiva ocorre atomicamente no POST. */
  pub('POST', '/api/public/check', async (c) => {
    const b = obj(await c.json());
    if (!isIsoDate(b.pickupDate) || !isIsoDate(b.returnDate) || b.returnDate < b.pickupDate) throw new DomainError('DATES', 'Período inválido.');
    if (!Array.isArray(b.items) || b.items.length > 40) throw new DomainError('VALIDATION', 'Itens inválidos.');
    const agg = new Map<string, { productId: number; size: SizeCode; quantity: number }>();
    for (const i of b.items) {
      const it = obj(i); const size = sizeParam(it.size);
      const productId = int(it.productId, 'traje'); const quantity = int(it.quantity, 'quantidade');
      const k = `${productId}|${size}`; agg.set(k, { productId, size, quantity: (agg.get(k)?.quantity ?? 0) + quantity });
    }
    const lines = [...agg.values()].map((l) => {
      const a = getAvailability(db, { productId: l.productId, size: l.size, from: b.pickupDate, to: b.returnDate, today: c.today });
      return { ...l, available: a.available, ok: l.quantity <= a.available };
    });
    return { ok: lines.every((l) => l.ok), lines };
  });

  // ================= AUTENTICAÇÃO =================
  pub('POST', '/api/admin/login', async (c) => {
    const b = obj(await c.json());
    const email = str(b.email, 'o e-mail', 200, true).toLowerCase();
    if (!loginIp.take(c.ip) || !loginEmail.take(email)) throw new HttpError(429, 'Muitas tentativas de login. Aguarde alguns minutos.', 'RATE_LIMIT');
    const r = login(db, email, str(b.password, 'a senha', 200, true), opts.secret, SESSION_TTL, now().getTime());
    loginEmail.reset(email);
    c.setCookie(`${SESSION_COOKIE}=${r.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${opts.secure ? '; Secure' : ''}`);
    return { user: r.user };
  });
  pub('POST', '/api/admin/logout', (c) => {
    c.setCookie(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${opts.secure ? '; Secure' : ''}`);
    return { ok: true };
  });
  staff('GET', '/api/admin/me', (c) => {
    const u = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(c.session!.uid);
    return { user: u };
  });

  // ================= ADMIN =================
  staff('GET', '/api/admin/dashboard', (c) => admin.dashboard(db, c.today));
  staff('POST', '/api/admin/refresh-overdue', (c) => ({ flagged: refreshOverdue(db, { today: c.today }) }));

  // --- produtos ---
  staff('GET', '/api/admin/products', () => listProducts(db));
  staff('POST', '/api/admin/products', async (c) => {
    const b = obj(await c.json());
    if (!Array.isArray(b.sizes)) throw new DomainError('VALIDATION', 'Selecione ao menos um tamanho.');
    const id = createProduct(db, {
      name: str(b.name, 'o nome', 120, true), category: b.category, description: str(b.description, 'a descrição', 4000),
      includedPieces: str(b.includedPieces, 'as peças', 2000), accessories: str(b.accessories, 'os acessórios', 2000),
      notes: str(b.notes, 'as observações', 2000), status: b.status ?? 'RASCUNHO', isDemo: !!b.isDemo,
      sizes: b.sizes.map((s: any) => ({ size: s?.size, stock: s?.stock })),
    });
    c.status = 201; return { id };
  });
  staff('PUT', '/api/admin/products/:id', async (c) => {
    const b = obj(await c.json());
    admin.updateProduct(db, pid(c), {
      name: b.name, category: b.category, status: b.status, isDemo: b.isDemo,
      description: b.description, includedPieces: b.includedPieces, accessories: b.accessories, notes: b.notes,
    });
    return { ok: true };
  });
  staff('POST', '/api/admin/products/:id/sizes', async (c) => {
    const b = obj(await c.json()); addSize(db, pid(c), sizeParam(b.size), int(b.stock, 'estoque')); c.status = 201; return { ok: true };
  });
  staff('PUT', '/api/admin/products/:id/sizes/:size', async (c) => {
    const b = obj(await c.json()); setTotalStock(db, pid(c), sizeParam(c.params.size), int(b.stock, 'estoque'), c.today); return { ok: true };
  });
  staff('DELETE', '/api/admin/products/:id/sizes/:size', (c) => { removeSize(db, pid(c), sizeParam(c.params.size)); return { ok: true }; });

  // --- imagens (somente fotos reais enviadas pelo admin) ---
  const saveUpload = (buf: Buffer) => {
    const t = sniffImage(buf);
    if (!t) throw new DomainError('VALIDATION', 'Envie uma imagem JPG, PNG ou WebP.');
    const name = randomBytes(16).toString('hex') + '.' + t.ext;
    writeFileSync(join(uploadRoot, name), buf, { flag: 'wx' });
    return '/uploads/' + name;
  };
  const removeUpload = (path: string | null | undefined) => {
    if (!path?.startsWith('/uploads/')) return;
    const f = resolve(uploadRoot, path.slice('/uploads/'.length));
    if (f.startsWith(uploadRoot + sep) && existsSync(f)) try { unlinkSync(f); } catch { /* ignora */ }
  };
  staff('POST', '/api/admin/products/:id/images', async (c) => {
    const id = pid(c);
    if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(id)) throw new DomainError('NOT_FOUND', 'Traje não encontrado.');
    const path = saveUpload(await c.raw(10 * 1024 * 1024));
    const imageId = addProductImage(db, id, path, (c.query.get('alt') ?? '').slice(0, 200));
    c.status = 201; return { id: imageId, path };
  });
  staff('PUT', '/api/admin/products/:id/images-order', async (c) => {
    const b = obj(await c.json()); if (!Array.isArray(b.ids)) throw new DomainError('VALIDATION', 'Ordem inválida.');
    reorderImages(db, pid(c), b.ids.map((i: unknown) => int(i, 'imagem'))); return { ok: true };
  });
  staff('PUT', '/api/admin/products/:id/images/:imageId/primary', (c) => { setPrimaryImage(db, pid(c), pid(c, 'imageId')); return { ok: true }; });
  staff('DELETE', '/api/admin/products/:id/images/:imageId', (c) => {
    const row = db.prepare('SELECT path FROM product_images WHERE id=? AND product_id=?').get(pid(c, 'imageId'), pid(c)) as { path: string } | undefined;
    deleteImage(db, pid(c), pid(c, 'imageId')); removeUpload(row?.path); return { ok: true };
  });

  // --- estoque ---
  staff('GET', '/api/admin/stock', (c) => admin.stockOverview(db, c.query.get('date') ?? c.today, c.today));

  // --- reservas ---
  staff('GET', '/api/admin/reservations', (c) => admin.searchReservations(db, {
    status: c.query.get('status') ?? undefined, q: c.query.get('q') ?? undefined, from: c.query.get('from') ?? undefined,
    to: c.query.get('to') ?? undefined, overdueOnly: c.query.get('overdue') === '1' }, c.today));
  staff('GET', '/api/admin/reservations/:id', (c) => admin.reservationDetail(db, pid(c), c.today));
  staff('POST', '/api/admin/reservations/:id/status', async (c) => {
    const b = obj(await c.json());
    setStatus(db, pid(c), str(b.to, 'o status', 40, true) as Status, { today: c.today, userId: c.session!.uid }, str(b.note, 'a observação', 500));
    return { ok: true };
  });
  staff('POST', '/api/admin/reservations/:id/cancel', async (c) => {
    const b = obj(await c.json().catch(() => ({})));
    cancelReservation(db, pid(c), { today: c.today, userId: c.session!.uid }, str(b.reason, 'o motivo', 500)); return { ok: true };
  });
  staff('POST', '/api/admin/reservations/:id/fittings', async (c) => {
    const b = obj(await c.json());
    const id = scheduleFitting(db, { reservationId: pid(c), itemId: b.itemId ? int(b.itemId, 'item') : undefined, date: str(b.date, 'a data', 10, true),
      time: str(b.time, 'o horário', 5, true), notes: str(b.notes, 'as observações', 500) }, { today: c.today, userId: c.session!.uid });
    c.status = 201; return { id };
  });
  staff('POST', '/api/admin/fittings/:id/complete', async (c) => {
    const b = obj(await c.json());
    completeFitting(db, pid(c), { result: str(b.result, 'o resultado', 500), notes: str(b.notes, 'as observações', 500) || undefined }, { today: c.today, userId: c.session!.uid });
    return { ok: true };
  });
  staff('POST', '/api/admin/reservations/:id/adjustments', async (c) => {
    const b = obj(await c.json());
    const id = addAdjustment(db, { reservationId: pid(c), itemId: int(b.itemId, 'item'), description: str(b.description, 'a descrição', 500, true) }, { today: c.today, userId: c.session!.uid });
    c.status = 201; return { id };
  });
  staff('PUT', '/api/admin/adjustments/:id', async (c) => {
    const b = obj(await c.json());
    if (!['PENDENTE', 'EM_AJUSTE', 'CONCLUIDO'].includes(b.status)) throw new DomainError('VALIDATION', 'Status do ajuste inválido.');
    updateAdjustment(db, pid(c), b.status, { today: c.today, userId: c.session!.uid }); return { ok: true };
  });
  staff('POST', '/api/admin/reservations/:id/return', async (c) => {
    const b = obj(await c.json());
    if (!Array.isArray(b.lines)) throw new DomainError('VALIDATION', 'Selecione os itens devolvidos.');
    const me = db.prepare('SELECT name FROM users WHERE id=?').get(c.session!.uid) as { name: string };
    registerReturn(db, pid(c), {
      checkedBy: str(b.checkedBy, 'o responsável', 120) || me.name, actualDate: b.actualDate || undefined, notes: str(b.notes, 'as observações', 1000),
      lines: b.lines.map((l: any) => ({ itemId: int(l?.itemId, 'item'), condition: l?.condition, maintenanceQuantity: l?.maintenanceQuantity ? int(l.maintenanceQuantity, 'quantidade') : undefined,
        reason: str(l?.reason, 'o motivo', 300), notes: str(l?.notes, 'as observações', 500) })),
    }, { today: c.today, userId: c.session!.uid });
    return { ok: true };
  });

  // --- manutenção ---
  staff('GET', '/api/admin/maintenance', (c) => admin.listMaintenance(db, c.query.get('status') ?? undefined));
  staff('POST', '/api/admin/maintenance', async (c) => {
    const b = obj(await c.json());
    const id = sendToMaintenance(db, { productId: int(b.productId, 'traje'), size: sizeParam(b.size), quantity: int(b.quantity, 'quantidade'), reason: str(b.reason, 'o motivo', 300, true) }, { today: c.today });
    c.status = 201; return { id };
  });
  staff('POST', '/api/admin/maintenance/:id/release', async (c) => {
    const me = db.prepare('SELECT name FROM users WHERE id=?').get(c.session!.uid) as { name: string };
    releaseMaintenance(db, pid(c), me.name, { today: c.today, userId: c.session!.uid }); return { ok: true };
  });

  // --- calendário ---
  staff('GET', '/api/admin/calendar', (c) => admin.calendar(db, c.query.get('from') ?? '', c.query.get('to') ?? '', c.today,
    { status: c.query.get('status') ?? undefined, productId: c.query.get('productId') ? int(c.query.get('productId'), 'traje') : undefined }));

  // --- clientes ---
  staff('GET', '/api/admin/customers', (c) => admin.listCustomers(db, c.query.get('q') ?? undefined));
  staff('GET', '/api/admin/customers/:id', (c) => admin.customerDetail(db, pid(c), c.today));
  staff('PUT', '/api/admin/customers/:id', async (c) => {
    const b = obj(await c.json()); admin.updateCustomer(db, pid(c), { name: b.name, email: b.email, notes: b.notes }); return { ok: true };
  });

  // --- FAQ ---
  staff('GET', '/api/admin/faqs', () => admin.listFaqs(db, false));
  staff('POST', '/api/admin/faqs', async (c) => { const b = obj(await c.json()); c.status = 201; return { id: admin.saveFaq(db, null, b as any) }; });
  staff('PUT', '/api/admin/faqs/:id', async (c) => { const b = obj(await c.json()); admin.saveFaq(db, pid(c), b as any); return { ok: true }; });
  staff('DELETE', '/api/admin/faqs/:id', (c) => { admin.deleteFaq(db, pid(c)); return { ok: true }; });

  // --- galeria ---
  staff('GET', '/api/admin/gallery', () => admin.listGallery(db));
  staff('POST', '/api/admin/gallery', async (c) => {
    const path = saveUpload(await c.raw(10 * 1024 * 1024));
    const id = admin.addGalleryImage(db, path, c.query.get('caption') ?? ''); c.status = 201; return { id, path };
  });
  staff('PUT', '/api/admin/gallery/:id', async (c) => { const b = obj(await c.json()); admin.updateGalleryCaption(db, pid(c), str(b.caption, 'a legenda', 200)); return { ok: true }; });
  staff('DELETE', '/api/admin/gallery/:id', (c) => {
    const path = admin.deleteGalleryImage(db, pid(c));
    for (const k of ['hero_image', 'logo_image']) if (path && getSetting(db, k) === path) setSetting(db, k, '');
    removeUpload(path); return { ok: true };
  });

  // --- configurações ---
  staff('GET', '/api/admin/settings', () => Object.fromEntries(Object.keys(SETTING_DEFAULTS).map((k) => [k, getSetting(db, k)])));
  adminOnly('PUT', '/api/admin/settings', async (c) => {
    const b = obj(await c.json());
    for (const [k, raw] of Object.entries(b)) {
      if (!(k in SETTING_DEFAULTS)) throw new DomainError('VALIDATION', `Configuração desconhecida: ${k}.`);
      let v = str(raw, k, 2000);
      if (k === 'whatsapp_number') { v = v.replace(/\D/g, ''); if (v && (v.length < 10 || v.length > 13)) throw new DomainError('VALIDATION', 'Informe o WhatsApp com DDD (ex.: 47 99999-9999).'); }
      if (k === 'instagram_url' && v && !/^https:\/\/(www\.)?instagram\.com\//.test(v)) throw new DomainError('VALIDATION', 'Informe o link completo do Instagram (https://www.instagram.com/...).');
      if (k === 'block_pending_stock' && v !== 'true' && v !== 'false') throw new DomainError('VALIDATION', 'Valor inválido.');
      if ((k === 'hero_image' || k === 'logo_image') && v && !/^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(v)) throw new DomainError('VALIDATION', 'Escolha uma imagem enviada.');
      setSetting(db, k, v);
    }
    return { ok: true };
  });

  // ================= ESTÁTICOS / SEO =================
  const webDir = opts.webDir ? resolve(opts.webDir) : null;
  const template = () => (webDir && existsSync(join(webDir, 'index.html')) ? readFileSync(join(webDir, 'index.html'), 'utf8') : null);
  const originOf = (req: IncomingMessage) => opts.siteUrl ?? `${opts.secure ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`;

  const SECURITY: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
  if (opts.secure) SECURITY['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';

  const send = (res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}) => {
    res.writeHead(status, { ...SECURITY, ...headers });
    res.end(body);
  };

  function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    if (pathname.startsWith('/uploads/')) {
      const name = pathname.slice('/uploads/'.length);
      if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name)) return false;
      const f = join(uploadRoot, name);
      if (!existsSync(f)) return false;
      send(res, 200, readFileSync(f), { 'Content-Type': MIME[extname(name)]!, 'Cache-Control': 'public, max-age=31536000, immutable' });
      return true;
    }
    if (!webDir) return false;
    const f = normalize(join(webDir, pathname));
    if (!f.startsWith(webDir + sep) || !existsSync(f) || !statSync(f).isFile() || f.endsWith('index.html')) return false;
    send(res, 200, readFileSync(f), {
      'Content-Type': MIME[extname(f)] ?? 'application/octet-stream',
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    });
    return true;
  }

  function servePage(req: IncomingMessage, res: ServerResponse, pathname: string) {
    const tpl = template();
    if (!tpl) return send(res, 503, 'Frontend não compilado. Rode: npm run build', { 'Content-Type': 'text/plain; charset=utf-8' });
    const meta = metaFor(db, pathname, originOf(req));
    send(res, meta.status ?? 200, tpl.replace('<!--SEO-->', renderHead(meta)), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  }

  // ================= DESPACHO =================
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const method = req.method ?? 'GET';
    const ip = opts.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim() || req.socket.remoteAddress || '?' : req.socket.remoteAddress || '?';
    const jsonOut = (status: number, body: unknown, extra: Record<string, string | string[]> = {}) => {
      res.writeHead(status, { ...SECURITY, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } as any);
      res.end(JSON.stringify(body));
    };
    try {
      const { pathname } = url;
      if (pathname.startsWith('/api/')) {
        let matched: { r: Route; params: Record<string, string> } | null = null; let pathHit = false;
        for (const r of routes) {
          const m = r.re.exec(pathname);
          if (!m) continue;
          pathHit = true;
          if (r.method !== method) continue;
          matched = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)])) };
          break;
        }
        if (!matched) throw new HttpError(pathHit ? 405 : 404, pathHit ? 'Método não permitido.' : 'Rota não encontrada.', 'ROUTE');
        const { r, params } = matched;

        // CSRF: mutações do painel exigem cabeçalho customizado + Origin coerente (além do cookie SameSite=Strict)
        if (method !== 'GET' && pathname.startsWith('/api/admin')) {
          if (req.headers['x-requested-with'] !== 'trajeville') throw new HttpError(403, 'Requisição não autorizada.', 'CSRF');
          const origin = req.headers.origin;
          if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Origem não autorizada.', 'CSRF');
        }
        let session: Session | null = null;
        if (r.auth !== 'none') {
          session = verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? '', opts.secret, now().getTime());
          const u = session && (db.prepare('SELECT role FROM users WHERE id=?').get(session.uid) as { role: 'ADMIN' | 'STAFF' } | undefined);
          if (!session || !u) throw new DomainError('UNAUTHENTICATED', 'Faça login para continuar.');
          session = { ...session, role: u.role };
          if (r.auth === 'admin' && u.role !== 'ADMIN') throw new DomainError('FORBIDDEN', 'Apenas administradores podem fazer isso.');
        }
        const cookies: string[] = [];
        const c: Ctx = {
          req, res, db, today: todayISO(now()), params, query: url.searchParams, session, ip, origin: originOf(req), status: 200,
          json: async () => {
            if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Envie os dados em JSON.', 'MEDIA');
            const buf = await readBody(req, 200 * 1024);
            try { return buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw new HttpError(400, 'JSON inválido.', 'JSON'); }
          },
          raw: (limit) => readBody(req, limit),
          setCookie: (v) => cookies.push(v),
        };
        const result = await r.handler(c);
        return jsonOut(c.status, result ?? { ok: true }, cookies.length ? { 'Set-Cookie': cookies } : {});
      }

      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Método não permitido.');
      if (pathname === '/robots.txt') return send(res, 200, robots(originOf(req)), { 'Content-Type': MIME['.txt']! });
      if (pathname === '/sitemap.xml') return send(res, 200, sitemap(db, originOf(req)), { 'Content-Type': MIME['.xml']! });
      if (serveStatic(req, res, pathname)) return;
      if (extname(pathname) && !pathname.endsWith('.html')) return send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
      return servePage(req, res, pathname);
    } catch (e: any) {
      const status = statusOf(e);
      if (status >= 500) console.error('[erro]', e);
      const code = e instanceof DomainError || e instanceof HttpError ? e.code : 'INTERNAL';
      const message = status >= 500 ? 'Erro interno. Tente novamente em instantes.' : e.message;
      if (!res.headersSent) jsonOut(status, { error: { code, message, details: e instanceof DomainError ? e.details : undefined } });
    }
  });
  return server;
}
