import { CardDetails } from './card-issuance';

/**
 * Generador de datos de tarjeta, número VISA válido por algoritmo de Luhn, fecha de
 * vencimiento futura (`MM/YY`), CVV de 3 dígitos.
 */

/** Dígito de control de Luhn para una secuencia de dígitos SIN ese dígito. */
function luhnCheckDigit(digits: number[]): number {
  let sum = 0;
  let doubleDigit = true; // el dígito más a la derecha de `digits` se dobla primero.

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits[i];
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return (10 - (sum % 10)) % 10;
}

/** Validador genérico de Luhn, usado por los tests para verificar la salida del generador. */
export function isValidLuhn(cardNumber: string): boolean {
  const digits = cardNumber.split('').map(Number);
  const checkDigit = digits.pop();
  return checkDigit === luhnCheckDigit(digits);
}

/**
 * Número VISA de 16 dígitos (prefijo `4`) con dígito de control de Luhn
 * válido.
 */
export function generateVisaCardNumber(randomFn: () => number = Math.random): string {
  const digits = [4];
  for (let i = 0; i < 14; i += 1) {
    digits.push(Math.floor(randomFn() * 10));
  }
  const checkDigit = luhnCheckDigit(digits);
  return [...digits, checkDigit].join('');
}

/**
 * Fecha de vencimiento futura en formato `MM/YY` (entre 3 y 5 años a partir
 * de `now`, rango típico de una tarjeta recién emitida).
 */
export function generateExpiry(
  now: Date = new Date(),
  randomFn: () => number = Math.random,
): string {
  const yearsAhead = 3 + Math.floor(randomFn() * 3);
  const expiryDate = new Date(now.getFullYear() + yearsAhead, now.getMonth(), 1);
  const month = String(expiryDate.getMonth() + 1).padStart(2, '0');
  const year = String(expiryDate.getFullYear() % 100).padStart(2, '0');
  return `${month}/${year}`;
}

/** CVV de exactamente 3 dígitos numéricos. */
export function generateCvv(randomFn: () => number = Math.random): string {
  return String(Math.floor(randomFn() * 1000)).padStart(3, '0');
}

export function generateCardDetails(randomFn: () => number = Math.random): CardDetails {
  return {
    number: generateVisaCardNumber(randomFn),
    expiry: generateExpiry(new Date(), randomFn),
    cvv: generateCvv(randomFn),
  };
}
