export type ErrorCode =
  | 'VALIDATION' | 'DATES' | 'UNAVAILABLE' | 'NOT_FOUND' | 'INVALID_TRANSITION'
  | 'CONFLICT' | 'FORBIDDEN' | 'UNAUTHENTICATED';

/** Erro de regra de negócio com mensagem pronta para o usuário final (pt-BR). */
export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
    this.name = 'DomainError';
  }
}
export const NOT_ENOUGH_MESSAGE = 'Não há quantidade suficiente disponível para este período.';
