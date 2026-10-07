import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { DomainError } from '../domain/errors.ts';
import { isIsoDate } from '../domain/dates.ts';
import { IN_POSSESSION_STATUSES, isSize, type SizeCode, type Status } from '../domain/constants.ts';
import { addEvent, transition, type Ctx } from './reservations.ts';
import { futurePeak, openMaintenance, totalStock } from '../domain/availability.ts';

const status = (db: DB, id: number): Status => {
  const r = db.prepare('SELECT status FROM reservations WHERE id=?').get(id) as { status: Status } | undefined;
  if (!r) throw new DomainError('NOT_FOUND', 'Reserva não encontrada.');
  return r.status;
};

// ---------------- PROVA ----------------
export function scheduleFitting(db: DB, a: { reservationId: number; itemId?: number; date: string; time: string; notes?: string }, ctx: Ctx): number {
  if (!isIsoDate(a.date)) throw new DomainError('VALIDATION', 'Informe uma data de prova válida.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)) throw new DomainError('VALIDATION', 'Informe um horário no formato HH:MM.');
  return tx(db, () => {
    const s = status(db, a.reservationId);
    if (s !== 'CONFIRMADA' && s !== 'AJUSTE_CONCLUIDO' && s !== 'PROVA_AGENDADA')
      throw new DomainError('INVALID_TRANSITION', 'A prova só pode ser agendada para reservas confirmadas.');
    const id = Number(db.prepare('INSERT INTO fittings(reservation_id,item_id,scheduled_date,scheduled_time,notes) VALUES(?,?,?,?,?)')
      .run(a.reservationId, a.itemId ?? null, a.date, a.time, a.notes ?? '').lastInsertRowid);
    if (s !== 'PROVA_AGENDADA') transition(db, a.reservationId, 'PROVA_AGENDADA', ctx, `Prova em ${a.date} ${a.time}`);
    return id;
  });
}

export function completeFitting(db: DB, fittingId: number, a: { result: string; notes?: string }, ctx: Ctx): void {
  tx(db, () => {
    const f = db.prepare('SELECT reservation_id AS rid, status FROM fittings WHERE id=?').get(fittingId) as { rid: number; status: string } | undefined;
    if (!f) throw new DomainError('NOT_FOUND', 'Prova não encontrada.');
    if (f.status !== 'AGENDADA') throw new DomainError('INVALID_TRANSITION', 'Esta prova não está agendada.');
    db.prepare(`UPDATE fittings SET status='REALIZADA', result=?, notes=COALESCE(?,notes) WHERE id=?`).run(a.result ?? '', a.notes ?? null, fittingId);
    if (status(db, f.rid) === 'PROVA_AGENDADA') transition(db, f.rid, 'PROVA_REALIZADA', ctx, a.result ?? '');
  });
}

// ---------------- AJUSTES (vários por reserva/item) ----------------
export function addAdjustment(db: DB, a: { reservationId: number; itemId: number; description: string }, ctx: Ctx): number {
  const description = (a.description ?? '').trim();
  if (description.length < 3) throw new DomainError('VALIDATION', 'Descreva o ajuste necessário.');
  return tx(db, () => {
    if (!db.prepare('SELECT 1 FROM reservation_items WHERE id=? AND reservation_id=?').get(a.itemId, a.reservationId))
      throw new DomainError('NOT_FOUND', 'Item não pertence a esta reserva.');
    const s = status(db, a.reservationId);
    if (!['PROVA_REALIZADA', 'AJUSTE_NECESSARIO', 'AJUSTE_CONCLUIDO'].includes(s))
      throw new DomainError('INVALID_TRANSITION', 'Ajustes são registrados após a prova ser realizada.');
    const id = Number(db.prepare('INSERT INTO adjustments(reservation_id,item_id,description) VALUES(?,?,?)').run(a.reservationId, a.itemId, description).lastInsertRowid);
    if (s !== 'AJUSTE_NECESSARIO') transition(db, a.reservationId, 'AJUSTE_NECESSARIO', ctx, description);
    return id;
  });
}

export function updateAdjustment(db: DB, adjustmentId: number, newStatus: 'PENDENTE' | 'EM_AJUSTE' | 'CONCLUIDO', ctx: Ctx): void {
  tx(db, () => {
    const a = db.prepare('SELECT reservation_id AS rid FROM adjustments WHERE id=?').get(adjustmentId) as { rid: number } | undefined;
    if (!a) throw new DomainError('NOT_FOUND', 'Ajuste não encontrado.');
    db.prepare(`UPDATE adjustments SET status=?, done_at=CASE WHEN ?='CONCLUIDO' THEN datetime('now') ELSE NULL END WHERE id=?`).run(newStatus, newStatus, adjustmentId);
    const open = (db.prepare(`SELECT COUNT(*) AS c FROM adjustments WHERE reservation_id=? AND status<>'CONCLUIDO'`).get(a.rid) as { c: number }).c;
    if (open === 0 && status(db, a.rid) === 'AJUSTE_NECESSARIO') transition(db, a.rid, 'AJUSTE_CONCLUIDO', ctx, 'Todos os ajustes concluídos.');
  });
}

// ---------------- DEVOLUÇÃO / MANUTENÇÃO ----------------
export interface ReturnLine {
  itemId: number; condition: 'OK' | 'MANUTENCAO';
  maintenanceQuantity?: number; reason?: string; notes?: string;
}

/**
 * Registra a devolução real. Peças OK voltam à disponibilidade automaticamente (o item deixa de
 * comprometer estoque). Peças com MANUTENCAO geram um registro em `maintenance` e continuam
 * indisponíveis até LIBERAR PARA ESTOQUE.
 */
export function registerReturn(db: DB, reservationId: number,
  a: { checkedBy: string; actualDate?: string; notes?: string; lines: ReturnLine[] }, ctx: Ctx): void {
  const checkedBy = (a.checkedBy ?? '').trim();
  if (checkedBy.length < 2) throw new DomainError('VALIDATION', 'Informe o responsável pela conferência.');
  if (!a.lines?.length) throw new DomainError('VALIDATION', 'Selecione ao menos um item devolvido.');
  const actual = a.actualDate ?? ctx.today;
  if (!isIsoDate(actual) || actual > ctx.today) throw new DomainError('DATES', 'Data de devolução inválida.');

  tx(db, () => {
    const res = db.prepare('SELECT status, pickup_date AS p, return_date AS r FROM reservations WHERE id=?').get(reservationId) as { status: Status; p: string; r: string } | undefined;
    if (!res) throw new DomainError('NOT_FOUND', 'Reserva não encontrada.');
    if (!IN_POSSESSION_STATUSES.includes(res.status)) throw new DomainError('INVALID_TRANSITION', 'Esta reserva não está com peças retiradas.');
    if (actual < res.p) throw new DomainError('DATES', 'A devolução não pode ser anterior à retirada.');

    for (const l of a.lines) {
      const it = db.prepare('SELECT * FROM reservation_items WHERE id=? AND reservation_id=?').get(l.itemId, reservationId) as any;
      if (!it) throw new DomainError('NOT_FOUND', 'Item não pertence a esta reserva.');
      if (it.returned_at) throw new DomainError('CONFLICT', 'Este item já foi devolvido.');
      if (l.condition !== 'OK' && l.condition !== 'MANUTENCAO') throw new DomainError('VALIDATION', 'Condição da peça inválida.');
      db.prepare('UPDATE reservation_items SET returned_at=?, return_condition=? WHERE id=?').run(actual, l.condition, it.id);
      db.prepare(`INSERT INTO returns(reservation_item_id,expected_date,actual_date,checked_by,condition,notes,was_late) VALUES(?,?,?,?,?,?,?)`)
        .run(it.id, res.r, actual, checkedBy, l.condition, l.notes ?? a.notes ?? '', actual > res.r ? 1 : 0);
      if (l.condition === 'MANUTENCAO') {
        const q = l.maintenanceQuantity ?? it.quantity;
        const reason = (l.reason ?? '').trim();
        if (!Number.isInteger(q) || q < 1 || q > it.quantity) throw new DomainError('VALIDATION', 'Quantidade em manutenção inválida.');
        if (reason.length < 3) throw new DomainError('VALIDATION', 'Informe o motivo da manutenção (lavagem, reparo, costura...).');
        db.prepare('INSERT INTO maintenance(product_id,size_code,quantity,reason,reservation_item_id) VALUES(?,?,?,?,?)').run(it.product_id, it.size_code, q, reason, it.id);
      }
    }
    const remaining = (db.prepare('SELECT COUNT(*) AS c FROM reservation_items WHERE reservation_id=? AND returned_at IS NULL').get(reservationId) as { c: number }).c;
    addEvent(db, reservationId, 'DEVOLUCAO', null, null, `Conferido por ${checkedBy}. ${a.notes ?? ''}`.trim(), ctx.userId);
    if (remaining === 0) {
      const anyMaint = (db.prepare(`SELECT COUNT(*) AS c FROM reservation_items WHERE reservation_id=? AND return_condition='MANUTENCAO'`).get(reservationId) as { c: number }).c;
      transition(db, reservationId, anyMaint ? 'MANUTENCAO' : 'DEVOLVIDO', ctx, 'Todos os itens devolvidos.', { system: true });
    }
  });
}

/** Coloca unidades EM CIRCULAÇÃO LIVRE em manutenção (ex.: peça danificada encontrada no estoque). */
export function sendToMaintenance(db: DB, a: { productId: number; size: SizeCode; quantity: number; reason: string }, ctx: Ctx): number {
  if (!isSize(a.size)) throw new DomainError('VALIDATION', 'Tamanho inválido.');
  if (!Number.isInteger(a.quantity) || a.quantity < 1) throw new DomainError('VALIDATION', 'Quantidade inválida.');
  if ((a.reason ?? '').trim().length < 3) throw new DomainError('VALIDATION', 'Informe o motivo da manutenção.');
  return tx(db, () => {
    const free = totalStock(db, a.productId, a.size) - openMaintenance(db, a.productId, a.size) - futurePeak(db, a.productId, a.size, ctx.today);
    if (a.quantity > free) throw new DomainError('CONFLICT', 'Essas unidades estão comprometidas em reservas e não podem ir para manutenção agora.');
    return Number(db.prepare('INSERT INTO maintenance(product_id,size_code,quantity,reason) VALUES(?,?,?,?)').run(a.productId, a.size, a.quantity, a.reason.trim()).lastInsertRowid);
  });
}

/** LIBERAR PARA ESTOQUE: a unidade volta a contar como disponível. */
export function releaseMaintenance(db: DB, maintenanceId: number, releasedBy: string, ctx: Ctx): void {
  if ((releasedBy ?? '').trim().length < 2) throw new DomainError('VALIDATION', 'Informe quem está liberando a peça.');
  tx(db, () => {
    const m = db.prepare('SELECT status, reservation_item_id AS itemId FROM maintenance WHERE id=?').get(maintenanceId) as { status: string; itemId: number | null } | undefined;
    if (!m) throw new DomainError('NOT_FOUND', 'Registro de manutenção não encontrado.');
    if (m.status !== 'EM_MANUTENCAO') throw new DomainError('CONFLICT', 'Esta peça já foi liberada.');
    db.prepare(`UPDATE maintenance SET status='LIBERADO', released_at=datetime('now'), released_by=? WHERE id=?`).run(releasedBy.trim(), maintenanceId);
    if (m.itemId) {
      const r = db.prepare('SELECT r.id, r.status FROM reservation_items ri JOIN reservations r ON r.id=ri.reservation_id WHERE ri.id=?').get(m.itemId) as { id: number; status: Status };
      const open = (db.prepare(`SELECT COUNT(*) AS c FROM maintenance mt JOIN reservation_items ri ON ri.id=mt.reservation_item_id
        WHERE ri.reservation_id=? AND mt.status='EM_MANUTENCAO'`).get(r.id) as { c: number }).c;
      if (r.status === 'MANUTENCAO' && open === 0) transition(db, r.id, 'FINALIZADA', ctx, 'Manutenção liberada.', { system: true });
    }
  });
}

// ---------------- ATRASO ----------------
/** Registra DEVOLUÇÃO ATRASADA (idempotente). Chamar periodicamente (cron) e ao abrir o painel. */
export function refreshOverdue(db: DB, ctx: Ctx): number {
  return tx(db, () => {
    const ph = IN_POSSESSION_STATUSES.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, return_date AS r FROM reservations
      WHERE status IN (${ph}) AND return_date < ? AND overdue_flagged_at IS NULL
        AND EXISTS (SELECT 1 FROM reservation_items WHERE reservation_id=reservations.id AND returned_at IS NULL)`)
      .all(...IN_POSSESSION_STATUSES, ctx.today) as { id: number; r: string }[];
    for (const r of rows) {
      db.prepare('UPDATE reservations SET overdue_flagged_at=? WHERE id=?').run(ctx.today, r.id);
      addEvent(db, r.id, 'DEVOLUCAO_ATRASADA', null, null, `Devolução prevista para ${r.r} não registrada.`);
    }
    return rows.length;
  });
}
