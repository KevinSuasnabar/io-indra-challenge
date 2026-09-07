import { cardRequestedEventSchema } from '../../src/modules/infraestructure/schemas/card-requested-event.schema';

function validEvent() {
  return {
    id: 1,
    source: 'a097d1e9-493f-4d31-a964-b408ab54645c',
    type: 'io.card.requested.v1',
    data: {
      customer: {
        documentType: 'DNI',
        documentNumber: '11654321',
        fullName: 'Jose Peréz',
        age: 25,
        email: 'joseperez@example.com',
      },
      product: { type: 'VISA', currency: 'PEN' },
      forceError: false,
    },
  };
}

describe('cardRequestedEventSchema', () => {
  it('accepts a valid io.card.requested.v1 event', () => {
    expect(cardRequestedEventSchema.safeParse(validEvent()).success).toBe(true);
  });

  it('rejects a type other than the expected one', () => {
    const event = { ...validEvent(), type: 'io.something.else.v1' };
    expect(cardRequestedEventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects when source is missing', () => {
    const event = validEvent() as Record<string, unknown>;
    delete event.source;
    expect(cardRequestedEventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects documentNumber with an invalid format', () => {
    const event = validEvent();
    event.data.customer.documentNumber = 'ABC';
    expect(cardRequestedEventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects age below 18', () => {
    const event = validEvent();
    event.data.customer.age = 10;
    expect(cardRequestedEventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects product.type other than VISA', () => {
    const event = validEvent();
    (event.data.product as { type: string }).type = 'MASTERCARD';
    expect(cardRequestedEventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects non-boolean forceError', () => {
    const event = validEvent() as { data: { forceError: unknown } };
    event.data.forceError = 'true';
    expect(cardRequestedEventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects unknown fields inside data.customer', () => {
    const event = validEvent();
    (event.data.customer as Record<string, unknown>).nickname = 'pepe';
    expect(cardRequestedEventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects unknown fields inside data.product', () => {
    const event = validEvent();
    (event.data.product as Record<string, unknown>).network = 'plus';
    expect(cardRequestedEventSchema.safeParse(event).success).toBe(false);
  });
});
