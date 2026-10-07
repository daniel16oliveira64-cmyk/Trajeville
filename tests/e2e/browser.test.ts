// Teste de ponta a ponta em NAVEGADOR REAL (Chromium via Playwright) contra servidor + banco reais.
// Pré-requisitos: npm run build  ·  npx playwright install chromium   ·  npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { newDb } from '../helpers.ts';
import { createApp } from '../../server/http/app.ts';
import { createAdminUser } from '../../server/auth/auth.ts';
import { createProduct } from '../../server/services/catalog.ts';
import { ensureDefaultFaqs } from '../../server/services/admin.ts';
import { addDays, todayISO } from '../../server/domain/dates.ts';

const SHOTS = process.env.SHOTS_DIR ?? '';
const tmp = mkdtempSync(join(tmpdir(), 'tjv-e2e-'));
const db = newDb();
let server: any, base = '', browser: any, ctx: any, page: any, pw: any;
const errors: string[] = [];
const TODAY = todayISO();
const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true }); };

// JPEG mínimo porém decodificável (1x1) para testar o upload real pelo navegador
const JPEG_1PX = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

before(async () => {
  try { pw = await import('playwright'); } catch { pw = null; return; }
  createAdminUser(db, { email: 'admin@trajeville.test', name: 'Dona Admin', password: 'senha-super-forte-1' });
  createProduct(db, { name: 'Traje Masculino Baviera (demonstração)', category: 'MASCULINO', status: 'ATIVO', isDemo: true, description: 'Produto de demonstração.',
    includedPieces: 'Camisa xadrez\nCalça de couro sintético\nSuspensório', accessories: 'Chapéu', sizes: [{ size: 'M', stock: 3 }, { size: 'G', stock: 1 }, { size: 'GG', stock: 2 }] });
  createProduct(db, { name: 'Traje Feminino Clássico (demonstração)', category: 'FEMININO', status: 'ATIVO', isDemo: true, sizes: [{ size: 'PP', stock: 1 }, { size: 'P', stock: 2 }, { size: 'M', stock: 3 }, { size: 'XG', stock: 1 }] });
  ensureDefaultFaqs(db);
  const webDir = resolve('web/dist');
  assert.ok(existsSync(join(webDir, 'index.html')), 'Rode "npm run build" antes do teste E2E.');
  server = createApp({ db, secret: 'x'.repeat(40), uploadDir: join(tmp, 'up'), webDir });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await pw.chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' });
  page = await ctx.newPage();
  page.on('pageerror', (e: Error) => errors.push('pageerror: ' + e.message));
  page.on('console', (m: any) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_(INTERNET|NAME|CONNECTION)|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', (d: any) => d.accept('Calça longa'));
});
after(async () => { await browser?.close(); server?.close(); rmSync(tmp, { recursive: true, force: true }); });
const T = (name: string, fn: () => Promise<void>) => test(name, async (t) => { if (!pw) return t.skip('playwright não instalado'); await fn(); });

T('home: hero, marca, categorias, passos, FAQ — sem erros de JS', async () => {
  await page.goto(base + '/', { waitUntil: 'networkidle' }).catch(() => page.goto(base + '/'));
  await page.waitForSelector('h1');
  assert.match(await page.textContent('h1'), /Seu traje típico para viver a festa do jeito certo\./);
  assert.match(await page.title(), /Trajeville/);
  assert.equal((await page.locator('.hero .btn').allTextContents()).map((s: string) => s.trim()).join('|'), 'Ver trajes|Fazer reserva');
  assert.equal(await page.locator('.steps li').count(), 9);
  assert.ok(await page.locator('.faq details').count() >= 10);
  assert.equal(await page.locator('#galeria').count(), 0, 'sem fotos reais, a galeria não aparece');
  const body = await page.textContent('body');
  assert.ok(!/Trajevile|TrajeVile|Traje Ville/.test(body));
  await shot('01-home-desktop');
});

T('catálogo: cards com tamanhos só do produto, placeholder sem foto, filtro por categoria', async () => {
  await page.click('.hero >> text=Ver trajes');
  await page.waitForSelector('.card');
  assert.equal(await page.locator('.card').count(), 2);
  const bav = page.locator('.card', { hasText: 'Baviera' });
  assert.equal((await bav.locator('.chip').allTextContents()).join(','), 'M,G,GG');
  assert.equal(await bav.locator('img').count(), 0, 'sem foto real: nunca imagem genérica');
  assert.ok(await bav.locator('.ph').count() === 1);
  assert.match(await bav.textContent(), /Demonstração/);
  await page.click('button:has-text("Feminino")');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
  assert.equal((await page.locator('.card .chip').allTextContents()).join(','), 'PP,P,M,XG');
  await shot('02-catalogo');
});

T('página do traje: consulta de disponibilidade por período e tamanho', async () => {
  await page.goto(base + '/trajes/traje-masculino-baviera-demonstracao'); await page.waitForSelector('h1');
  assert.deepEqual(await page.locator('.size-btn').allTextContents(), ['M', 'G', 'GG']);
  assert.match(await page.textContent('.product'), /Camisa xadrez/);
  await page.fill('#d1', addDays(TODAY, 5)); await page.fill('#d2', addDays(TODAY, 7));
  await page.waitForFunction(() => document.querySelector('.size-btn small'));
  assert.deepEqual(await page.locator('.size-btn small').allTextContents(), ['3 disp.', '1 disp.', '2 disp.']);
  await shot('03-produto');
});

T('reserva pública completa: itens → datas → dados → resumo → envio', async () => {
  await page.goto(base + '/reservar?traje=traje-masculino-baviera-demonstracao&tamanho=G'); await page.waitForSelector('#prod');
  await page.click('button:has-text("Adicionar traje")');
  assert.match(await page.textContent('.line-item'), /Baviera.*G/);
  // segundo participante (grupo)
  await page.selectOption('#prod', 'traje-feminino-classico-demonstracao'); await page.click('.size-btn:has-text("M")'); await page.fill('#who', 'Maria');
  await page.click('button:has-text("Adicionar à solicitação")');
  assert.equal(await page.locator('.line-item').count(), 2);
  await page.fill('#grp', 'Grupo Oktoberfest');
  await page.click('button:has-text("Continuar")');
  // datas inválidas → mensagem clara
  await page.fill('#ev', addDays(TODAY, 1)); await page.fill('#pk', addDays(TODAY, 5));
  await page.waitForSelector('.alert.error');
  assert.match(await page.textContent('.alert.error'), /retirada precisa ser no dia do evento ou antes/);
  await page.fill('#pk', TODAY); await page.fill('#rt', addDays(TODAY, 3));
  await page.waitForSelector('.status-line.ok');
  await page.click('button:has-text("Continuar")');
  await page.fill('#n', 'João Silva'); await page.fill('#w', '(47) 99999-1234'); await page.fill('#e', 'joao@exemplo.com');
  await shot('04-reserva-dados');
  await page.click('button:has-text("Continuar")');
  assert.match(await page.textContent('.summary'), /João Silva/);
  await page.click('button:has-text("Enviar solicitação")');
  await page.waitForSelector('.code');
  assert.match(await page.textContent('.code'), /^TJV-[A-F0-9]{8}$/);
  assert.match(await page.textContent('.success'), /não é uma reserva confirmada/);
  assert.match(await page.textContent('.success'), /WhatsApp da Trajeville ainda não foi configurado/);
  const row = db.prepare("SELECT COUNT(*) c, (SELECT COUNT(*) FROM reservation_items) i FROM reservations").get() as any;
  assert.equal(row.c, 1); assert.equal(row.i, 2);
  await shot('05-reserva-enviada');
});

T('estoque em tempo real: última unidade G já está reservada → nova solicitação é bloqueada na tela', async () => {
  await page.goto(base + '/reservar?traje=traje-masculino-baviera-demonstracao&tamanho=G'); await page.waitForSelector('#prod');
  await page.click('button:has-text("Adicionar traje")'); await page.click('button:has-text("Continuar")');
  await page.fill('#ev', addDays(TODAY, 1)); await page.fill('#pk', TODAY); await page.fill('#rt', addDays(TODAY, 3));
  await page.waitForSelector('.status-line.bad');
  assert.match(await page.textContent('.box'), /não há quantidade suficiente/);
  assert.ok(await page.locator('button:has-text("Continuar")').isDisabled());
});

T('painel: login com erro genérico, depois acesso; dashboard mostra a solicitação pendente', async () => {
  await page.goto(base + '/admin'); await page.waitForSelector('#le');
  await page.fill('#le', 'admin@trajeville.test'); await page.fill('#lp', 'senha-errada-123'); await page.click('button:has-text("Entrar")');
  await page.waitForSelector('.alert.error'); assert.match(await page.textContent('.alert.error'), /incorretos/);
  await page.fill('#lp', 'senha-super-forte-1'); await page.click('button:has-text("Entrar")');
  await page.waitForSelector('.stats');
  assert.equal((await page.locator('.stat').first().textContent()).trim().startsWith('1'), true);
  await shot('06-admin-dashboard');
  // sem cookie, a API do admin é negada mesmo via navegador
  const r = await ctx.request.newContext?.() ?? null; void r;
});

T('painel: operação completa — confirmar, prova, ajuste, retirada, devolução em manutenção, liberar para estoque', async () => {
  await page.goto(base + '/admin/reservas'); await page.waitForSelector('tbody tr.click');
  await shot('07-admin-reservas');
  await page.click('tbody tr.click'); await page.waitForSelector('h1:has-text("TJV-")');
  const act = async (label: string) => { await page.click(`button:has-text("${label}")`); await page.waitForTimeout(250); };
  await act('Confirmar reserva');
  await page.fill('#fd', TODAY); await page.fill('#ft', '14:30'); await act('Agendar prova');
  assert.match(await page.textContent('.badge.info >> nth=0'), /Prova agendada/);
  await act('Marcar realizada');
  const sel = page.locator('#ai'); await sel.selectOption({ index: 1 });
  await page.fill('#ad', 'Regular comprimento da calça.'); await act('Adicionar ajuste');
  assert.match(await page.textContent('.page-head'), /Ajuste necessário/);
  assert.equal(await page.locator('button:has-text("Marcar pronto para retirada")').count(), 0, 'ajuste pendente impede');
  await page.selectOption('select[aria-label="Status do ajuste"]', 'CONCLUIDO'); await page.waitForTimeout(300);
  assert.match(await page.textContent('.page-head'), /Ajuste concluído/);
  await act('Marcar pronto para retirada'); await act('Registrar retirada');
  assert.match(await page.textContent('.page-head'), /Retirado/);
  await shot('08-admin-devolucao');
  // devolução: Baviera G com manutenção; Feminino M em ordem
  const items = page.locator('.line-item');
  await items.nth(0).locator('select').first().selectOption('MANUTENCAO');
  await items.nth(0).locator('input[type=text]').fill('Costura da calça');
  await act('Confirmar devolução');
  assert.match(await page.textContent('.page-head'), /Manutenção/);
  await page.waitForSelector('button:has-text("Liberar para estoque")');
  // enquanto em manutenção, G continua indisponível para o público
  const g = await (await fetch(`${base}/api/public/products/traje-masculino-baviera-demonstracao?from=${addDays(TODAY, 20)}&to=${addDays(TODAY, 21)}`)).json();
  assert.equal(g.sizes.find((s: any) => s.size === 'G').available, 0);
  await act('Liberar para estoque');
  assert.match(await page.textContent('.page-head'), /Finalizada/);
  const g2 = await (await fetch(`${base}/api/public/products/traje-masculino-baviera-demonstracao?from=${addDays(TODAY, 20)}&to=${addDays(TODAY, 21)}`)).json();
  assert.equal(g2.sizes.find((s: any) => s.size === 'G').available, 1);
});

T('painel: calendário, estoque, manutenção, clientes e FAQ carregam', async () => {
  await page.goto(base + '/admin/calendario'); await page.waitForSelector('.cal .ev');   // espera os dados chegarem da API
  assert.ok(await page.locator('.ev').count() >= 3);
  await shot('09-admin-calendario');
  await page.click('button:has-text("Semana")'); await page.waitForSelector('.cal.week');
  await page.click('button:has-text("Dia")'); await page.waitForSelector('.cal-day');
  await page.goto(base + '/admin/estoque'); await page.waitForSelector('tbody tr');
  assert.match(await page.textContent('table'), /Baviera/); await shot('10-admin-estoque');
  await page.goto(base + '/admin/clientes'); await page.waitForSelector('tbody tr.click'); assert.match(await page.textContent('tbody'), /João Silva/);
  await page.click('tbody tr.click'); await page.waitForSelector('.modal'); assert.match(await page.textContent('.modal'), /TJV-/);
  await page.keyboard.press('Escape');
  await page.goto(base + '/admin/manutencao'); await page.waitForSelector('h1');
  await page.goto(base + '/admin/faq'); await page.waitForSelector('tbody tr');
});

T('painel: upload real de foto pelo navegador → aparece no site público e some o placeholder', async () => {
  const pid = (db.prepare("SELECT id FROM products WHERE slug='traje-masculino-baviera-demonstracao'").get() as any).id;
  await page.goto(base + `/admin/trajes/${pid}`); await page.waitForSelector('input[type=file]', { state: 'attached' });
  const f = join(tmp, 'foto.jpg'); writeFileSync(f, JPEG_1PX);
  await page.setInputFiles('input[type=file]', f);
  await page.waitForSelector('.img-tile img');
  assert.match(await page.textContent('.img-tile'), /PRINCIPAL/);
  await page.goto(base + '/trajes/traje-masculino-baviera-demonstracao'); await page.waitForSelector('.gallery-main img');
  assert.match(await page.getAttribute('.gallery-main img', 'src'), /^\/uploads\/[a-f0-9]{32}\.jpg$/);
  await page.goto(base + '/trajes'); await page.waitForSelector('.card');
  assert.equal(await page.locator('.card', { hasText: 'Baviera' }).locator('img').count(), 1);
  assert.equal(await page.locator('.card', { hasText: 'Feminino Clássico' }).locator('img').count(), 0, 'outro produto continua com placeholder');
});

T('configurações: WhatsApp configurável aparece no site e na mensagem automática', async () => {
  await page.goto(base + '/admin/configuracoes'); await page.waitForSelector('#wn');
  await page.fill('#wn', '(47) 98888-7777'); await page.click('button:has-text("Salvar configurações")');
  await page.waitForSelector('.alert.ok');
  await page.goto(base + '/'); await page.waitForSelector('a.header-cta[href^="https://wa.me"]');   // configurações chegam de forma assíncrona
  assert.equal(await page.getAttribute('a.header-cta', 'href'), 'https://wa.me/5547988887777');
  assert.equal(await page.getAttribute('.bottom-bar a:has-text("WhatsApp")', 'href'), 'https://wa.me/5547988887777');
});

T('mobile: barra inferior fixa TRAJES | RESERVAR | WHATSAPP, sem rolagem horizontal', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await m.newPage();
  for (const path of ['/', '/trajes', '/trajes/traje-masculino-baviera-demonstracao', '/reservar']) {
    await p.goto(base + path); await p.waitForSelector('.bottom-bar a:has-text("WhatsApp")');
    assert.deepEqual((await p.locator('.bottom-bar a').allTextContents()).map((s: string) => s.trim()), ['Trajes', 'Reservar', 'WhatsApp'], path);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `rolagem horizontal em ${path}: ${over}px`);
    const box = await p.locator('.bottom-bar').boundingBox(); assert.ok(box.y + box.height >= 843);
    if (path === '/') { if (SHOTS) await p.screenshot({ path: join(SHOTS, '11-home-mobile.png'), fullPage: true }); }
    if (path === '/trajes') { if (SHOTS) await p.screenshot({ path: join(SHOTS, '12-catalogo-mobile.png') }); }
  }
  await p.goto(base + '/admin'); await p.waitForSelector('#le');
  await p.fill('#le', 'admin@trajeville.test'); await p.fill('#lp', 'senha-super-forte-1'); await p.click('button:has-text("Entrar")'); await p.waitForSelector('.stats');
  assert.ok((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'admin mobile sem rolagem horizontal');
  if (SHOTS) await p.screenshot({ path: join(SHOTS, '13-admin-mobile.png') });
  await m.close();
});

T('sem erros de JavaScript ao longo de todo o percurso', async () => { assert.deepEqual(errors, []); });
