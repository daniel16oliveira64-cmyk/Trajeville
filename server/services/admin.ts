import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { DomainError } from '../domain/errors.ts';
import { addDays, formatBR, isIsoDate } from '../domain/dates.ts';
import {
  IN_POSSESSION_STATUSES, PENDING_STATUSES, RESERVED_STATUSES, STATUSES, sortSizes,
  type SizeCode, type Status,
} from '../domain/constants.ts';
import { getStockBreakdown } from '../domain/availability.ts';
import { getReservation, type ReservationView } from './reservations.ts';
import { refreshOverdue } from './operations.ts';
import { getSetting } from './settings.ts';

const ph = (a: unknown[]) => a.map(() => '?').join(',');

// ---------------- DASHBOARD ----------------
export function dashboard(db: DB, today: string) {
  refreshOverdue(db, { today });
  const count = (statuses: Status[]) =>
    (db.prepare(`SELECT COUNT(*) c FROM reservations WHERE status IN (${ph(statuses)})`).get(...statuses) as { c: number }).c;
  const brief = (rows: { id: number }[]) => rows.map((r) => getReservation(db, r.id, today));

  const products = db.prepare(`SELECT id FROM products WHERE status<>'RASCUNHO'`).all() as { id: number }[];
  let availableToday = 0;
  for (const p of products)
    for (const s of db.prepare('SELECT size_code s FROM product_sizes WHERE product_id=?').all(p.id) as { s: SizeCode }[])
      availableToday += getStockBreakdown(db, p.id, s.s, today, today).available;

  return {
    today,
    pending: count(PENDING_STATUSES),
    confirmed: count(RESERVED_STATUSES),
    ready: count(['PRONTO_PARA_RETIRADA']),
    upcomingFittings: db.prepare(`SELECT f.id, f.scheduled_date date, f.scheduled_time time, f.reservation_id reservationId, c.name customer, r.code
      FROM fittings f JOIN reservations r ON r.id=f.reservation_id JOIN customers c ON c.id=r.customer_id
      WHERE f.status='AGENDADA' AND f.scheduled_date>=? AND f.scheduled_date<=? ORDER BY f.scheduled_date, f.scheduled_time`).all(today, addDays(today, 7)),
    pendingAdjustments: (db.prepare(`SELECT COUNT(*) c FROM adjustments WHERE status<>'CONCLUIDO'`).get() as { c: number }).c,
    maintenanceUnits: (db.prepare(`SELECT COALESCE(SUM(quantity),0) c FROM maintenance WHERE status='EM_MANUTENCAO'`).get() as { c: number }).c,
    availableToday,
    pickupsToday: brief(db.prepare(`SELECT id FROM reservations WHERE pickup_date=? AND status IN (${ph(RESERVED_STATUSES)}) ORDER BY id`).all(today, ...RESERVED_STATUSES) as any),
    returnsToday: brief(db.prepare(`SELECT id FROM reservations WHERE return_date=? AND status IN (${ph(IN_POSSESSION_STATUSES)}) ORDER BY id`).all(today, ...IN_POSSESSION_STATUSES) as any),
    overdue: brief(db.prepare(`SELECT id FROM reservations WHERE return_date<? AND status IN (${ph(IN_POSSESSION_STATUSES)})
      AND EXISTS (SELECT 1 FROM reservation_items WHERE reservation_id=reservations.id AND returned_at IS NULL) ORDER BY return_date`).all(today, ...IN_POSSESSION_STATUSES) as any),
  };
}

// ---------------- RESERVAS (consulta admin) ----------------
export function searchReservations(db: DB, f: { status?: string; q?: string; from?: string; to?: string; overdueOnly?: boolean }, today: string): ReservationView[] {
  if (f.status && !(STATUSES as readonly string[]).includes(f.status)) throw new DomainError('VALIDATION', 'Status inválido.');
  for (const d of [f.from, f.to]) if (d && !isIsoDate(d)) throw new DomainError('VALIDATION', 'Data inválida.');
  const q = f.q ? `%${f.q.trim().replace(/[%_]/g, '')}%` : null;
  const rows = db.prepare(`SELECT r.id FROM reservations r JOIN customers c ON c.id=r.customer_id
    WHERE (? IS NULL OR r.status=?) AND (? IS NULL OR r.return_date>=?) AND (? IS NULL OR r.pickup_date<=?)
      AND (? IS NULL OR c.name LIKE ? OR r.code LIKE ? OR c.whatsapp LIKE ?)
    ORDER BY r.created_at DESC, r.id DESC LIMIT 500`)
    .all(f.status ?? null, f.status ?? null, f.from ?? null, f.from ?? null, f.to ?? null, f.to ?? null, q, q, q, q) as { id: number }[];
  const list = rows.map((r) => getReservation(db, r.id, today));
  return f.overdueOnly ? list.filter((r) => r.overdue) : list;
}

export function reservationDetail(db: DB, id: number, today: string) {
  const base = getReservation(db, id, today);
  return {
    ...base,
    fittings: db.prepare('SELECT * FROM fittings WHERE reservation_id=? ORDER BY scheduled_date, scheduled_time').all(id),
    adjustments: db.prepare(`SELECT a.*, p.name product_name, ri.size_code FROM adjustments a JOIN reservation_items ri ON ri.id=a.item_id
      JOIN products p ON p.id=ri.product_id WHERE a.reservation_id=? ORDER BY a.id`).all(id),
    events: db.prepare('SELECT * FROM reservation_events WHERE reservation_id=? ORDER BY id').all(id),
    returns: db.prepare(`SELECT rt.* FROM returns rt JOIN reservation_items ri ON ri.id=rt.reservation_item_id WHERE ri.reservation_id=?`).all(id),
    maintenance: db.prepare(`SELECT m.* FROM maintenance m JOIN reservation_items ri ON ri.id=m.reservation_item_id WHERE ri.reservation_id=?`).all(id),
  };
}

// ---------------- CALENDÁRIO ----------------
export function calendar(db: DB, from: string, to: string, today: string, filters: { status?: string; productId?: number } = {}) {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw new DomainError('DATES', 'Período inválido.');
  if (new Date(to).getTime() - new Date(from).getTime() > 62 * 86_400_000) throw new DomainError('DATES', 'Período muito longo para o calendário.');
  const rows = db.prepare(`SELECT r.id reservationId, r.code, r.status, r.event_date eventDate, r.pickup_date pickupDate, r.return_date returnDate,
      c.name customer, p.id productId, p.name product, ri.size_code size, ri.quantity, ri.participant_name participant,
      (r.status IN (${ph(IN_POSSESSION_STATUSES)}) AND ri.returned_at IS NULL AND r.return_date<?) overdue
    FROM reservations r JOIN customers c ON c.id=r.customer_id JOIN reservation_items ri ON ri.reservation_id=r.id JOIN products p ON p.id=ri.product_id
    WHERE r.pickup_date<=? AND r.return_date>=? AND r.status<>'CANCELADA'
      AND (? IS NULL OR r.status=?) AND (? IS NULL OR p.id=?)
    ORDER BY r.pickup_date, r.id`)
    .all(...IN_POSSESSION_STATUSES, today, to, from, filters.status ?? null, filters.status ?? null, filters.productId ?? null, filters.productId ?? null) as any[];
  const fittings = db.prepare(`SELECT f.id, f.reservation_id reservationId, f.scheduled_date date, f.scheduled_time time, f.status, c.name customer, r.code
    FROM fittings f JOIN reservations r ON r.id=f.reservation_id JOIN customers c ON c.id=r.customer_id
    WHERE f.scheduled_date>=? AND f.scheduled_date<=? AND f.status<>'CANCELADA' ORDER BY f.scheduled_date, f.scheduled_time`).all(from, to);
  return { from, to, entries: rows.map((r) => ({ ...r, overdue: !!r.overdue })), fittings };
}

// ---------------- ESTOQUE / PRODUTOS (visão admin) ----------------
export function stockOverview(db: DB, asOf: string, today: string) {
  if (!isIsoDate(asOf)) throw new DomainError('DATES', 'Data inválida.');
  const products = db.prepare(`SELECT p.id, p.name, p.status, p.is_demo isDemo, c.code category FROM products p JOIN categories c ON c.id=p.category_id ORDER BY p.name`).all() as any[];
  return products.map((p) => {
    const sizes = (db.prepare('SELECT size_code s FROM product_sizes WHERE product_id=?').all(p.id) as { s: SizeCode }[]).map((x) => x.s);
    return { ...p, isDemo: !!p.isDemo, sizes: sortSizes(sizes).map((size) => ({ size, ...getStockBreakdown(db, p.id, size, asOf, today) })) };
  });
}

export interface ProductPatch { name?: string; category?: 'FEMININO' | 'MASCULINO'; description?: string; includedPieces?: string; accessories?: string; notes?: string; status?: string; isDemo?: boolean }
export function updateProduct(db: DB, id: number, p: ProductPatch): void {
  tx(db, () => {
    if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(id)) throw new DomainError('NOT_FOUND', 'Traje não encontrado.');
    if (p.name !== undefined) {
      const n = p.name.trim();
      if (n.length < 3 || n.length > 120) throw new DomainError('VALIDATION', 'Informe um nome entre 3 e 120 caracteres.');
      db.prepare('UPDATE products SET name=? WHERE id=?').run(n, id);
    }
    if (p.category !== undefined) {
      const c = db.prepare('SELECT id FROM categories WHERE code=?').get(p.category) as { id: number } | undefined;
      if (!c) throw new DomainError('VALIDATION', 'Categoria inválida.');
      db.prepare('UPDATE products SET category_id=? WHERE id=?').run(c.id, id);
    }
    if (p.status !== undefined) {
      if (!['ATIVO', 'INATIVO', 'RASCUNHO'].includes(p.status)) throw new DomainError('VALIDATION', 'Status inválido.');
      db.prepare('UPDATE products SET status=? WHERE id=?').run(p.status, id);
    }
    for (const [k, col] of [['description', 'description'], ['includedPieces', 'included_pieces'], ['accessories', 'accessories'], ['notes', 'notes']] as const)
      if (p[k] !== undefined) db.prepare(`UPDATE products SET ${col}=? WHERE id=?`).run(String(p[k]).slice(0, 4000), id);
    if (p.isDemo !== undefined) db.prepare('UPDATE products SET is_demo=? WHERE id=?').run(p.isDemo ? 1 : 0, id);
  });
}

export function listMaintenance(db: DB, status?: string) {
  return db.prepare(`SELECT m.id, m.product_id productId, p.name product, m.size_code size, m.quantity, m.reason, m.status,
      m.opened_at openedAt, m.released_at releasedAt, m.released_by releasedBy, r.code reservationCode
    FROM maintenance m JOIN products p ON p.id=m.product_id
    LEFT JOIN reservation_items ri ON ri.id=m.reservation_item_id LEFT JOIN reservations r ON r.id=ri.reservation_id
    WHERE (? IS NULL OR m.status=?) ORDER BY (m.status='EM_MANUTENCAO') DESC, m.id DESC LIMIT 300`).all(status ?? null, status ?? null);
}

// ---------------- CLIENTES ----------------
export function listCustomers(db: DB, q?: string) {
  const like = q ? `%${q.trim().replace(/[%_]/g, '')}%` : null;
  return db.prepare(`SELECT c.id, c.name, c.whatsapp, c.email, c.notes, COUNT(r.id) reservations, MAX(r.created_at) lastReservation
    FROM customers c LEFT JOIN reservations r ON r.customer_id=c.id
    WHERE (? IS NULL OR c.name LIKE ? OR c.whatsapp LIKE ? OR c.email LIKE ?) GROUP BY c.id ORDER BY c.name LIMIT 500`).all(like, like, like, like);
}
export function customerDetail(db: DB, id: number, today: string) {
  const c = db.prepare('SELECT id,name,whatsapp,email,notes,created_at createdAt FROM customers WHERE id=?').get(id) as any;
  if (!c) throw new DomainError('NOT_FOUND', 'Cliente não encontrado.');
  const ids = db.prepare('SELECT id FROM reservations WHERE customer_id=? ORDER BY created_at DESC, id DESC').all(id) as { id: number }[];
  return { ...c, history: ids.map((r) => getReservation(db, r.id, today)) };
}
export function updateCustomer(db: DB, id: number, p: { name?: string; email?: string | null; notes?: string }): void {
  if (p.name !== undefined && (p.name.trim().length < 2 || p.name.length > 120)) throw new DomainError('VALIDATION', 'Informe um nome válido.');
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) throw new DomainError('VALIDATION', 'E-mail inválido.');
  const r = db.prepare('UPDATE customers SET name=COALESCE(?,name), email=CASE WHEN ? THEN ? ELSE email END, notes=COALESCE(?,notes) WHERE id=?')
    .run(p.name?.trim() ?? null, p.email !== undefined ? 1 : 0, p.email?.trim() || null, p.notes?.slice(0, 2000) ?? null, id);
  if (r.changes === 0) throw new DomainError('NOT_FOUND', 'Cliente não encontrado.');
}

// ---------------- FAQ ----------------
export const DEFAULT_FAQS: Array<[string, string]> = [
  ['Como funciona a locação?', 'A Trajeville trabalha com locação, não com venda. Você escolhe o traje, o tamanho e as datas, envia a solicitação, e nossa equipe confirma a disponibilidade. Depois fazemos a prova presencial, os ajustes necessários, e você retira o traje para o evento e devolve na data combinada.'],
  ['Posso experimentar o traje?', 'Sim. A prova é presencial, na Trajeville, depois que a reserva é confirmada. Se algum ajuste for necessário, ele é feito antes da retirada.'],
  ['Quais tamanhos existem?', 'Trabalhamos com PP, P, M, G, GG, XG e XXG, tanto no feminino quanto no masculino. Cada traje tem apenas os tamanhos cadastrados para ele, e a página do traje mostra exatamente quais são.'],
  ['Posso reservar para uma data futura?', 'Sim. Informe a data do evento, a retirada e a devolução, e o sistema mostra a disponibilidade para esse período.'],
  ['Quando retiro o traje?', 'Na data de retirada escolhida na solicitação, depois de confirmada a reserva e concluídos prova e ajustes. Combinamos os detalhes pelo WhatsApp.'],
  ['Quando devolvo o traje?', 'Na data de devolução informada na solicitação. O traje fica reservado para você durante todo o período, da retirada até a devolução.'],
  ['O traje pode ser ajustado?', 'Sim, quando necessário. Os ajustes são feitos depois da prova e antes da retirada.'],
  ['Vocês fazem locação para grupos?', 'Sim. Em uma única solicitação você pode incluir várias pessoas, cada uma com seu traje e tamanho, compartilhando as mesmas datas. Só enviamos a solicitação se todas as peças estiverem disponíveis.'],
  ['Como funciona a reserva?', 'Você envia uma solicitação pelo site. Ela fica em análise até a Trajeville confirmar. Enquanto está pendente, as peças podem ficar reservadas para você, conforme a disponibilidade.'],
  ['Como funciona o cancelamento?', 'A solicitação pode ser cancelada antes da retirada e as peças voltam a ficar disponíveis. Fale com a Trajeville pelo WhatsApp para cancelar e conhecer as condições.'],
];
export function ensureDefaultFaqs(db: DB): void {
  if ((db.prepare('SELECT COUNT(*) c FROM faqs').get() as { c: number }).c > 0) return;
  DEFAULT_FAQS.forEach(([q, a], i) => db.prepare('INSERT INTO faqs(question,answer,position) VALUES(?,?,?)').run(q, a, i));
}
export const listFaqs = (db: DB, onlyPublished: boolean) =>
  db.prepare('SELECT id,question,answer,position,published FROM faqs WHERE (?=0 OR published=1) ORDER BY position,id').all(onlyPublished ? 1 : 0)
    .map((f: any) => ({ ...f, published: !!f.published }));
export function saveFaq(db: DB, id: number | null, f: { question: string; answer: string; position?: number; published?: boolean }): number {
  const question = (f.question ?? '').trim(), answer = (f.answer ?? '').trim();
  if (question.length < 3 || question.length > 200) throw new DomainError('VALIDATION', 'Informe a pergunta.');
  if (answer.length < 3 || answer.length > 4000) throw new DomainError('VALIDATION', 'Informe a resposta.');
  if (id === null) return Number(db.prepare('INSERT INTO faqs(question,answer,position,published) VALUES(?,?,?,?)').run(question, answer, f.position ?? 999, f.published === false ? 0 : 1).lastInsertRowid);
  const r = db.prepare('UPDATE faqs SET question=?, answer=?, position=COALESCE(?,position), published=? WHERE id=?').run(question, answer, f.position ?? null, f.published === false ? 0 : 1, id);
  if (r.changes === 0) throw new DomainError('NOT_FOUND', 'Pergunta não encontrada.');
  return id;
}
export const deleteFaq = (db: DB, id: number) => { db.prepare('DELETE FROM faqs WHERE id=?').run(id); };

// ---------------- GALERIA (somente fotos reais) ----------------
export const listGallery = (db: DB) => db.prepare('SELECT id,path,caption,position FROM gallery ORDER BY position,id').all();
export function addGalleryImage(db: DB, path: string, caption = ''): number {
  const pos = (db.prepare('SELECT COUNT(*) c FROM gallery').get() as { c: number }).c;
  return Number(db.prepare('INSERT INTO gallery(path,caption,position) VALUES(?,?,?)').run(path, caption.slice(0, 200), pos).lastInsertRowid);
}
export const updateGalleryCaption = (db: DB, id: number, caption: string) => { db.prepare('UPDATE gallery SET caption=? WHERE id=?').run(caption.slice(0, 200), id); };
export function deleteGalleryImage(db: DB, id: number): string | null {
  const g = db.prepare('SELECT path FROM gallery WHERE id=?').get(id) as { path: string } | undefined;
  db.prepare('DELETE FROM gallery WHERE id=?').run(id);
  return g?.path ?? null;
}

// ---------------- WHATSAPP ----------------
export const normalizeWhatsapp = (raw: string): string => {
  const d = raw.replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? '55' + d : d;   // só acrescenta o DDI do Brasil; nunca inventa número
};
export function whatsappFor(db: DB, r: { code: string; customerName: string; eventDate: string; pickupDate: string; returnDate: string;
  items: Array<{ productName: string; size: string; quantity: number; participantName?: string | null }> }) {
  const lines = [
    'Olá! Gostaria de falar sobre minha solicitação de locação na Trajeville.', '',
    `Código: ${r.code}`, `Nome: ${r.customerName}`,
    ...r.items.map((i) => `Traje: ${i.productName} — Tamanho ${i.size}${i.quantity > 1 ? ` (${i.quantity} un.)` : ''}${i.participantName ? ` — ${i.participantName}` : ''}`),
    `Evento: ${formatBR(r.eventDate)}`, `Retirada: ${formatBR(r.pickupDate)}`, `Devolução: ${formatBR(r.returnDate)}`,
  ];
  const message = lines.join('\n');
  const number = normalizeWhatsapp(getSetting(db, 'whatsapp_number'));
  return { configured: number.length >= 12, message, url: number.length >= 12 ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null };
}
