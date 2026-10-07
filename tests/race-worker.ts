// Processo independente: abre SUA PRÓPRIA conexão e tenta reservar a última unidade.
import { openDb } from '../server/db/connection.ts';
import { createReservation } from '../server/services/reservations.ts';
const [, , dbPath, startAt, productId, label] = process.argv;
const db = openDb(dbPath!);
while (Date.now() < Number(startAt)) { /* sincroniza a largada dos dois processos */ }
try {
  const r = createReservation(db, {
    customer: { name: 'Cliente ' + label, whatsapp: label === 'A' ? '47988880001' : '47988880002' },
    eventDate: '2026-10-17', pickupDate: '2026-10-16', returnDate: '2026-10-19',
    items: [{ productId: Number(productId), size: 'G', quantity: 1 }],
  }, { today: '2026-10-05' });
  console.log(JSON.stringify({ label, ok: true, code: r.code }));
} catch (e: any) {
  console.log(JSON.stringify({ label, ok: false, code: e.code, message: e.message }));
}
