// Fonte única de verdade para tamanhos, categorias e status.

/** Escala oficial. Ordem obrigatória. Não existem tamanhos numéricos. */
export const SIZES = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XXG'] as const;
export type SizeCode = (typeof SIZES)[number];
export const isSize = (v: unknown): v is SizeCode => typeof v === 'string' && (SIZES as readonly string[]).includes(v);
export const sortSizes = <T extends string>(list: T[]): T[] =>
  [...list].sort((a, b) => SIZES.indexOf(a as SizeCode) - SIZES.indexOf(b as SizeCode));

export const CATEGORIES = ['FEMININO', 'MASCULINO'] as const;
export type CategoryCode = (typeof CATEGORIES)[number];

export const STATUSES = [
  'SOLICITADA', 'EM_ANALISE', 'CONFIRMADA', 'PROVA_AGENDADA', 'PROVA_REALIZADA',
  'AJUSTE_NECESSARIO', 'AJUSTE_CONCLUIDO', 'PRONTO_PARA_RETIRADA', 'RETIRADO', 'EM_USO',
  'AGUARDANDO_DEVOLUCAO', 'DEVOLVIDO', 'MANUTENCAO', 'FINALIZADA', 'CANCELADA',
] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  SOLICITADA: 'Solicitada', EM_ANALISE: 'Em análise', CONFIRMADA: 'Confirmada',
  PROVA_AGENDADA: 'Prova agendada', PROVA_REALIZADA: 'Prova realizada',
  AJUSTE_NECESSARIO: 'Ajuste necessário', AJUSTE_CONCLUIDO: 'Ajuste concluído',
  PRONTO_PARA_RETIRADA: 'Pronto para retirada', RETIRADO: 'Retirado', EM_USO: 'Em uso',
  AGUARDANDO_DEVOLUCAO: 'Aguardando devolução', DEVOLVIDO: 'Devolvido',
  MANUTENCAO: 'Manutenção', FINALIZADA: 'Finalizada', CANCELADA: 'Cancelada',
};
export const OVERDUE_LABEL = 'Devolução atrasada';

/** Pendentes: só bloqueiam estoque se a configuração "bloquear_estoque_pendentes" estiver ativa. */
export const PENDING_STATUSES: Status[] = ['SOLICITADA', 'EM_ANALISE'];
/** Antes da retirada (já confirmadas): sempre bloqueiam estoque. */
export const RESERVED_STATUSES: Status[] = [
  'CONFIRMADA', 'PROVA_AGENDADA', 'PROVA_REALIZADA', 'AJUSTE_NECESSARIO', 'AJUSTE_CONCLUIDO', 'PRONTO_PARA_RETIRADA',
];
/** Peça está com o cliente. */
export const IN_POSSESSION_STATUSES: Status[] = ['RETIRADO', 'EM_USO', 'AGUARDANDO_DEVOLUCAO'];
/** Cancelamento só é permitido antes da retirada. */
export const CANCELABLE_STATUSES: Status[] = [...PENDING_STATUSES, ...RESERVED_STATUSES];

/** Transições manuais permitidas. DEVOLVIDO/MANUTENCAO só ocorrem via registerReturn. */
export const TRANSITIONS: Record<Status, Status[]> = {
  SOLICITADA: ['EM_ANALISE', 'CONFIRMADA', 'CANCELADA'],
  EM_ANALISE: ['CONFIRMADA', 'CANCELADA'],
  CONFIRMADA: ['PROVA_AGENDADA', 'PRONTO_PARA_RETIRADA', 'CANCELADA'],
  PROVA_AGENDADA: ['PROVA_REALIZADA', 'CONFIRMADA', 'CANCELADA'],
  PROVA_REALIZADA: ['AJUSTE_NECESSARIO', 'PRONTO_PARA_RETIRADA', 'CANCELADA'],
  AJUSTE_NECESSARIO: ['AJUSTE_CONCLUIDO', 'CANCELADA'],
  AJUSTE_CONCLUIDO: ['PRONTO_PARA_RETIRADA', 'PROVA_AGENDADA', 'AJUSTE_NECESSARIO', 'CANCELADA'],
  PRONTO_PARA_RETIRADA: ['RETIRADO', 'CANCELADA'],
  RETIRADO: ['EM_USO', 'AGUARDANDO_DEVOLUCAO'],
  EM_USO: ['AGUARDANDO_DEVOLUCAO'],
  AGUARDANDO_DEVOLUCAO: [],
  DEVOLVIDO: ['FINALIZADA'],
  MANUTENCAO: [],           // vira FINALIZADA automaticamente quando toda manutenção for liberada
  FINALIZADA: [],
  CANCELADA: [],
};

export const MAX_PERIOD_DAYS = 120;
export const MAX_QUANTITY_PER_ITEM = 50;
