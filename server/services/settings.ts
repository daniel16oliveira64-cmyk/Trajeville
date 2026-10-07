import type { DB } from '../db/connection.ts';

/** Valores padrão. O WhatsApp NUNCA tem valor inventado: fica vazio até o admin configurar. */
export const SETTING_DEFAULTS: Record<string, string> = {
  business_name: 'Trajeville',
  instagram_url: 'https://www.instagram.com/trajeville/',
  whatsapp_number: '',
  address: '',
  opening_hours: '',
  block_pending_stock: 'true',     // "Bloquear estoque durante solicitações pendentes?" padrão SIM
  hero_image: '', logo_image: '',
  policy_fitting: '', policy_pickup: '', policy_return: '', policy_reservation: '', policy_cancellation: '',
};

export function getSetting(db: DB, key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? SETTING_DEFAULTS[key] ?? '';
}
export function setSetting(db: DB, key: string, value: string): void {
  if (!(key in SETTING_DEFAULTS)) throw new Error(`Configuração desconhecida: ${key}`);
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}
export const blockPendingStock = (db: DB): boolean => getSetting(db, 'block_pending_stock') !== 'false';
