import { z } from 'zod';

export const cardRequestListQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int('limit must be an integer')
      .min(1, 'limit must be greater than or equal to 1')
      .max(100, 'limit must be less than or equal to 100')
      .default(20),
    cursor: z.string().min(1, 'cursor cannot be an empty string').optional(),
  })
  .strict();

export type CardRequestListQueryInput = z.infer<typeof cardRequestListQuerySchema>;
