import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import type { DB } from '../db/connection.ts';
import { DomainError } from '../domain/errors.ts';

export function hashPassword(password: string): string {
  if (password.length < 10) throw new DomainError('VALIDATION', 'A senha deve ter ao menos 10 caracteres.');
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

export function createAdminUser(db: DB, a: { email: string; name: string; password: string; role?: 'ADMIN' | 'STAFF' }): number {
  const email = a.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError('VALIDATION', 'E-mail inválido.');
  return Number(db.prepare('INSERT INTO users(email,name,password_hash,role) VALUES(?,?,?,?)').run(email, a.name.trim(), hashPassword(a.password), a.role ?? 'ADMIN').lastInsertRowid);
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export interface Session { uid: number; role: 'ADMIN' | 'STAFF'; exp: number }

/** Token assinado (HMAC-SHA256). O segredo vem de variável de ambiente; nunca fica no código. */
export function signSession(s: Session, secret: string): string {
  if (secret.length < 32) throw new Error('SESSION_SECRET precisa ter ao menos 32 caracteres.');
  const body = b64(JSON.stringify(s));
  return `${body}.${b64(createHmac('sha256', secret).update(body).digest())}`;
}
export function verifySession(token: string, secret: string, nowMs = Date.now()): Session | null {
  const [body, sig] = (token ?? '').split('.');
  if (!body || !sig) return null;
  const good = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== good.length || !timingSafeEqual(good, given)) return null;
  const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session;
  return s.exp > nowMs ? s : null;
}

/** Login com mensagem genérica (não revela se o e-mail existe) e custo constante aproximado. */
const DUMMY = hashPassword('senha-falsa-para-tempo-constante');
export function login(db: DB, email: string, password: string, secret: string, ttlMs = 8 * 3600_000, nowMs = Date.now()): { token: string; user: { id: number; name: string; role: string } } {
  const u = db.prepare('SELECT id,name,role,password_hash AS h FROM users WHERE email=?').get((email ?? '').trim().toLowerCase()) as any;
  const ok = verifyPassword(password ?? '', u?.h ?? DUMMY);
  if (!u || !ok) throw new DomainError('UNAUTHENTICATED', 'E-mail ou senha incorretos.');
  return { token: signSession({ uid: u.id, role: u.role, exp: nowMs + ttlMs }, secret), user: { id: u.id, name: u.name, role: u.role } };
}
