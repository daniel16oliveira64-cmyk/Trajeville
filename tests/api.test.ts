import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newDb, makeProduct } from './helpers.ts';
import { createApp } from '../server/http/app.ts';
import { createAdminUser } from '../server/auth/auth.ts';
import { setSetting } from '../server/services/settings.ts';
import { ensureDefaultFaqs } from '../server/services/admin.ts';
import { createProduct } from '../server/services/catalog.ts';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!';
const clock = { t: new Date('2026-10-05T15:00:00Z') };   // 05/10/2026 em Joinville
const tmp = mkdtempSync(join(tmpdir(), 'tjv-api-'));
const webDir = join(tmp, 'web'); mkdirSync(webDir);
writeFileSync(join(webDir, 'index.html'), '<!doctype html><html><head><!--SEO--></head><body><div id="root"></div></body></html>');
mkdirSync(join(webDir, 'assets')); writeFileSync(join(webDir, 'assets', 'app-abc.js'), 'console.log(1)');

const db = newDb();
let server: Server; let base = '';
let baviera = 0, feminino = 0;
let adminCookie = '', staffCookie = '';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);

before(async () => {
  createAdminUser(db, { email: 'admin@trajeville.test', name: 'Dona Admin', password: 'senha-super-forte-1' });
  createAdminUser(db, { email: 'staff@trajeville.test', name: 'Funcionária', password: 'senha-super-forte-2', role: 'STAFF' });
  baviera = createProduct(db, { name: 'Traje Masculino Baviera', category: 'MASCULINO', status: 'ATIVO', description: 'Descrição </script><b>x</b>',
    sizes: [{ size: 'M', stock: 3 }, { size: 'G', stock: 4 }, { size: 'GG', stock: 2 }] });
  feminino = createProduct(db, { name: 'Traje Feminino Clássico', category: 'FEMININO', status: 'ATIVO', isDemo: true,
    sizes: [{ size: 'P', stock: 1 }, { size: 'M', stock: 2 }] });
  createProduct(db, { name: 'Rascunho Escondido', category: 'MASCULINO', status: 'RASCUNHO', sizes: [{ size: 'G', stock: 1 }] });
  ensureDefaultFaqs(db);
  server = createApp({ db, secret: SECRET, uploadDir: join(tmp, 'up'), webDir, now: () => clock.t, siteUrl: 'https://trajeville.example', reserveLimitPerHour: 1000 });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  adminCookie = await loginAs('admin@trajeville.test', 'senha-super-forte-1');
  staffCookie = await loginAs('staff@trajeville.test', 'senha-super-forte-2');
});
after(() => { server.close(); rmSync(tmp, { recursive: true, force: true }); });

async function api(method: string, path: string, body?: unknown, opt: { cookie?: string; csrf?: boolean; raw?: Buffer; ctype?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opt.cookie) headers.cookie = opt.cookie;
  if (opt.csrf !== false && path.startsWith('/api/admin')) headers['x-requested-with'] = 'trajeville';
  let payload: any;
  if (opt.raw) { payload = opt.raw; headers['content-type'] = opt.ctype ?? 'image/jpeg'; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* html/texto */ }
  return { status: res.status, json, text, headers: res.headers };
}
async function loginAs(email: string, password: string) {
  const r = await api('POST', '/api/admin/login', { email, password });
  assert.equal(r.status, 200, r.text);
  return r.headers.get('set-cookie')!.split(';')[0]!;
}
const A = (m: string, p: string, b?: unknown, o: any = {}) => api(m, p, b, { cookie: adminCookie, ...o });

const reservationBody = (over: any = {}) => ({
  customer: { name: 'João Silva', whatsapp: '(47) 99999-1234', email: 'joao@exemplo.com' },
  eventDate: '2026-10-17', pickupDate: '2026-10-16', returnDate: '2026-10-19',
  items: [{ productId: baviera, size: 'G', quantity: 1 }], ...over,
});

// ---------------- PÚBLICO ----------------
test('catálogo público: só ativos, tamanhos na ordem, sem estoque total nem dados internos', async () => {
  const r = await api('GET', '/api/public/products');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.map((p: any) => p.name).sort(), ['Traje Feminino Clássico', 'Traje Masculino Baviera']);
  const b = r.json.find((p: any) => p.id === baviera);
  assert.deepEqual(b.sizes.map((s: any) => s.size), ['M', 'G', 'GG']);
  assert.equal(b.primaryImage, null);
  assert.ok(!/total_stock|totalStock|"stock"|customer|whatsapp"/.test(r.text.replace(/whatsapp_number/g, '')));
  const f = await api('GET', '/api/public/products?category=FEMININO');
  assert.equal(f.json.length, 1);
  assert.equal((await api('GET', '/api/public/products?category=INFANTIL')).status, 400);
});

test('página do traje: 404 para rascunho/inexistente; disponibilidade por período', async () => {
  assert.equal((await api('GET', '/api/public/products/rascunho-escondido')).status, 404);
  const r = await api('GET', '/api/public/products/traje-masculino-baviera?from=2026-10-16&to=2026-10-19');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.sizes.map((s: any) => [s.size, s.available]), [['M', 3], ['G', 4], ['GG', 2]]);
  assert.equal((await api('GET', '/api/public/products/traje-masculino-baviera?from=2026-10-19&to=2026-10-16')).status, 400);
});

test('reserva pública: cria solicitação, WhatsApp não configurado => sem link; configurado => link com mensagem', async () => {
  const r = await api('POST', '/api/public/reservations', reservationBody());
  assert.equal(r.status, 201, r.text);
  assert.match(r.json.code, /^TJV-[A-F0-9]{8}$/);
  assert.equal(r.json.whatsapp.configured, false); assert.equal(r.json.whatsapp.url, null);
  assert.match(r.json.whatsapp.message, /Trajeville/);
  assert.match(r.json.whatsapp.message, /Retirada: 16\/10\/2026/);
  setSetting(db, 'whatsapp_number', '47988887777');
  const r2 = await api('POST', '/api/public/reservations', reservationBody({ customer: { name: 'Ana', whatsapp: '47911112222' } }));
  assert.match(r2.json.whatsapp.url, /^https:\/\/wa\.me\/5547988887777\?text=/);
  assert.match(decodeURIComponent(r2.json.whatsapp.url), /Traje: Traje Masculino Baviera — Tamanho G/);
  setSetting(db, 'whatsapp_number', '');
});

test('overbooking via API: M tem 3; pedir 4 → 409 com mensagem; sem reserva parcial', async () => {
  const before = (db.prepare('SELECT COUNT(*) c FROM reservations').get() as any).c;
  const r = await api('POST', '/api/public/reservations', reservationBody({ items: [{ productId: baviera, size: 'M', quantity: 4 }] }));
  assert.equal(r.status, 409);
  assert.equal(r.json.error.message, 'Não há quantidade suficiente disponível para este período.');
  assert.equal((db.prepare('SELECT COUNT(*) c FROM reservations').get() as any).c, before);
});

test('grupo via API: 1 item impossível derruba a solicitação inteira', async () => {
  const before = (db.prepare('SELECT COUNT(*) c FROM reservations').get() as any).c;
  const r = await api('POST', '/api/public/reservations', reservationBody({
    groupName: 'Grupo', items: [{ productId: baviera, size: 'GG', quantity: 1 }, { productId: feminino, size: 'P', quantity: 2 }] }));
  assert.equal(r.status, 409); assert.equal(r.json.error.details.length, 1); assert.equal(r.json.error.details[0].size, 'P');
  assert.equal((db.prepare('SELECT COUNT(*) c FROM reservations').get() as any).c, before);
  const ok = await api('POST', '/api/public/reservations', reservationBody({ groupName: 'Grupo Oktoberfest',
    items: [{ productId: baviera, size: 'GG', quantity: 1, participantName: 'Pessoa 1' }, { productId: feminino, size: 'M', quantity: 1, participantName: 'Pessoa 2' }] }));
  assert.equal(ok.status, 201); assert.equal(ok.json.summary.items.length, 2);
});

test('última unidade com 6 requisições HTTP simultâneas: exatamente 1 vence', async () => {
  const pid = createProduct(db, { name: 'Traje Único', category: 'MASCULINO', status: 'ATIVO', sizes: [{ size: 'XXG', stock: 1 }] });
  const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => api('POST', '/api/public/reservations',
    reservationBody({ customer: { name: 'Cliente ' + i, whatsapp: `4790000000${i}` }, items: [{ productId: pid, size: 'XXG', quantity: 1 }] }))));
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  assert.equal(rs.filter((r) => r.status === 409).length, 5);
});

test('validações: datas, tamanho numérico, tipos errados, JSON inválido, content-type', async () => {
  const bad = async (over: any, status: number, re: RegExp) => { const r = await api('POST', '/api/public/reservations', reservationBody(over)); assert.equal(r.status, status, r.text); assert.match(r.json.error.message, re); };
  await bad({ pickupDate: '2026-10-18' }, 400, /retirada precisa ser no dia do evento ou antes/);
  await bad({ returnDate: '2026-10-15' }, 400, /devolução não pode ser anterior/);
  await bad({ pickupDate: '2026-09-01' }, 400, /passado/);
  await bad({ items: [{ productId: baviera, size: '42', quantity: 1 }] }, 400, /Tamanho inválido/);
  await bad({ items: [{ productId: baviera, size: 'XG', quantity: 1 }] }, 400, /não existe para este traje/);
  await bad({ items: [{ productId: baviera, size: 'G', quantity: '1' }] }, 400, /quantidade/i);
  await bad({ items: [{ productId: 'x', size: 'G', quantity: 1 }] }, 400, /inválido/i);
  await bad({ customer: { name: 'J', whatsapp: '123' } }, 400, /nome/i);
  await bad({ customer: 'texto' }, 400, /inválido/i);
  await bad({ items: [] }, 400, /ao menos um traje/);
  const rascunho = (db.prepare("SELECT id FROM products WHERE name='Rascunho Escondido'").get() as any).id;
  await bad({ items: [{ productId: rascunho, size: 'G', quantity: 1 }] }, 400, /não está disponível/);
  const r = await fetch(base + '/api/public/reservations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{quebrado' });
  assert.equal(r.status, 400);
  const r2 = await fetch(base + '/api/public/reservations', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(r2.status, 415);
});

test('honeypot: robô preenche "website" e nada é gravado', async () => {
  const before = (db.prepare('SELECT COUNT(*) c FROM reservations').get() as any).c;
  const r = await api('POST', '/api/public/reservations', { ...reservationBody(), website: 'http://spam' });
  assert.equal(r.status, 201);
  assert.equal((db.prepare('SELECT COUNT(*) c FROM reservations').get() as any).c, before);
});

test('limite de solicitações por IP', async () => {
  const s = createApp({ db, secret: SECRET, uploadDir: join(tmp, 'up2'), now: () => clock.t, reserveLimitPerHour: 2 });
  await new Promise<void>((r) => s.listen(0, r));
  const b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const post = () => fetch(b + '/api/public/reservations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  assert.equal((await post()).status, 400); assert.equal((await post()).status, 400); assert.equal((await post()).status, 429);
  s.close();
});

test('verificação em tempo real /check informa disponibilidade sem gravar', async () => {
  const r = await api('POST', '/api/public/check', { pickupDate: '2026-10-16', returnDate: '2026-10-19', items: [{ productId: baviera, size: 'G', quantity: 99 }] });
  assert.equal(r.json.ok, false); assert.ok(r.json.lines[0].available >= 0);
});

// ---------------- SEGURANÇA ----------------
test('todas as rotas /api/admin exigem login (401)', async () => {
  const gets = ['dashboard', 'products', 'stock', 'reservations', 'reservations/1', 'maintenance', 'calendar?from=2026-10-01&to=2026-10-31', 'customers', 'customers/1', 'faqs', 'gallery', 'settings', 'me'];
  for (const g of gets) assert.equal((await api('GET', '/api/admin/' + g)).status, 401, g);
  for (const [m, p] of [['POST', 'products'], ['PUT', 'settings'], ['POST', 'reservations/1/status'], ['POST', 'reservations/1/return'], ['POST', 'maintenance/1/release'], ['POST', 'gallery']] as const)
    assert.equal((await api(m, '/api/admin/' + p, {})).status, 401, p);
});

test('CSRF: mutação sem cabeçalho X-Requested-With ou com Origin de outro site é negada', async () => {
  assert.equal((await A('POST', '/api/admin/faqs', { question: 'Teste?', answer: 'Sim.' }, { csrf: false })).status, 403);
  const res = await fetch(base + '/api/admin/faqs', { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json', 'x-requested-with': 'trajeville', origin: 'https://evil.example' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('login: cookie HttpOnly+SameSite=Strict, erro genérico, bloqueio por tentativas, sessão adulterada', async () => {
  const r = await api('POST', '/api/admin/login', { email: 'admin@trajeville.test', password: 'senha-super-forte-1' });
  const sc = r.headers.get('set-cookie')!;
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  assert.ok(!JSON.stringify(r.json).includes('hash'));
  const bad1 = await api('POST', '/api/admin/login', { email: 'admin@trajeville.test', password: 'errada-errada' });
  const bad2 = await api('POST', '/api/admin/login', { email: 'ninguem@x.com', password: 'errada-errada' });
  assert.equal(bad1.status, 401); assert.equal(bad1.json.error.message, bad2.json.error.message);
  const me = await A('GET', '/api/admin/me'); assert.equal(me.json.user.email, 'admin@trajeville.test'); assert.ok(!('password_hash' in me.json.user));
  assert.equal((await api('GET', '/api/admin/me', undefined, { cookie: adminCookie + 'x' })).status, 401);
  let last = 0; for (let i = 0; i < 6; i++) last = (await api('POST', '/api/admin/login', { email: 'alvo@trajeville.test', password: 'xxxxxxxxxxxx' })).status;
  assert.equal(last, 429);
});

test('perfis: STAFF opera mas não altera configurações; ADMIN valida WhatsApp e Instagram', async () => {
  assert.equal((await api('PUT', '/api/admin/settings', { address: 'x' }, { cookie: staffCookie })).status, 403);
  assert.equal((await api('GET', '/api/admin/dashboard', undefined, { cookie: staffCookie })).status, 200);
  assert.equal((await A('PUT', '/api/admin/settings', { whatsapp_number: '123' })).status, 400);
  assert.equal((await A('PUT', '/api/admin/settings', { instagram_url: 'http://evil.com' })).status, 400);
  assert.equal((await A('PUT', '/api/admin/settings', { inexistente: 'x' })).status, 400);
  assert.equal((await A('PUT', '/api/admin/settings', { hero_image: '/uploads/../../etc/passwd' })).status, 400);
  assert.equal((await A('PUT', '/api/admin/settings', { whatsapp_number: '(47) 98888-7777', address: 'Rua Exemplo, 100' })).status, 200);
  const pub = await api('GET', '/api/public/settings');
  assert.equal(pub.json.whatsapp_number, '47988887777'); assert.ok(!('block_pending_stock' in pub.json));
  await A('PUT', '/api/admin/settings', { whatsapp_number: '', address: '' });
});

// ---------------- FLUXO OPERACIONAL COMPLETO ----------------
test('fluxo completo: solicitação → prova → ajuste → retirada → devolução com manutenção → liberação', async () => {
  const p = createProduct(db, { name: 'Traje Fluxo', category: 'MASCULINO', status: 'ATIVO', sizes: [{ size: 'G', stock: 2 }] });
  const create = await api('POST', '/api/public/reservations', reservationBody({ customer: { name: 'Fluxo Cliente', whatsapp: '47955554444' }, items: [{ productId: p, size: 'G', quantity: 1 }] }));
  const list = await A('GET', '/api/admin/reservations?q=Fluxo');
  const id = list.json[0].id; const item = list.json[0].items[0].id;
  const st = (to: string) => A('POST', `/api/admin/reservations/${id}/status`, { to });
  const avail = async (from = '2026-10-16', to = '2026-10-19') => (await api('GET', `/api/public/products/traje-fluxo?from=${from}&to=${to}`)).json.sizes[0].available;

  assert.equal(await avail(), 1);                                         // pendente bloqueia
  assert.equal((await st('RETIRADO')).status, 409);                       // atalho proibido
  assert.equal((await st('CONFIRMADA')).status, 200);
  const f = await A('POST', `/api/admin/reservations/${id}/fittings`, { date: '2026-10-10', time: '14:30', itemId: item }); assert.equal(f.status, 201);
  assert.equal((await A('GET', `/api/admin/reservations/${id}`)).json.status, 'PROVA_AGENDADA');
  assert.equal((await A('POST', `/api/admin/fittings/${f.json.id}/complete`, { result: 'Calça longa' })).status, 200);
  const adj = await A('POST', `/api/admin/reservations/${id}/adjustments`, { itemId: item, description: 'Regular comprimento da calça.' });
  assert.equal((await st('PRONTO_PARA_RETIRADA')).status, 409);           // ajuste pendente impede
  await A('PUT', `/api/admin/adjustments/${adj.json.id}`, { status: 'CONCLUIDO' });
  assert.equal((await A('GET', `/api/admin/reservations/${id}`)).json.status, 'AJUSTE_CONCLUIDO');
  assert.equal((await st('PRONTO_PARA_RETIRADA')).status, 200);

  const dash = await A('GET', '/api/admin/dashboard'); assert.equal(dash.json.ready, 1);
  assert.equal((await st('RETIRADO')).status, 200);
  assert.equal((await A('POST', `/api/admin/reservations/${id}/cancel`, {})).status, 409);   // não cancela após retirada

  // devolução atrasada (o relógio avança 20 dias; a sessão é renovada e o relógio SEMPRE volta no finally)
  clock.t = new Date('2026-10-25T15:00:00Z');
  adminCookie = await loginAs('admin@trajeville.test', 'senha-super-forte-1');
  try {
  const dash2 = await A('GET', '/api/admin/dashboard');
  assert.ok(dash2.json.overdue.some((r: any) => r.id === id && r.overdue));
  assert.equal(await avail('2026-11-10', '2026-11-12'), 1);               // 2 totais − 1 atrasada
  const cal = await A('GET', '/api/admin/calendar?from=2026-10-01&to=2026-10-31');
  assert.ok(cal.json.entries.some((e: any) => e.reservationId === id && e.overdue));
  assert.equal((await A('GET', `/api/admin/reservations/${id}`)).json.events.filter((e: any) => e.type === 'DEVOLUCAO_ATRASADA').length, 1);

  const ret = await A('POST', `/api/admin/reservations/${id}/return`, { lines: [{ itemId: item, condition: 'MANUTENCAO', reason: 'Costura da calça' }] });
  assert.equal(ret.status, 200, ret.text);
  assert.equal((await A('GET', `/api/admin/reservations/${id}`)).json.status, 'MANUTENCAO');
  assert.equal(await avail('2026-11-10', '2026-11-12'), 1);               // em manutenção: continua indisponível
  const m = (await A('GET', '/api/admin/maintenance?status=EM_MANUTENCAO')).json.find((x: any) => x.product === 'Traje Fluxo');
  assert.equal((await A('POST', `/api/admin/maintenance/${m.id}/release`, {})).status, 200);
  assert.equal(await avail('2026-11-10', '2026-11-12'), 2);               // liberada
  assert.equal((await A('GET', `/api/admin/reservations/${id}`)).json.status, 'FINALIZADA');
  assert.equal((await A('POST', `/api/admin/maintenance/${m.id}/release`, {})).status, 409);
  } finally {
    clock.t = new Date('2026-10-05T15:00:00Z');
    adminCookie = await loginAs('admin@trajeville.test', 'senha-super-forte-1');
  }
});

test('cancelar pela API libera a quantidade e permite nova solicitação', async () => {
  const p = createProduct(db, { name: 'Traje Cancelável', category: 'FEMININO', status: 'ATIVO', sizes: [{ size: 'PP', stock: 1 }] });
  const body = reservationBody({ customer: { name: 'Cancela Cliente', whatsapp: '47933332222' }, items: [{ productId: p, size: 'PP', quantity: 1 }] });
  assert.equal((await api('POST', '/api/public/reservations', body)).status, 201);
  assert.equal((await api('POST', '/api/public/reservations', body)).status, 409);
  const id = (await A('GET', '/api/admin/reservations?q=Cancela')).json[0].id;
  assert.equal((await A('POST', `/api/admin/reservations/${id}/cancel`, { reason: 'Desistiu' })).status, 200);
  assert.equal((await api('POST', '/api/public/reservations', body)).status, 201);
});

test('estoque admin: edita só o total; não reduz abaixo do comprometido; clientes e histórico', async () => {
  const stock = await A('GET', '/api/admin/stock?date=2026-10-17');
  const bav = stock.json.find((s: any) => s.id === baviera);
  assert.deepEqual(bav.sizes.map((s: any) => s.size), ['M', 'G', 'GG']);
  const g = bav.sizes.find((s: any) => s.size === 'G');
  assert.equal(g.total, 4); assert.equal(g.available, g.total - g.reserved - g.inUse - g.awaitingReturn - g.overdue - g.maintenance);
  assert.equal((await A('PUT', `/api/admin/products/${baviera}/sizes/G`, { stock: 0 })).status, 409);
  assert.equal((await A('PUT', `/api/admin/products/${baviera}/sizes/G`, { stock: 6 })).status, 200);
  assert.equal((await A('PUT', `/api/admin/products/${baviera}/sizes/42`, { stock: 6 })).status, 400);
  const cs = await A('GET', '/api/admin/customers?q=João'); assert.ok(cs.json.length >= 1);
  const det = await A('GET', `/api/admin/customers/${cs.json[0].id}`); assert.ok(det.json.history.length >= 1);
  assert.equal((await A('PUT', `/api/admin/customers/${cs.json[0].id}`, { notes: 'Cliente frequente' })).status, 200);
});

test('produtos admin: criar com tamanhos, validar escala, editar, status', async () => {
  const bad = await A('POST', '/api/admin/products', { name: 'Traje Numérico', category: 'MASCULINO', sizes: [{ size: '38', stock: 1 }] });
  assert.equal(bad.status, 400);
  const ok = await A('POST', '/api/admin/products', { name: 'Traje Novo Teste', category: 'FEMININO', status: 'ATIVO', sizes: [{ size: 'PP', stock: 1 }, { size: 'XXG', stock: 2 }] });
  assert.equal(ok.status, 201);
  assert.equal((await A('PUT', `/api/admin/products/${ok.json.id}`, { status: 'INATIVO' })).status, 200);
  assert.ok(!(await api('GET', '/api/public/products')).json.some((p: any) => p.id === ok.json.id));
  assert.equal((await A('POST', `/api/admin/products/${ok.json.id}/sizes`, { size: 'M', stock: 1 })).status, 201);
  assert.equal((await A('POST', `/api/admin/products/${ok.json.id}/sizes`, { size: 'M', stock: 1 })).status, 409);
});

// ---------------- UPLOAD ----------------
test('upload: valida pelos bytes, serve com nosniff, principal/ordem/exclusão sem misturar produtos', async () => {
  const up = (pid: number, buf: Buffer, ctype = 'image/jpeg') => A('POST', `/api/admin/products/${pid}/images?alt=Frente`, undefined, { raw: buf, ctype });
  assert.equal((await up(baviera, Buffer.from('<svg onload=alert(1)></svg>'), 'image/jpeg')).status, 400);
  assert.equal((await up(baviera, Buffer.from('#!/bin/sh\necho hacked'.padEnd(50, ' ')), 'image/png')).status, 400);
  assert.equal((await up(baviera, Buffer.alloc(11 * 1024 * 1024, 1))).status, 413);
  assert.equal((await api('POST', `/api/admin/products/${baviera}/images`, undefined, { raw: JPEG })).status, 401);
  const a = await up(baviera, JPEG); const b = await up(baviera, Buffer.concat([JPEG, Buffer.from([9])]));
  assert.equal(a.status, 201); assert.match(a.json.path, /^\/uploads\/[a-f0-9]{32}\.jpg$/);
  const served = await fetch(base + a.json.path);
  assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'image/jpeg'); assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  let p = (await api('GET', '/api/public/products/traje-masculino-baviera')).json;
  assert.equal(p.primaryImage, a.json.path); assert.equal(p.images.length, 2);
  assert.equal((await A('PUT', `/api/admin/products/${baviera}/images/${b.json.id}/primary`)).status, 200);
  assert.equal((await api('GET', '/api/public/products/traje-masculino-baviera')).json.primaryImage, b.json.path);
  assert.equal((await A('DELETE', `/api/admin/products/${feminino}/images/${a.json.id}`)).status, 404);   // outro produto
  assert.equal((await A('DELETE', `/api/admin/products/${baviera}/images/${a.json.id}`)).status, 200);
  assert.equal((await fetch(base + a.json.path)).status, 404);                                              // arquivo removido
  assert.equal((await api('GET', '/api/public/products/traje-feminino-classico')).json.primaryImage, null);  // sem foto → placeholder
  await A('DELETE', `/api/admin/products/${baviera}/images/${b.json.id}`);
});

test('galeria e hero: upload, definir imagem do hero, exclusão limpa a configuração', async () => {
  const g = await A('POST', '/api/admin/gallery?caption=Traje%20azul', undefined, { raw: JPEG });
  assert.equal(g.status, 201);
  assert.equal((await A('PUT', '/api/admin/settings', { hero_image: g.json.path })).status, 200);
  assert.equal((await api('GET', '/api/public/gallery')).json.length, 1);
  assert.equal((await api('GET', '/api/public/settings')).json.hero_image, g.json.path);
  await A('DELETE', `/api/admin/gallery/${g.json.id}`);
  assert.equal((await api('GET', '/api/public/settings')).json.hero_image, '');
  assert.equal((await api('GET', '/api/public/gallery')).json.length, 0);
});

test('FAQ editável: público vê só publicadas', async () => {
  const f = await A('POST', '/api/admin/faqs', { question: 'Pergunta oculta?', answer: 'Resposta.', published: false });
  assert.ok(!(await api('GET', '/api/public/faqs')).json.some((x: any) => x.question === 'Pergunta oculta?'));
  assert.ok((await A('GET', '/api/admin/faqs')).json.some((x: any) => x.id === f.json.id));
  assert.equal((await A('PUT', `/api/admin/faqs/${f.json.id}`, { question: 'Pergunta visível?', answer: 'Resposta.', published: true })).status, 200);
  assert.ok((await api('GET', '/api/public/faqs')).json.some((x: any) => x.question === 'Pergunta visível?'));
  assert.ok((await api('GET', '/api/public/faqs')).json.length >= 10);
});

// ---------------- SEO / ESTÁTICOS ----------------
test('SEO: título, descrição, Open Graph, JSON-LD; demonstração e admin não indexam; 404 real', async () => {
  const home = await api('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<title>Aluguel de traje alemão em Joinville \| Oktoberfest \| Trajeville<\/title>/);
  assert.match(home.text, /og:title/); assert.match(home.text, /application\/ld\+json/); assert.match(home.text, /ClothingStore/);
  assert.match(home.text, /rel="canonical" href="https:\/\/trajeville\.example\/"/);
  const prod = await api('GET', '/trajes/traje-masculino-baviera');
  assert.match(prod.text, /<title>Aluguel Traje Masculino Baviera — traje alemão masculino \| Trajeville<\/title>/);
  assert.match(prod.text, /"@type":"Product"/); assert.match(prod.text, /index,follow/);
  assert.ok(!prod.text.includes('</script><b>'), 'JSON-LD não pode permitir quebra de <script>');
  assert.match((await api('GET', '/trajes/traje-feminino-classico')).text, /noindex/);               // is_demo
  const missing = await api('GET', '/trajes/nao-existe'); assert.equal(missing.status, 404); assert.match(missing.text, /noindex/);
  assert.equal((await api('GET', '/trajes/rascunho-escondido')).status, 404);
  assert.match((await api('GET', '/admin/reservas')).text, /noindex/);
  assert.equal((await api('GET', '/trajes')).status, 200); assert.equal((await api('GET', '/reservar')).status, 200);
});

test('sitemap e robots; ativos reais listados, demonstração/admin não', async () => {
  const sm = await api('GET', '/sitemap.xml');
  assert.match(sm.text, /<loc>https:\/\/trajeville\.example\/trajes\/traje-masculino-baviera<\/loc>/);
  assert.ok(!sm.text.includes('classico') && !sm.text.includes('admin') && !sm.text.includes('rascunho'));
  const rb = await api('GET', '/robots.txt'); assert.match(rb.text, /Disallow: \/admin/); assert.match(rb.text, /Sitemap: https:\/\/trajeville\.example\/sitemap\.xml/);
});

test('estáticos: assets com cache, cabeçalhos de segurança, sem path traversal', async () => {
  const a = await fetch(base + '/assets/app-abc.js');
  assert.equal(a.status, 200); assert.match(a.headers.get('cache-control')!, /immutable/);
  const home = await fetch(base + '/');
  assert.match(home.headers.get('content-security-policy')!, /default-src 'self'/);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  for (const p of ['/uploads/../../etc/passwd', '/uploads/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/assets/../../package.json', '/..%2f..%2fpackage.json', '/uploads/zzz.jpg'])
    assert.ok([400, 404].includes((await fetch(base + p)).status), p);
  assert.equal((await api('GET', '/api/nao-existe')).status, 404);
  assert.equal((await api('DELETE', '/api/public/products')).status, 405);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
});

test('marca: nenhuma grafia errada de Trajeville nos arquivos de servidor', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const f of walk('server')) assert.ok(!/Trajevile|TrajeVile|Traje Ville|Trajevillé/.test(readFileSync(f, 'utf8')), f);
});
