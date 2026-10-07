import { openDb, type DB } from '../server/db/connection.ts';
import { createProduct } from '../server/services/catalog.ts';
import { createReservation, type ReservationInput } from '../server/services/reservations.ts';
import type { SizeCode } from '../server/domain/constants.ts';

export const TODAY = '2026-10-05';
export const ctx = (today = TODAY) => ({ today, userId: undefined });

export function newDb(path = ':memory:'): DB { return openDb(path); }

export function makeProduct(db: DB, sizes: Array<[SizeCode, number]>, name = 'Traje Masculino Baviera (demonstração)', category: 'MASCULINO' | 'FEMININO' = 'MASCULINO') {
  return createProduct(db, { name, category, status: 'ATIVO', isDemo: true, sizes: sizes.map(([size, stock]) => ({ size, stock })) });
}

export function reserve(db: DB, productId: number, size: SizeCode, quantity: number,
  period = { pickup: '2026-10-16', event: '2026-10-17', ret: '2026-10-19' }, who = 'Cliente Teste', today = TODAY) {
  const input: ReservationInput = {
    customer: { name: who, whatsapp: '(47) 99999-' + String(1000 + Math.floor(Math.random() * 8999)) },
    eventDate: period.event, pickupDate: period.pickup, returnDate: period.ret,
    items: [{ productId, size, quantity }],
  };
  return createReservation(db, input, ctx(today));
}
