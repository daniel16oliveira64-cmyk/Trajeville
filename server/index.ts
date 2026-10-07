// Ponto de entrada. Variáveis de ambiente:
//   PORT (3000) · DATABASE_PATH (./data/trajeville.db) · UPLOAD_DIR (./data/uploads) · SITE_URL (opcional, ex. https://trajeville.com.br)
//   SESSION_SECRET (≥32 caracteres; OBRIGATÓRIO em produção) · NODE_ENV=production · TRUST_PROXY=1 (atrás de proxy) · SECURE_COOKIES=1 (HTTPS)
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDb } from './db/connection.ts';
import { createApp } from './http/app.ts';
import { createAdminUser } from './auth/auth.ts';
import { SETTING_DEFAULTS, setSetting } from './services/settings.ts';
import { ensureDefaultFaqs } from './services/admin.ts';
import { refreshOverdue } from './services/operations.ts';
import { todayISO } from './domain/dates.ts';

const env = process.env;
const production = env.NODE_ENV === 'production';
const dbPath = resolve(env.DATABASE_PATH ?? './data/trajeville.db');
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);

for (const [k, v] of Object.entries(SETTING_DEFAULTS))
  if (!db.prepare('SELECT 1 FROM settings WHERE key=?').get(k)) setSetting(db, k, v);
ensureDefaultFaqs(db);

let secret = env.SESSION_SECRET ?? '';
if (secret.length < 32) {
  if (production) { console.error('ERRO: defina SESSION_SECRET com ao menos 32 caracteres.'); process.exit(1); }
  secret = randomBytes(32).toString('hex');
  console.warn('Aviso (desenvolvimento): SESSION_SECRET não definido; as sessões serão encerradas ao reiniciar.');
}

// Desenvolvimento: se não houver administrador, cria um com senha ALEATÓRIA exibida uma única vez.
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const email = env.ADMIN_EMAIL ?? 'admin@trajeville.local';
  const password = env.ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');
  if (production && !env.ADMIN_PASSWORD) { console.error('ERRO: em produção, defina ADMIN_EMAIL e ADMIN_PASSWORD para criar o primeiro administrador.'); process.exit(1); }
  createAdminUser(db, { email, name: 'Administrador', password });
  if (!env.ADMIN_PASSWORD) console.log(`\n  Administrador criado:\n    e-mail: ${email}\n    senha:  ${password}\n  (anote agora: esta senha não será exibida novamente)\n`);
}

const app = createApp({
  db, secret, uploadDir: resolve(env.UPLOAD_DIR ?? './data/uploads'), webDir: resolve('./web/dist'),
  secure: env.SECURE_COOKIES === '1', trustProxy: env.TRUST_PROXY === '1', siteUrl: env.SITE_URL,
});
setInterval(() => { try { refreshOverdue(db, { today: todayISO() }); } catch (e) { console.error(e); } }, 60 * 60_000).unref();
refreshOverdue(db, { today: todayISO() });

const port = Number(env.PORT ?? 3000);
app.listen(port, () => console.log(`Trajeville no ar:  http://localhost:${port}   (painel: http://localhost:${port}/admin)`));
