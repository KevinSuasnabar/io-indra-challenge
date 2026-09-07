import { z } from 'zod';

const customerSchema = z
  .object({
    documentType: z.literal('DNI'),
    documentNumber: z
      .string()
      .regex(/^\d{8}$/, 'documentNumber must be a string of exactly 8 numeric digits'),
    fullName: z.string().trim().min(1, 'fullName must not be empty'),
    age: z
      .number()
      .int('age must be an integer')
      .gte(18, 'age must be greater than or equal to 18'),
    email: z.email('invalid email'),
  })
  .strict();

const productSchema = z
  .object({
    type: z.literal('VISA'),
    currency: z.enum(['PEN', 'USD']),
  })
  .strict();

export const cardIssuanceRequestSchema = z
  .object({
    customer: customerSchema,
    product: productSchema,
    forceError: z.boolean().default(false),
  })
  .strict();

export type CardIssuanceRequestInput = z.infer<typeof cardIssuanceRequestSchema>;
