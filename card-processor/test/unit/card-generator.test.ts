import {
  generateCardDetails,
  generateCvv,
  generateExpiry,
  generateVisaCardNumber,
  isValidLuhn,
} from '../../src/modules/domain/card-generator';

describe('card-generator', () => {
  describe('generateVisaCardNumber', () => {
    it('generates a 16-digit number that starts with 4 (VISA)', () => {
      const number = generateVisaCardNumber(() => 0.5);
      expect(number).toHaveLength(16);
      expect(number.startsWith('4')).toBe(true);
    });

    it('generates a number that is valid according to the Luhn algorithm', () => {
      const number = generateVisaCardNumber(() => 0.5);
      expect(isValidLuhn(number)).toBe(true);
    });

    it('generates Luhn-valid numbers for different randomFn sequences', () => {
      const sequences = [0, 0.1, 0.25, 0.42, 0.6, 0.75, 0.9, 0.99];
      let i = 0;
      const cyclicRandom = () => sequences[i++ % sequences.length];

      for (let n = 0; n < 20; n += 1) {
        const number = generateVisaCardNumber(cyclicRandom);
        expect(isValidLuhn(number)).toBe(true);
      }
    });

    it('isValidLuhn rejects a number with a tampered check digit', () => {
      const number = generateVisaCardNumber(() => 0.5);
      const tampered = number.slice(0, -1) + String((Number(number.at(-1)) + 1) % 10);
      expect(isValidLuhn(tampered)).toBe(false);
    });
  });

  describe('generateExpiry', () => {
    it('generates a future date in MM/YY format', () => {
      const now = new Date(2026, 0, 1); // enero 2026
      const expiry = generateExpiry(now, () => 0);

      expect(expiry).toMatch(/^\d{2}\/\d{2}$/);
      const [month, year] = expiry.split('/').map(Number);
      expect(month).toBeGreaterThanOrEqual(1);
      expect(month).toBeLessThanOrEqual(12);
      expect(year).toBeGreaterThan(26); // al menos algunos años en el futuro respecto a 2026
    });
  });

  describe('generateCvv', () => {
    it('always generates exactly 3 numeric digits', () => {
      expect(generateCvv(() => 0)).toMatch(/^\d{3}$/);
      expect(generateCvv(() => 0.999)).toMatch(/^\d{3}$/);
      expect(generateCvv(() => 0.001)).toMatch(/^\d{3}$/);
    });
  });

  describe('generateCardDetails', () => {
    it('builds the three fields with the expected format', () => {
      const card = generateCardDetails(() => 0.5);
      expect(isValidLuhn(card.number)).toBe(true);
      expect(card.expiry).toMatch(/^\d{2}\/\d{2}$/);
      expect(card.cvv).toMatch(/^\d{3}$/);
    });
  });
});
