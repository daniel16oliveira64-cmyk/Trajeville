// Dados de DEMONSTRAÇÃO (opcional): npm run demo
// Todos os produtos são marcados is_demo=1, ficam fora do sitemap, não são indexados e NÃO têm fotos
// (o site mostra um espaço neutro). Substitua pelos trajes reais no painel e apague estes.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDb } from './db/connection.ts';
import { createProduct } from './services/catalog.ts';
import { ensureDefaultFaqs } from './services/admin.ts';
import { SETTING_DEFAULTS, setSetting } from './services/settings.ts';

const path = resolve(process.env.DATABASE_PATH ?? './data/trajeville.db');
mkdirSync(dirname(path), { recursive: true });
const db = openDb(path);
for (const [k, v] of Object.entries(SETTING_DEFAULTS)) if (!db.prepare('SELECT 1 FROM settings WHERE key=?').get(k)) setSetting(db, k, v);
ensureDefaultFaqs(db);

if (db.prepare('SELECT 1 FROM products LIMIT 1').get()) console.log('Já existem trajes cadastrados; nada foi criado.');
else {
  const demo = (name: string, category: 'FEMININO' | 'MASCULINO', sizes: Array<[any, number]>) =>
    createProduct(db, { name: `${name} (demonstração)`, category, status: 'ATIVO', isDemo: true,
      description: 'Produto de demonstração. Substitua pelos dados e fotos reais da Trajeville.',
      includedPieces: 'Peça 1 (exemplo)\nPeça 2 (exemplo)', accessories: 'Acessório (exemplo)', sizes: sizes.map(([size, stock]) => ({ size, stock })) });
  demo('Traje Masculino Baviera', 'MASCULINO', [['M', 3], ['G', 4], ['GG', 2]]);
  demo('Traje Feminino Clássico', 'FEMININO', [['PP', 1], ['P', 2], ['M', 3], ['G', 2], ['GG', 1], ['XG', 1]]);
  demo('Traje Masculino Verde', 'MASCULINO', [['M', 2], ['G', 3], ['GG', 2], ['XG', 1], ['XXG', 1]]);
  console.log('3 trajes de demonstração criados.');
}
