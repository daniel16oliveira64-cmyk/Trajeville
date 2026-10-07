import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newDb, makeProduct, reserve, ctx, TODAY } from './helpers.ts';
import { getAvailability, getStockBreakdown } from '../server/domain/availability.ts';
import { createReservation, setStatus, cancelReservation, getReservation } from '../server/services/reservations.ts';
import { registerReturn, releaseMaintenance, refreshOverdue, scheduleFitting, completeFitting, addAdjustment, updateAdjustment, sendToMaintenance } from '../server/services/operations.ts';
import { getProductBySlug, productSizeAvailability, setTotalStock, listProducts, createProduct, addProductImage, deleteImage } from '../server/services/catalog.ts';
import { setSetting } from '../server/services/settings.ts';
import { SIZES } from '../server/domain/constants.ts';
import { createAdminUser, login, verifySession, signSession } from '../server/auth/auth.ts';

const P1619 = { from: '2026-10-16', to: '2026-10-19' };
const avail = (db: any, pid: number, size: any, period = P1619, today = TODAY) =>
  getAvailability(db, { productId: pid, size, ...period, today });
const RET = '2026-10-19';   // dia em que as devoluções acontecem nos testes
const NOT_ENOUGH = 'Não há quantidade suficiente disponível para este período.';

test('T1 estoque: G=3, reserva de 2 → disponível 1', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 3]]);
  reserve(db, p, 'G', 2);
  const a = avail(db, p, 'G');
  assert.equal(a.total, 3); assert.equal(a.available, 1);
});

test('T2 excesso: pedir 2 com apenas 1 disponível é bloqueado', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 3]]);
  reserve(db, p, 'G', 2);
  assert.throws(() => reserve(db, p, 'G', 2), (e: any) => e.code === 'UNAVAILABLE' && e.message === NOT_ENOUGH);
  assert.equal(avail(db, p, 'G').available, 1);
});

test('T3 conflito de período: 17→18 dentro de 16→19 conta o conflito', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 1]]);
  reserve(db, p, 'G', 1);
  assert.throws(() => reserve(db, p, 'G', 1, { pickup: '2026-10-17', event: '2026-10-17', ret: '2026-10-18' }), /quantidade suficiente/);
});

test('T3b conflito parcial: sobreposição só no último dia (19) também bloqueia', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 1]]);
  reserve(db, p, 'G', 1);
  assert.throws(() => reserve(db, p, 'G', 1, { pickup: '2026-10-19', event: '2026-10-19', ret: '2026-10-21' }), /quantidade suficiente/);
});

test('T4 período sem conflito: 20→22 após 16→19 é permitido', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 1]]);
  reserve(db, p, 'G', 1);
  assert.doesNotThrow(() => reserve(db, p, 'G', 1, { pickup: '2026-10-20', event: '2026-10-21', ret: '2026-10-22' }));
});

test('pico de ocupação: reservas 16–18 e 19–21 com 1 unidade NÃO competem entre si, mas um pedido 16–21 é bloqueado', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 2]]);
  reserve(db, p, 'G', 1, { pickup: '2026-10-16', event: '2026-10-17', ret: '2026-10-18' });
  reserve(db, p, 'G', 1, { pickup: '2026-10-19', event: '2026-10-20', ret: '2026-10-21' });
  // pico = 1 (nunca simultâneas) → ainda cabe 1 unidade em todo o período 16–21
  assert.equal(avail(db, p, 'G', { from: '2026-10-16', to: '2026-10-21' }).available, 1);
});

test('T5 cancelamento libera a quantidade automaticamente e mantém histórico', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 1]]);
  const r = reserve(db, p, 'G', 1);
  assert.equal(avail(db, p, 'G').available, 0);
  cancelReservation(db, r.id, ctx(), 'Cliente desistiu');
  assert.equal(avail(db, p, 'G').available, 1);
  assert.equal(getReservation(db, r.id, TODAY).status, 'CANCELADA');
  const ev = db.prepare('SELECT COUNT(*) c FROM reservation_events WHERE reservation_id=?').get(r.id) as any;
  assert.equal(ev.c, 2);
  assert.doesNotThrow(() => reserve(db, p, 'G', 1));   // permite nova solicitação
});

function pickedUp(db: any, pid: number, size: any, qty = 1, today = TODAY) {
  const r = reserve(db, pid, size, qty);
  const c = ctx(today);
  setStatus(db, r.id, 'CONFIRMADA', c);
  setStatus(db, r.id, 'PRONTO_PARA_RETIRADA', c);
  setStatus(db, r.id, 'RETIRADO', c);
  return r;
}

test('T6 devolução normal: peça volta à disponibilidade', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 1]]);
  const r = pickedUp(db, p, 'G');
  assert.equal(avail(db, p, 'G').available, 0);
  const item = getReservation(db, r.id, TODAY).items[0]!;
  registerReturn(db, r.id, { checkedBy: 'Ana', lines: [{ itemId: item.id, condition: 'OK' }] }, ctx(RET));
  assert.equal(avail(db, p, 'G', P1619, RET).available, 1);
  assert.equal(getReservation(db, r.id, RET).status, 'DEVOLVIDO');
  setStatus(db, r.id, 'FINALIZADA', ctx(RET));
});

test('T7 devolução com manutenção: peça NÃO volta à disponibilidade', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 5]]);
  reserve(db, p, 'G', 1, { pickup: '2026-10-16', event: '2026-10-17', ret: '2026-10-19' });
  const r = pickedUp(db, p, 'G');
  const item = getReservation(db, r.id, TODAY).items[0]!;
  registerReturn(db, r.id, { checkedBy: 'Ana', lines: [{ itemId: item.id, condition: 'MANUTENCAO', reason: 'Costura da calça' }] }, ctx(RET));
  const a = avail(db, p, 'G', P1619, RET);
  assert.equal(a.maintenance, 1);
  assert.equal(a.available, 3);   // 5 − 1 (reserva restante) − 1 (manutenção)
  assert.equal(getReservation(db, r.id, RET).status, 'MANUTENCAO');
});

test('T8 LIBERAR PARA ESTOQUE devolve a unidade à disponibilidade e finaliza a reserva', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 1]]);
  const r = pickedUp(db, p, 'G');
  const item = getReservation(db, r.id, TODAY).items[0]!;
  registerReturn(db, r.id, { checkedBy: 'Ana', lines: [{ itemId: item.id, condition: 'MANUTENCAO', reason: 'Lavagem especial' }] }, ctx(RET));
  assert.equal(avail(db, p, 'G', P1619, RET).available, 0);
  const m = db.prepare('SELECT id FROM maintenance').get() as any;
  releaseMaintenance(db, m.id, 'Ana', ctx(RET));
  assert.equal(avail(db, p, 'G', P1619, RET).available, 1);
  assert.equal(getReservation(db, r.id, RET).status, 'FINALIZADA');
  assert.throws(() => releaseMaintenance(db, m.id, 'Ana', ctx(RET)), /já foi liberada/);
});

test('T9 devolução atrasada: sinaliza, registra evento e a peça continua indisponível', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 1]]);
  const r = pickedUp(db, p, 'G');
  const later = '2026-10-25';             // devolução prevista era 19/10
  const c = ctx(later);
  assert.equal(getReservation(db, r.id, later).overdue, true);
  assert.equal(refreshOverdue(db, c), 1);
  assert.equal(refreshOverdue(db, c), 0);  // idempotente
  // período futuro (nov) continua sem a peça, pois ela ainda não voltou
  assert.equal(avail(db, p, 'G', { from: '2026-11-10', to: '2026-11-12' }, later).available, 0);
  const b = getStockBreakdown(db, p, 'G', later, later);
  assert.equal(b.overdue, 1); assert.equal(b.available, 0);
  const item = getReservation(db, r.id, later).items[0]!;
  registerReturn(db, r.id, { checkedBy: 'Ana', lines: [{ itemId: item.id, condition: 'OK' }] }, c);
  assert.equal(avail(db, p, 'G', { from: '2026-11-10', to: '2026-11-12' }, later).available, 1);
  const ret = db.prepare('SELECT was_late FROM returns').get() as any;
  assert.equal(ret.was_late, 1);
});

test('T10 última unidade: dois PROCESSOS simultâneos — só um consegue', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tjv-'));
  const path = join(dir, 'race.db');
  try {
    const db = newDb(path); const p = makeProduct(db, [['G', 1]]); db.close();
    const startAt = Date.now() + 1500;
    const run = (label: string) => new Promise<any>((resolve, reject) => {
      const ch = spawn('tsx', ['tests/race-worker.ts', path, String(startAt), String(p), label], { cwd: process.cwd() });
      let out = ''; let err = '';
      ch.stdout.on('data', (d) => (out += d)); ch.stderr.on('data', (d) => (err += d));
      ch.on('close', () => { try { resolve(JSON.parse(out.trim().split('\n').pop()!)); } catch { reject(new Error(out + err)); } });
    });
    const [a, b] = await Promise.all([run('A'), run('B')]);
    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    assert.equal(winners.length, 1, JSON.stringify([a, b]));
    assert.equal(losers.length, 1);
    assert.equal(losers[0].code, 'UNAVAILABLE');
    const check = newDb(path);
    assert.equal((check.prepare('SELECT COUNT(*) c FROM reservations').get() as any).c, 1);
    check.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('T11 tamanhos: produto P,M,G,GG não expõe PP/XG/XXG; escala fixa; numéricos rejeitados', () => {
  const db = newDb(); const p = makeProduct(db, [['P', 1], ['M', 1], ['G', 1], ['GG', 1]]);
  const view = getProductBySlug(db, listProducts(db)[0]!.slug)!;
  assert.deepEqual(view.sizes, ['P', 'M', 'G', 'GG']);
  assert.deepEqual(productSizeAvailability(db, p, P1619, TODAY).map((s) => s.size), ['P', 'M', 'G', 'GG']);
  assert.deepEqual([...SIZES], ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XXG']);
  assert.throws(() => reserve(db, p, 'XG', 1), /não existe para este traje/);
  assert.throws(() => reserve(db, p, '42' as any, 1), /Tamanho inválido/);
  assert.throws(() => createProduct(db, { name: 'Traje X', category: 'FEMININO', sizes: [{ size: '38' as any, stock: 1 }] }), /Tamanho inválido/);
  assert.throws(() => db.prepare("INSERT INTO sizes(code,sort_order) VALUES('42',99)").run());   // o próprio banco recusa
});

test('T12 grupo: se um dos itens não tem estoque, NADA é gravado', () => {
  const db = newDb();
  const a = makeProduct(db, [['M', 1]], 'Vestido A', 'FEMININO');
  const b = makeProduct(db, [['G', 1]], 'Vestido B', 'FEMININO');
  const c = makeProduct(db, [['GG', 1]], 'Traje C');
  reserve(db, c, 'GG', 1);    // GG de C já ocupado no período
  const input = {
    customer: { name: 'Grupo Oktoberfest', whatsapp: '47977770000' }, groupName: 'Grupo Oktoberfest',
    eventDate: '2026-10-17', pickupDate: '2026-10-16', returnDate: '2026-10-19',
    items: [{ productId: a, size: 'M' as const, quantity: 1 }, { productId: b, size: 'G' as const, quantity: 1 }, { productId: c, size: 'GG' as const, quantity: 1 }],
  };
  assert.throws(() => createReservation(db, input, ctx()), (e: any) => e.code === 'UNAVAILABLE' && e.details.length === 1 && e.details[0].size === 'GG');
  assert.equal((db.prepare('SELECT COUNT(*) c FROM reservations').get() as any).c, 1);       // só a de antes
  assert.equal(avail(db, a, 'M').available, 1);                                                 // nada vazou
});

test('grupo válido: participantes com produtos/tamanhos diferentes', () => {
  const db = newDb();
  const a = makeProduct(db, [['M', 2], ['G', 2]], 'Vestido A', 'FEMININO');
  const c = makeProduct(db, [['GG', 2]], 'Traje C');
  const r = createReservation(db, {
    customer: { name: 'Marta', whatsapp: '47977770000' }, groupName: 'Grupo',
    eventDate: '2026-10-17', pickupDate: '2026-10-16', returnDate: '2026-10-19',
    items: [{ productId: a, size: 'M', quantity: 1, participantName: 'Pessoa 1' }, { productId: a, size: 'G', quantity: 1, participantName: 'Pessoa 2' }, { productId: c, size: 'GG', quantity: 1, participantName: 'Pessoa 3' }],
  }, ctx());
  assert.equal(getReservation(db, r.id, TODAY).items.length, 3);
});

test('grupo: dois participantes do MESMO produto+tamanho são somados antes de checar', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 1]]);
  assert.throws(() => createReservation(db, {
    customer: { name: 'Marta', whatsapp: '47977770000' }, eventDate: '2026-10-17', pickupDate: '2026-10-16', returnDate: '2026-10-19',
    items: [{ productId: p, size: 'G', quantity: 1 }, { productId: p, size: 'G', quantity: 1 }],
  }, ctx()), /quantidade suficiente/);
});

test('validação de datas com mensagens claras', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 5]]);
  const bad = (pickup: string, event: string, ret: string, re: RegExp) =>
    assert.throws(() => reserve(db, p, 'G', 1, { pickup, event, ret }), re);
  bad('2026-10-18', '2026-10-17', '2026-10-19', /retirada precisa ser no dia do evento ou antes/);
  bad('2026-10-16', '2026-10-17', '2026-10-15', /devolução não pode ser anterior à retirada/);
  bad('2026-10-16', '2026-10-20', '2026-10-18', /devolução precisa ser no dia do evento ou depois/);
  bad('2026-10-01', '2026-10-17', '2026-10-19', /passado/);
  bad('2026-13-45', '2026-10-17', '2026-10-19', /válida/);
  assert.throws(() => reserve(db, p, 'G', 99), /entre 1 e 50/);
  assert.throws(() => reserve(db, p, 'G', 6), /quantidade suficiente/);
});

test('exemplo completo da especificação (Baviera M3 G4 GG2)', () => {
  const db = newDb(); const p = makeProduct(db, [['M', 3], ['G', 4], ['GG', 2]]);
  const A = reserve(db, p, 'G', 1);
  reserve(db, p, 'G', 1);
  assert.equal(avail(db, p, 'G').available, 2);
  // Cliente A cancela antes da retirada → volta
  cancelReservation(db, A.id, ctx());
  assert.equal(avail(db, p, 'G').available, 3);
  // Cliente C retira e devolve danificada
  const C = pickedUp(db, p, 'G');
  assert.equal(avail(db, p, 'G').available, 2);
  const item = getReservation(db, C.id, TODAY).items[0]!;
  registerReturn(db, C.id, { checkedBy: 'Ana', lines: [{ itemId: item.id, condition: 'MANUTENCAO', reason: 'Dano' }] }, ctx(RET));
  const a = avail(db, p, 'G', P1619, RET);
  assert.deepEqual([a.total, a.maintenance, a.peakCommitted, a.available], [4, 1, 1, 2]);
  releaseMaintenance(db, (db.prepare('SELECT id FROM maintenance').get() as any).id, 'Ana', ctx(RET));
  assert.equal(avail(db, p, 'G', P1619, RET).available, 3);
});

test('painel de estoque: reservado / em uso / manutenção calculados a partir do total', () => {
  const db = newDb(); const p = makeProduct(db, [['P', 2]]);
  reserve(db, p, 'P', 1);
  const b = getStockBreakdown(db, p, 'P', '2026-10-17', TODAY);
  assert.deepEqual([b.total, b.reserved, b.available], [2, 1, 1]);
});

test('solicitações pendentes: bloqueiam por padrão; desativando, o confirmar revalida o estoque', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 1]]);
  const r1 = reserve(db, p, 'G', 1);                       // SOLICITADA
  assert.equal(avail(db, p, 'G').available, 0);             // padrão = bloqueia
  setSetting(db, 'block_pending_stock', 'false');
  assert.equal(avail(db, p, 'G').available, 1);             // pendente não bloqueia
  const r2 = reserve(db, p, 'G', 1, undefined, 'Outro');    // outra pendente passa
  setStatus(db, r1.id, 'CONFIRMADA', ctx());                // a primeira confirma
  assert.throws(() => setStatus(db, r2.id, 'CONFIRMADA', ctx()), /quantidade suficiente/);   // a segunda NÃO
});

test('máquina de estados: transições inválidas e atalhos proibidos', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 3]]);
  const r = reserve(db, p, 'G', 1);
  assert.throws(() => setStatus(db, r.id, 'RETIRADO', ctx()), /Não é possível mudar/);
  assert.throws(() => setStatus(db, r.id, 'DEVOLVIDO', ctx()), /Não é possível mudar/);
  setStatus(db, r.id, 'CONFIRMADA', ctx());
  const rr = pickedUp(db, p, 'G');
  assert.throws(() => cancelReservation(db, rr.id, ctx()), /Não é possível mudar/);   // não cancela após retirada
});

test('prova → ajustes (vários) → pronto para retirada', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 3]]);
  const r = reserve(db, p, 'G', 1); const c = ctx();
  setStatus(db, r.id, 'CONFIRMADA', c);
  const f = scheduleFitting(db, { reservationId: r.id, date: '2026-10-10', time: '14:30' }, c);
  assert.equal(getReservation(db, r.id, TODAY).status, 'PROVA_AGENDADA');
  completeFitting(db, f, { result: 'Calça longa' }, c);
  assert.equal(getReservation(db, r.id, TODAY).status, 'PROVA_REALIZADA');
  const item = getReservation(db, r.id, TODAY).items[0]!;
  const a1 = addAdjustment(db, { reservationId: r.id, itemId: item.id, description: 'Regular comprimento da calça.' }, c);
  const a2 = addAdjustment(db, { reservationId: r.id, itemId: item.id, description: 'Apertar a cintura.' }, c);
  assert.equal(getReservation(db, r.id, TODAY).status, 'AJUSTE_NECESSARIO');
  assert.throws(() => setStatus(db, r.id, 'PRONTO_PARA_RETIRADA', c), /Não é possível mudar/);
  updateAdjustment(db, a1, 'CONCLUIDO', c);
  assert.equal(getReservation(db, r.id, TODAY).status, 'AJUSTE_NECESSARIO');   // ainda falta um
  updateAdjustment(db, a2, 'EM_AJUSTE', c); updateAdjustment(db, a2, 'CONCLUIDO', c);
  assert.equal(getReservation(db, r.id, TODAY).status, 'AJUSTE_CONCLUIDO');
  setStatus(db, r.id, 'PRONTO_PARA_RETIRADA', c);
});

test('estoque total: não permite reduzir abaixo do comprometido; manutenção manual idem', () => {
  const db = newDb(); const p = makeProduct(db, [['G', 3]]);
  reserve(db, p, 'G', 2);
  assert.throws(() => setTotalStock(db, p, 'G', 1, TODAY), /comprometidas/);
  setTotalStock(db, p, 'G', 2, TODAY);
  assert.throws(() => sendToMaintenance(db, { productId: p, size: 'G', quantity: 1, reason: 'Mancha' }, ctx()), /comprometidas/);
  setTotalStock(db, p, 'G', 4, TODAY);
  sendToMaintenance(db, { productId: p, size: 'G', quantity: 1, reason: 'Mancha' }, ctx());
  assert.equal(avail(db, p, 'G').available, 1);
});

test('imagens: foto principal e exclusão não misturam produtos; sem foto → null (placeholder)', () => {
  const db = newDb(); const a = makeProduct(db, [['G', 1]], 'Traje A'); const b = makeProduct(db, [['G', 1]], 'Traje B');
  assert.equal(listProducts(db).find((p) => p.id === a)!.primaryImage, null);
  const i1 = addProductImage(db, a, '/uploads/a1.jpg'); addProductImage(db, a, '/uploads/a2.jpg');
  addProductImage(db, b, '/uploads/b1.jpg');
  assert.throws(() => deleteImage(db, b, i1), /não encontrada/);        // imagem de A não pode ser apagada via B
  deleteImage(db, a, i1);
  assert.equal(listProducts(db).find((p) => p.id === a)!.primaryImage, '/uploads/a2.jpg');
  assert.equal(listProducts(db).find((p) => p.id === b)!.primaryImage, '/uploads/b1.jpg');
});

test('segurança: senha com scrypt, login genérico, token assinado e expirável', () => {
  const db = newDb(); const secret = 'x'.repeat(40);
  createAdminUser(db, { email: 'Admin@Trajeville.com', name: 'Admin', password: 'uma-senha-forte-123' });
  const stored = (db.prepare('SELECT password_hash h FROM users').get() as any).h;
  assert.ok(stored.startsWith('scrypt$') && !stored.includes('uma-senha'));
  const { token } = login(db, 'admin@trajeville.com', 'uma-senha-forte-123', secret);
  assert.equal(verifySession(token, secret)?.role, 'ADMIN');
  assert.equal(verifySession(token + 'x', secret), null);
  assert.equal(verifySession(token, 'y'.repeat(40)), null);
  assert.equal(verifySession(signSession({ uid: 1, role: 'ADMIN', exp: Date.now() - 1 }, secret), secret), null);
  assert.throws(() => login(db, 'admin@trajeville.com', 'errada', secret), /incorretos/);
  assert.throws(() => login(db, 'naoexiste@x.com', 'qualquer', secret), /incorretos/);
  assert.throws(() => createAdminUser(db, { email: 'a@b.co', name: 'x', password: 'curta' }), /10 caracteres/);
});

test('marca: nenhuma variação incorreta de "Trajeville" nos arquivos do servidor', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const bad = /Trajevile|TrajeVile|Traje Ville|Trajevillé/;
  for (const f of [...walk('server'), ...walk('tests')].filter((f) => !f.endsWith('.test.ts')))
    assert.ok(!bad.test(readFileSync(f, 'utf8')), `Marca incorreta em ${f}`);
});
