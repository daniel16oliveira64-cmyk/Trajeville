import { DomainError } from './errors.ts';
import { diffDays, isIsoDate } from './dates.ts';
import { MAX_PERIOD_DAYS } from './constants.ts';

/** Regras de período de locação. Módulo puro: usado pelo servidor E pelo navegador (mesmas mensagens). */
export function validateDates(p: { eventDate: string; pickupDate: string; returnDate: string }, today: string) {
  for (const [k, label] of [['eventDate', 'do evento'], ['pickupDate', 'de retirada'], ['returnDate', 'de devolução']] as const)
    if (!isIsoDate(p[k])) throw new DomainError('DATES', `Informe uma data ${label} válida.`);
  if (p.pickupDate < today) throw new DomainError('DATES', 'A data de retirada não pode estar no passado.');
  if (p.pickupDate > p.eventDate) throw new DomainError('DATES', 'A retirada precisa ser no dia do evento ou antes dele.');
  if (p.returnDate < p.pickupDate) throw new DomainError('DATES', 'A devolução não pode ser anterior à retirada.');
  if (p.returnDate < p.eventDate) throw new DomainError('DATES', 'A devolução precisa ser no dia do evento ou depois dele.');
  if (diffDays(p.pickupDate, p.returnDate) > MAX_PERIOD_DAYS) throw new DomainError('DATES', `O período de locação não pode passar de ${MAX_PERIOD_DAYS} dias.`);
}
