import { randomBytes } from 'node:crypto';
import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { DomainError, NOT_ENOUGH_MESSAGE } from '../domain/errors.ts';
import { validateDates } from '../domain/period.ts';
import {
  IN_POSSESSION_STATUSES, MAX_QUANTITY_PER_ITEM, TRANSITIONS, isSize,
  type SizeCode, type Status,
} from '../domain/constants.ts';
import { checkLines } from '../domain/availability.ts';

export interface Ctx { today: string; userId?: number }

export interface ReservationInput {
  customer: { name: string; whatsapp: string; email?: string; notes?: string };
  eventDate: string; pickupDate: string; returnDate: string;
  items: Array<{ productId: number; size: SizeCode; quantity: number; participantName?: string }>;
  groupName?: string; notes?: string;
}

// ---------- validação ----------
export { validateDates };

const digits = (s: string) => (s ?? '').replace(/\D/g, '');
function validateCustomer(c: ReservationInput['customer']) {
  const name = (c?.name ?? '').trim();
  const whatsapp = digits(c?.whatsapp);
  const email = (c?.email ?? '').trim();
  if (name.length < 2 || name.length > 120) throw new DomainError('VALIDATION', 'Informe seu nome completo.');
  if (whatsapp.length < 10 || whatsapp.length > 13) throw new DomainError('VALIDATION', 'Informe um WhatsApp válido com DDD.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError('VALIDATION', 'Informe um e-mail válido ou deixe em branco.');
  return { name, whatsapp, email: email || null, notes: (c.notes ?? '').trim().slice(0, 1000) };
}

function addEvent(db: DB, reservationId: number, type: string, from: Status | null, to: Status | null, note: string, userId?: number) {
  db.prepare('INSERT INTO reservation_events(reservation_id,type,from_status,to_status,note,user_id) VALUES(?,?,?,?,?,?)')
    .run(reservationId, type, from, to, note, userId ?? null);
}
export { addEvent };

const newCode = () => 'TJV-' + randomBytes(4).toString('hex').toUpperCase();

// ---------- criação (pública) ----------
/**
 * Cria a solicitação de forma ATÔMICA: BEGIN IMMEDIATE → valida disponibilidade de TODOS os itens
 * → grava tudo ou nada. Duas conexões concorrentes disputando a última unidade são serializadas
 * pelo lock de escrita, e a segunda enxerga a primeira e é recusada.
 */
export function createReservation(db: DB, input: ReservationInput, ctx: Ctx): { id: number; code: string } {
  validateDates(input, ctx.today);
  const customer = validateCustomer(input.customer);
  if (!Array.isArray(input.items) || input.items.length === 0) throw new DomainError('VALIDATION', 'Escolha ao menos um traje.');
  if (input.items.length > 40) throw new DomainError('VALIDATION', 'Máximo de 40 itens por solicitação.');
  for (const it of input.items) {
    if (!Number.isInteger(it.productId)) throw new DomainError('VALIDATION', 'Traje inválido.');
    if (!isSize(it.size)) throw new DomainError('VALIDATION', 'Tamanho inválido. Use PP, P, M, G, GG, XG ou XXG.');
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > MAX_QUANTITY_PER_ITEM)
      throw new DomainError('VALIDATION', `A quantidade deve ser entre 1 e ${MAX_QUANTITY_PER_ITEM}.`);
  }

  return tx(db, () => {
    for (const it of input.items) {
      const p = db.prepare('SELECT status FROM products WHERE id=?').get(it.productId) as { status: string } | undefined;
      if (!p || p.status !== 'ATIVO') throw new DomainError('VALIDATION', 'Um dos trajes escolhidos não está disponível para locação.');
      if (!db.prepare('SELECT 1 FROM product_sizes WHERE product_id=? AND size_code=?').get(it.productId, it.size))
        throw new DomainError('VALIDATION', `O tamanho ${it.size} não existe para este traje.`);
    }
    const shortages = checkLines(db, input.items, { from: input.pickupDate, to: input.returnDate }, ctx.today);
    if (shortages.length) throw new DomainError('UNAVAILABLE', NOT_ENOUGH_MESSAGE, shortages);

    // cliente: reaproveita pelo WhatsApp
    const existing = db.prepare('SELECT id FROM customers WHERE whatsapp=?').get(customer.whatsapp) as { id: number } | undefined;
    let customerId: number;
    if (existing) {
      customerId = existing.id;
      db.prepare('UPDATE customers SET name=?, email=COALESCE(?,email) WHERE id=?').run(customer.name, customer.email, customerId);
    } else {
      customerId = Number(db.prepare('INSERT INTO customers(name,whatsapp,email,notes) VALUES(?,?,?,?)')
        .run(customer.name, customer.whatsapp, customer.email, customer.notes).lastInsertRowid);
    }
    const code = newCode();
    const resId = Number(db.prepare(`INSERT INTO reservations(code,customer_id,group_name,event_date,pickup_date,return_date,status,notes)
      VALUES(?,?,?,?,?,?, 'SOLICITADA', ?)`).run(code, customerId, input.groupName?.trim() || null,
      input.eventDate, input.pickupDate, input.returnDate, (input.notes ?? '').trim().slice(0, 2000)).lastInsertRowid);
    for (const it of input.items)
      db.prepare('INSERT INTO reservation_items(reservation_id,product_id,size_code,quantity,participant_name) VALUES(?,?,?,?,?)')
        .run(resId, it.productId, it.size, it.quantity, it.participantName?.trim() || null);
    addEvent(db, resId, 'CRIADA', null, 'SOLICITADA', 'Solicitação enviada pelo site.');
    return { id: resId, code };
  });
}

// ---------- consulta ----------
export interface ReservationView {
  id: number; code: string; status: Status; overdue: boolean; groupName: string | null;
  eventDate: string; pickupDate: string; returnDate: string; notes: string;
  customer: { id: number; name: string; whatsapp: string; email: string | null };
  items: Array<{ id: number; productId: number; productName: string; size: SizeCode; quantity: number; participantName: string | null; returnedAt: string | null; returnCondition: string | null }>;
}

export function getReservation(db: DB, id: number, today: string): ReservationView {
  const r = db.prepare(`SELECT r.*, c.name AS cname, c.whatsapp, c.email FROM reservations r JOIN customers c ON c.id=r.customer_id WHERE r.id=?`).get(id) as any;
  if (!r) throw new DomainError('NOT_FOUND', 'Reserva não encontrada.');
  const items = db.prepare(`SELECT ri.*, p.name AS pname FROM reservation_items ri JOIN products p ON p.id=ri.product_id WHERE ri.reservation_id=? ORDER BY ri.id`).all(id) as any[];
  const pending = items.some((i) => !i.returned_at);
  return {
    id: r.id, code: r.code, status: r.status, groupName: r.group_name, eventDate: r.event_date, pickupDate: r.pickup_date,
    returnDate: r.return_date, notes: r.notes,
    overdue: IN_POSSESSION_STATUSES.includes(r.status) && pending && r.return_date < today,
    customer: { id: r.customer_id, name: r.cname, whatsapp: r.whatsapp, email: r.email },
    items: items.map((i) => ({ id: i.id, productId: i.product_id, productName: i.pname, size: i.size_code, quantity: i.quantity,
      participantName: i.participant_name, returnedAt: i.returned_at, returnCondition: i.return_condition })),
  };
}

export function listReservations(db: DB, filter: { status?: Status; from?: string; to?: string } = {}, today: string): ReservationView[] {
  const rows = db.prepare(`SELECT id FROM reservations WHERE (? IS NULL OR status=?) AND (? IS NULL OR return_date>=?) AND (? IS NULL OR pickup_date<=?) ORDER BY pickup_date, id`)
    .all(filter.status ?? null, filter.status ?? null, filter.from ?? null, filter.from ?? null, filter.to ?? null, filter.to ?? null) as { id: number }[];
  return rows.map((r) => getReservation(db, r.id, today));
}

// ---------- transições ----------
export function openAdjustments(db: DB, reservationId: number): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM adjustments WHERE reservation_id=? AND status<>'CONCLUIDO'`).get(reservationId) as { c: number }).c;
}

/** Transição interna: valida o mapa de estados e registra histórico. */
export function transition(db: DB, id: number, to: Status, ctx: Ctx, note = '', opts: { system?: boolean } = {}): void {
  tx(db, () => {
    const r = db.prepare('SELECT status FROM reservations WHERE id=?').get(id) as { status: Status } | undefined;
    if (!r) throw new DomainError('NOT_FOUND', 'Reserva não encontrada.');
    if (!opts.system && !TRANSITIONS[r.status].includes(to))
      throw new DomainError('INVALID_TRANSITION', `Não é possível mudar a reserva de "${r.status}" para "${to}".`);

    if (to === 'CONFIRMADA') {
      // Revalida: se pendentes não bloqueavam estoque, outra reserva pode ter ocupado as peças.
      const res = db.prepare('SELECT pickup_date AS p, return_date AS r FROM reservations WHERE id=?').get(id) as { p: string; r: string };
      const lines = (db.prepare('SELECT product_id AS productId, size_code AS size, quantity FROM reservation_items WHERE reservation_id=?').all(id)) as any[];
      const shortages = checkLines(db, lines, { from: res.p, to: res.r }, ctx.today, id);
      if (shortages.length) throw new DomainError('UNAVAILABLE', NOT_ENOUGH_MESSAGE, shortages);
    }
    if ((to === 'PRONTO_PARA_RETIRADA' || to === 'RETIRADO') && openAdjustments(db, id) > 0)
      throw new DomainError('INVALID_TRANSITION', 'Ainda há ajustes pendentes ou em andamento neste traje.');
    if (to === 'AJUSTE_CONCLUIDO' && openAdjustments(db, id) > 0)
      throw new DomainError('INVALID_TRANSITION', 'Conclua todos os ajustes antes de marcar como concluído.');

    db.prepare(`UPDATE reservations SET status=?, updated_at=datetime('now') WHERE id=?`).run(to, id);
    addEvent(db, id, 'STATUS', r.status, to, note, ctx.userId);
  });
}

export const setStatus = (db: DB, id: number, to: Status, ctx: Ctx, note = '') => transition(db, id, to, ctx, note);

/** Cancela antes da retirada. Não há ajuste manual de estoque: a quantidade é liberada porque
 *  CANCELADA deixa de estar entre os status que comprometem estoque. O histórico é mantido. */
export function cancelReservation(db: DB, id: number, ctx: Ctx, reason = ''): void {
  transition(db, id, 'CANCELADA', ctx, reason || 'Reserva cancelada.');
}
