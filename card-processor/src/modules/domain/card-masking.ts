import { CardDetails } from './card-issuance';

export function maskCardNumber(number: string): string {
  const last4 = number.slice(-4);
  return `**** **** **** ${last4}`;
}

export const MASKED_CVV = '***';

export interface MaskedCardDetails {
  number: string;
  expiry: string;
  cvv: string;
}

export function maskCardForLog(card: CardDetails): MaskedCardDetails {
  return {
    number: maskCardNumber(card.number),
    expiry: card.expiry,
    cvv: MASKED_CVV,
  };
}
