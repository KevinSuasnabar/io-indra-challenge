import { buildCardRequestedDlqEvent, buildCardsIssuedEvent } from '../../src/modules/domain/events';
import { CARDS_ISSUED_TOPIC, CARD_REQUESTED_DLQ_TOPIC } from '../../src/constants/kafka-topics';

describe('event builders (exact README contract)', () => {
  describe('buildCardsIssuedEvent', () => {
    it('builds io.cards.issued.v1 with the exact shape defined in the README', () => {
      const card = { number: '4111111111111111', expiry: '12/30', cvv: '123' };
      const event = buildCardsIssuedEvent({
        requestId: 'a097d1e9-493f-4d31-a964-b408ab54645c',
        documentNumber: '11654321',
        card,
      });

      expect(event).toEqual({
        id: 2,
        source: 'a097d1e9-493f-4d31-a964-b408ab54645c',
        type: CARDS_ISSUED_TOPIC,
        data: {
          requestId: 'a097d1e9-493f-4d31-a964-b408ab54645c',
          documentNumber: '11654321',
          card,
          status: 'issued',
        },
      });
    });
  });

  describe('buildCardRequestedDlqEvent', () => {
    it('builds io.card.requested.v1.dlq with reason, attempts, and the original payload', () => {
      const originalPayload = { customer: { documentNumber: '11654321' }, forceError: true };
      const event = buildCardRequestedDlqEvent({
        requestId: 'a097d1e9-493f-4d31-a964-b408ab54645c',
        documentNumber: '11654321',
        originalPayload,
        reason: 'Retries exhausted: transient failure from the external approval simulator',
        attempts: 3,
      });

      expect(event).toEqual({
        id: 2,
        source: 'a097d1e9-493f-4d31-a964-b408ab54645c',
        type: CARD_REQUESTED_DLQ_TOPIC,
        data: {
          requestId: 'a097d1e9-493f-4d31-a964-b408ab54645c',
          documentNumber: '11654321',
          originalPayload,
          error: {
            reason: 'Retries exhausted: transient failure from the external approval simulator',
            attempts: 3,
          },
        },
      });
    });

    it('builds the invalid-schema DLQ event with attempts: 0 and no documentNumber', () => {
      const event = buildCardRequestedDlqEvent({
        requestId: 'unknown-req',
        originalPayload: { this: 'is not a valid event' },
        reason: 'The event does not match the expected schema',
        attempts: 0,
      });

      expect(event.data.error).toEqual({
        reason: 'The event does not match the expected schema',
        attempts: 0,
      });
      expect(event.data.documentNumber).toBeUndefined();
    });
  });
});
