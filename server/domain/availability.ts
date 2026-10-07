import type { DB } from '../db/connection.ts';
import { addDays, diffDays } from './dates.ts';
import {
  IN_POSSESSION_STATUSES, MAX_PERIOD_DAYS, PENDING_STATUSES, RESERVED_STATUSES,
  type SizeCode, type Status,
} from './constants.ts';
import { blockPendingStock } from '../services/settings.ts';
import { DomainError } from './errors.ts';

/**
 * REGRAS DE DISPONIBILIDADE (única implementação — frontend nunca recalcula)
 *
 *  disponível(período) = estoque_total − manutenção_aberta − PICO de unidades comprometidas no período
 *
 *  • Um item de reserva COMPROMETE estoque de pickup_date até return_date (inclusive) enquanto:
 *      - a reserva está em status que bloqueia (pendentes só se configurado) E
 *      - o item ainda não foi devolvido (returned_at IS NULL).
 *  • DEVOLUÇÃO ATRASADA: item em posse do cliente com return_date < hoje continua comprometido
 *    por tempo indeterminado (até a devolução real).
 *  • MANUTENÇÃO: unidades em EM_MANUTENCAO saem do estoque utilizável em qualquer período
 *    até o administrador LIBERAR PARA ESTOQUE.
 *  • Pico (e não soma): reservas 16–18 e 19–21 com 1 unidade não se conflitam entre si.
 */

const FOREVER = '9999-12-31';

export interface Hold {
  itemId: number; reservationId: number; status: Status;
  start: string; end: string; quantity: number; overdue: boolean;
}

export function holdingStatuses(db: DB): Status[] {
  return [...(blockPendingStock(db) ? PENDING_STATUSES : []), ...RESERVED_STATUSES, ...IN_POSSESSION_STATUSES];
}

/** Todos os compromissos de estoque (produto+tamanho) que ainda não foram devolvidos. */
export function loadHolds(db: DB, productId: number, size: SizeCode, today: string, excludeReservationId?: number): Hold[] {
  const statuses = holdingStatuses(db);
  const inList = statuses.map(() => '?').join(',');
  const possession = IN_POSSESSION_STATUSES.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT ri.id AS itemId, r.id AS reservationId, r.status AS status,
           r.pickup_date AS start, r.return_date AS ret, ri.quantity AS quantity,
           (r.status IN (${possession}) AND r.return_date < ?) AS overdue
      FROM reservation_items ri
      JOIN reservations r ON r.id = ri.reservation_id
     WHERE ri.product_id = ? AND ri.size_code = ?
       AND ri.returned_at IS NULL
       AND r.status IN (${inList})
       AND (? IS NULL OR r.id <> ?)
  `).all(...IN_POSSESSION_STATUSES, today, productId, size, ...statuses, excludeReservationId ?? null, excludeReservationId ?? null) as
    Array<{ itemId: number; reservationId: number; status: Status; start: string; ret: string; quantity: number; overdue: number }>;
  return rows.map((r) => ({
    itemId: r.itemId, reservationId: r.reservationId, status: r.status, quantity: r.quantity,
    start: r.start, overdue: !!r.overdue, end: r.overdue ? FOREVER : r.ret,
  }));
}

export const totalStock = (db: DB, productId: number, size: SizeCode): number => {
  const row = db.prepare('SELECT total_stock AS t FROM inventory WHERE product_id=? AND size_code=?').get(productId, size) as { t: number } | undefined;
  if (!row) throw new DomainError('VALIDATION', 'Este traje não possui o tamanho selecionado.');
  return row.t;
};
export const openMaintenance = (db: DB, productId: number, size: SizeCode): number => {
  const row = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS q FROM maintenance WHERE product_id=? AND size_code=? AND status='EM_MANUTENCAO'`).get(productId, size) as { q: number };
  return row.q;
};

export interface Availability {
  total: number; maintenance: number; peakCommitted: number; available: number;
}

/** Disponibilidade de produto+tamanho para [from, to] (inclusive). */
export function getAvailability(
  db: DB,
  q: { productId: number; size: SizeCode; from: string; to: string; today: string; excludeReservationId?: number },
): Availability {
  if (q.to < q.from) throw new DomainError('DATES', 'A data de devolução não pode ser anterior à de retirada.');
  if (diffDays(q.from, q.to) > 800) throw new DomainError('DATES', 'Período muito longo.');
  const total = totalStock(db, q.productId, q.size);
  const maintenance = openMaintenance(db, q.productId, q.size);
  const holds = loadHolds(db, q.productId, q.size, q.today, q.excludeReservationId)
    .filter((h) => h.start <= q.to && h.end >= q.from);
  // Varredura por eventos: pico de ocupação simultânea dentro de [from, to]
  const points = new Set<string>([q.from]);
  for (const h of holds) if (h.start > q.from && h.start <= q.to) points.add(h.start);
  let peak = 0;
  for (const day of points) {
    let used = 0;
    for (const h of holds) if (h.start <= day && h.end >= day) used += h.quantity;
    if (used > peak) peak = used;
  }
  return { total, maintenance, peakCommitted: peak, available: Math.max(0, total - maintenance - peak) };
}

export interface RequestedLine { productId: number; size: SizeCode; quantity: number }
export interface Shortage { productId: number; size: SizeCode; requested: number; available: number }

/**
 * Valida TODAS as linhas de uma solicitação (inclusive grupos). Linhas do mesmo produto+tamanho
 * são somadas antes da checagem, para que dois participantes "G" do mesmo traje não passem
 * individualmente quando juntos excedem o estoque.
 */
export function checkLines(
  db: DB, lines: RequestedLine[],
  period: { from: string; to: string }, today: string, excludeReservationId?: number,
): Shortage[] {
  const agg = new Map<string, RequestedLine>();
  for (const l of lines) {
    const k = `${l.productId}|${l.size}`;
    const cur = agg.get(k);
    agg.set(k, cur ? { ...cur, quantity: cur.quantity + l.quantity } : { ...l });
  }
  const shortages: Shortage[] = [];
  for (const l of agg.values()) {
    const a = getAvailability(db, { productId: l.productId, size: l.size, ...period, today, excludeReservationId });
    if (l.quantity > a.available) shortages.push({ productId: l.productId, size: l.size, requested: l.quantity, available: a.available });
  }
  return shortages;
}

export interface StockBreakdown {
  total: number; reserved: number; inUse: number; awaitingReturn: number; overdue: number;
  maintenance: number; available: number;
}

/** Visão administrativa de um dia específico. Tudo é derivado do estoque total. */
export function getStockBreakdown(db: DB, productId: number, size: SizeCode, asOf: string, today: string): StockBreakdown {
  const total = totalStock(db, productId, size);
  const maintenance = openMaintenance(db, productId, size);
  let reserved = 0, inUse = 0, awaitingReturn = 0, overdue = 0;
  for (const h of loadHolds(db, productId, size, today)) {
    if (!(h.start <= asOf && h.end >= asOf)) continue;
    if (h.overdue) overdue += h.quantity;
    else if (h.status === 'AGUARDANDO_DEVOLUCAO') awaitingReturn += h.quantity;
    else if (h.status === 'RETIRADO' || h.status === 'EM_USO') inUse += h.quantity;
    else reserved += h.quantity;
  }
  const available = Math.max(0, total - maintenance - reserved - inUse - awaitingReturn - overdue);
  return { total, reserved, inUse, awaitingReturn, overdue, maintenance, available };
}

/** Maior ocupação futura (a partir de hoje) de produto+tamanho; usado para proteger edições de estoque. */
export function futurePeak(db: DB, productId: number, size: SizeCode, today: string): number {
  const holds = loadHolds(db, productId, size, today).filter((h) => h.end >= today);
  if (!holds.length) return 0;
  const cap = addDays(today, 730);
  const last = holds.reduce((m, h) => (h.end > m ? h.end : m), today);
  return getAvailability(db, { productId, size, from: today, to: last > cap ? cap : last, today }).peakCommitted;
}

