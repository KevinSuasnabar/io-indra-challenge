import { z } from 'zod';
import { CARD_REQUESTED_TOPIC } from '../../../constants/kafka-topics';

const customerSchema = z
  .object({
    documentType: z.literal('DNI'),
    documentNumber: z.string().regex(/^\d{8}$/),
    fullName: z.string().min(1),
    age: z.number().int().gte(18),
    email: z.email(),
  })
  .strict();

const productSchema = z
  .object({
    type: z.literal('VISA'),
    currency: z.enum(['PEN', 'USD']),
  })
  .strict();

export const cardRequestedEventSchema = z
  .object({
    id: z.number(),
    source: z.string().min(1),
    type: z.literal(CARD_REQUESTED_TOPIC),
    data: z
      .object({
        customer: customerSchema,
        product: productSchema,
        forceError: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type CardRequestedEvent = z.infer<typeof cardRequestedEventSchema>;
