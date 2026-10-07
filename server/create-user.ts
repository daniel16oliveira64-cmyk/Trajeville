// Cria (ou redefine a senha de) um usuário do painel.
// Uso: EMAIL=ana@exemplo.com NOME="Ana" SENHA='uma-senha-forte' PERFIL=STAFF npm run create-user
//   PERFIL: ADMIN (padrão; pode alterar configurações) ou STAFF (opera reservas, sem acesso às configurações)
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDb } from './db/connection.ts';
import { createAdminUser, hashPassword } from './auth/auth.ts';

const { EMAIL, NOME, SENHA, PERFIL } = process.env;
if (!EMAIL || !SENHA) { console.error('Informe EMAIL e SENHA (mín. 10 caracteres). Opcionais: NOME, PERFIL=ADMIN|STAFF'); process.exit(1); }
const path = resolve(process.env.DATABASE_PATH ?? './data/trajeville.db');
mkdirSync(dirname(path), { recursive: true });
const db = openDb(path);
const email = EMAIL.trim().toLowerCase();
const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
if (existing) { db.prepare('UPDATE users SET password_hash=? WHERE email=?').run(hashPassword(SENHA), email); console.log(`Senha redefinida para ${email}.`); }
else { createAdminUser(db, { email, name: NOME ?? email, password: SENHA, role: PERFIL === 'STAFF' ? 'STAFF' : 'ADMIN' }); console.log(`Usuário ${email} criado (${PERFIL === 'STAFF' ? 'equipe' : 'administrador'}).`); }
