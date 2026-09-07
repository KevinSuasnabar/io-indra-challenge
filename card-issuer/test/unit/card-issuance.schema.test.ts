import { cardIssuanceRequestSchema } from '../../src/modules/infraestructure/presentation/schemas/card-issuance.schema';

function validPayload() {
  return {
    customer: {
      documentType: 'DNI',
      documentNumber: '11654321',
      fullName: 'Jose Peréz',
      age: 25,
      email: 'joseperez@example.com',
    },
    product: { type: 'VISA', currency: 'PEN' },
    forceError: false,
  };
}

describe('cardIssuanceRequestSchema', () => {
  it('accepts a valid payload', () => {
    const result = cardIssuanceRequestSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
  });

  it('defaults forceError to false when omitted', () => {
    const payload = validPayload();
    // @ts-expect-error -- forceError
    delete payload.forceError;
    const result = cardIssuanceRequestSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.forceError).toBe(false);
    }
  });

  it('rejects unknown fields on the root object', () => {
    const payload = { ...validPayload(), extra: 'should not be here' };
    const result = cardIssuanceRequestSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields inside customer', () => {
    const payload = validPayload();
    (payload.customer as Record<string, unknown>).nickname = 'pepe';
    const result = cardIssuanceRequestSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields inside product', () => {
    const payload = validPayload();
    (payload.product as Record<string, unknown>).network = 'plus';
    const result = cardIssuanceRequestSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  describe('customer.documentType', () => {
    it('rejects a documentType other than DNI', () => {
      const payload = validPayload();
      payload.customer.documentType = 'PASAPORTE';
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('customer.documentNumber', () => {
    it.each(['1165432', '116543211', 'ABCD1234', '1165432a', ''])(
      'rejects invalid documentNumber: %s',
      (documentNumber) => {
        const payload = validPayload();
        payload.customer.documentNumber = documentNumber;
        const result = cardIssuanceRequestSchema.safeParse(payload);
        expect(result.success).toBe(false);
      },
    );

    it('accepts exactly 8 numeric digits', () => {
      const payload = validPayload();
      payload.customer.documentNumber = '00000001';
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe('customer.fullName', () => {
    it('rejects empty fullName', () => {
      const payload = validPayload();
      payload.customer.fullName = '';
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('rejects fullName that is only whitespace', () => {
      const payload = validPayload();
      payload.customer.fullName = '   ';
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('customer.age', () => {
    it('rejects age below 18', () => {
      const payload = validPayload();
      payload.customer.age = 17;
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('accepts age = 18 (inclusive lower bound)', () => {
      const payload = validPayload();
      payload.customer.age = 18;
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects non-integer age', () => {
      const payload = validPayload();
      payload.customer.age = 25.5;
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('rejects negative age', () => {
      const payload = validPayload();
      payload.customer.age = -5;
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('customer.email', () => {
    it.each(['not-an-email', 'missing-at-sign.com', '@no-user.com', 'with space@example.com'])(
      'rejects invalid email: %s',
      (email) => {
        const payload = validPayload();
        payload.customer.email = email;
        const result = cardIssuanceRequestSchema.safeParse(payload);
        expect(result.success).toBe(false);
      },
    );
  });

  describe('product.type', () => {
    it('rejects a product.type other than VISA', () => {
      const payload = validPayload();
      payload.product.type = 'MASTERCARD';
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('product.currency', () => {
    it.each(['EUR', 'ARS', 'pen', ''])('rejects invalid currency: %s', (currency) => {
      const payload = validPayload();
      payload.product.currency = currency;
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it.each(['PEN', 'USD'])('accepts valid currency: %s', (currency) => {
      const payload = validPayload();
      payload.product.currency = currency;
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe('forceError', () => {
    it('rejects non-boolean forceError', () => {
      const payload = validPayload();
      // @ts-expect-error -- se prueba a propósito un tipo inválido
      payload.forceError = 'true';
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('accepts forceError = true', () => {
      const payload = validPayload();
      payload.forceError = true;
      const result = cardIssuanceRequestSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });
});
