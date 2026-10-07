-- Trajeville — esquema do banco (dialeto SQLite; portável para PostgreSQL).
-- Datas de locação são TEXT 'YYYY-MM-DD' (dia civil, sem fuso).
-- NOTA: não existe coluna "disponível". Disponibilidade é SEMPRE calculada.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('ADMIN','STAFF')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('FEMININO','MASCULINO')),
  name TEXT NOT NULL
);
INSERT OR IGNORE INTO categories (code, name) VALUES ('FEMININO','Trajes femininos'), ('MASCULINO','Trajes masculinos');

-- Escala oficial e única: PP → P → M → G → GG → XG → XXG
CREATE TABLE IF NOT EXISTS sizes (
  code       TEXT PRIMARY KEY CHECK (code IN ('PP','P','M','G','GG','XG','XXG')),
  sort_order INTEGER NOT NULL UNIQUE
);
INSERT OR IGNORE INTO sizes (code, sort_order) VALUES
  ('PP',1),('P',2),('M',3),('G',4),('GG',5),('XG',6),('XXG',7);

CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  category_id     INTEGER NOT NULL REFERENCES categories(id),
  description     TEXT NOT NULL DEFAULT '',
  included_pieces TEXT NOT NULL DEFAULT '',
  accessories     TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('ATIVO','INATIVO','RASCUNHO')),
  is_demo         INTEGER NOT NULL DEFAULT 0,   -- 1 = dado de demonstração (nunca é produto real)
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Somente fotos reais enviadas pela Trajeville. Sem foto = placeholder no frontend.
CREATE TABLE IF NOT EXISTS product_images (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  alt        TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_primary_image ON product_images(product_id) WHERE is_primary = 1;

-- Tamanhos que o produto realmente possui
CREATE TABLE IF NOT EXISTS product_sizes (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size_code  TEXT NOT NULL REFERENCES sizes(code),
  PRIMARY KEY (product_id, size_code)
);

-- Estoque TOTAL por produto + tamanho (único número editável pelo administrador)
CREATE TABLE IF NOT EXISTS inventory (
  product_id  INTEGER NOT NULL,
  size_code   TEXT NOT NULL,
  total_stock INTEGER NOT NULL DEFAULT 0 CHECK (total_stock >= 0),
  PRIMARY KEY (product_id, size_code),
  FOREIGN KEY (product_id, size_code) REFERENCES product_sizes(product_id, size_code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  whatsapp   TEXT NOT NULL UNIQUE,   -- somente dígitos
  email      TEXT,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reservations (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  group_name  TEXT,
  event_date  TEXT NOT NULL,
  pickup_date TEXT NOT NULL,
  return_date TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'SOLICITADA' CHECK (status IN (
    'SOLICITADA','EM_ANALISE','CONFIRMADA','PROVA_AGENDADA','PROVA_REALIZADA',
    'AJUSTE_NECESSARIO','AJUSTE_CONCLUIDO','PRONTO_PARA_RETIRADA','RETIRADO','EM_USO',
    'AGUARDANDO_DEVOLUCAO','DEVOLVIDO','MANUTENCAO','FINALIZADA','CANCELADA')),
  overdue_flagged_at TEXT,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (pickup_date <= event_date AND event_date <= return_date)
);
CREATE INDEX IF NOT EXISTS ix_res_status ON reservations(status);
CREATE INDEX IF NOT EXISTS ix_res_period ON reservations(pickup_date, return_date);

-- Cada linha = um participante/peça (grupos têm várias linhas)
CREATE TABLE IF NOT EXISTS reservation_items (
  id               INTEGER PRIMARY KEY,
  reservation_id   INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  product_id       INTEGER NOT NULL,
  size_code        TEXT NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  participant_name TEXT,
  returned_at      TEXT,           -- data real da devolução (NULL = ainda reservado / com o cliente)
  return_condition TEXT CHECK (return_condition IN ('OK','MANUTENCAO')),
  FOREIGN KEY (product_id, size_code) REFERENCES product_sizes(product_id, size_code)
);
CREATE INDEX IF NOT EXISTS ix_items_stock ON reservation_items(product_id, size_code);

-- Auditoria/histórico de cada reserva
CREATE TABLE IF NOT EXISTS reservation_events (
  id             INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  from_status    TEXT,
  to_status      TEXT,
  note           TEXT NOT NULL DEFAULT '',
  user_id        INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fittings (
  id             INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  item_id        INTEGER REFERENCES reservation_items(id) ON DELETE CASCADE,
  scheduled_date TEXT NOT NULL,
  scheduled_time TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'AGENDADA' CHECK (status IN ('AGENDADA','REALIZADA','CANCELADA')),
  result         TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS adjustments (
  id             INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  item_id        INTEGER NOT NULL REFERENCES reservation_items(id) ON DELETE CASCADE,
  description    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','EM_AJUSTE','CONCLUIDO')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  done_at        TEXT
);

CREATE TABLE IF NOT EXISTS returns (
  id                  INTEGER PRIMARY KEY,
  reservation_item_id INTEGER NOT NULL UNIQUE REFERENCES reservation_items(id) ON DELETE CASCADE,
  expected_date       TEXT NOT NULL,
  actual_date         TEXT NOT NULL,
  checked_by          TEXT NOT NULL,
  condition           TEXT NOT NULL CHECK (condition IN ('OK','MANUTENCAO')),
  notes               TEXT NOT NULL DEFAULT '',
  was_late            INTEGER NOT NULL DEFAULT 0
);

-- Unidades fora de circulação. Enquanto EM_MANUTENCAO, a unidade não conta como disponível.
CREATE TABLE IF NOT EXISTS maintenance (
  id                  INTEGER PRIMARY KEY,
  product_id          INTEGER NOT NULL,
  size_code           TEXT NOT NULL,
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  reason              TEXT NOT NULL,
  reservation_item_id INTEGER REFERENCES reservation_items(id),
  status              TEXT NOT NULL DEFAULT 'EM_MANUTENCAO' CHECK (status IN ('EM_MANUTENCAO','LIBERADO')),
  opened_at           TEXT NOT NULL DEFAULT (datetime('now')),
  released_at         TEXT,
  released_by         TEXT,
  FOREIGN KEY (product_id, size_code) REFERENCES product_sizes(product_id, size_code)
);
CREATE INDEX IF NOT EXISTS ix_maint_open ON maintenance(product_id, size_code, status);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 1
);

-- Somente fotos reais da Trajeville
CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY, path TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
