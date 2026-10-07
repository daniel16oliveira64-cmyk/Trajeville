import type { Status } from '../../../server/domain/constants.ts';

export { formatBR } from '../../../server/domain/dates.ts';
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const monthName = (m: number) => MONTHS[m]!;
export const weekdayName = (d: number) => WEEKDAYS[d]!;
export function longDate(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}
export const categoryLabel = (c: string) => (c === 'FEMININO' ? 'Feminino' : 'Masculino');
export const categoryPlural = (c: string) => (c === 'FEMININO' ? 'Trajes femininos' : 'Trajes masculinos');
export const phoneDisplay = (digits: string) => {
  const d = digits.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : digits;
};
export const waLink = (digits: string) => { const d = digits.replace(/\D/g, ''); return `https://wa.me/${d.length <= 11 ? '55' + d : d}`; };
export const statusTone = (s: Status): string =>
  ({ SOLICITADA: 'warn', EM_ANALISE: 'warn', CONFIRMADA: 'ok', PROVA_AGENDADA: 'info', PROVA_REALIZADA: 'info', AJUSTE_NECESSARIO: 'warn',
    AJUSTE_CONCLUIDO: 'info', PRONTO_PARA_RETIRADA: 'ok', RETIRADO: 'wood', EM_USO: 'wood', AGUARDANDO_DEVOLUCAO: 'wood',
    DEVOLVIDO: 'muted', MANUTENCAO: 'warn', FINALIZADA: 'muted', CANCELADA: 'danger' } as Record<string, string>)[s] ?? 'muted';

/** O servidor grava 'YYYY-MM-DD HH:MM:SS' em UTC; exibimos no horário de Brasília. */
export function formatTs(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
