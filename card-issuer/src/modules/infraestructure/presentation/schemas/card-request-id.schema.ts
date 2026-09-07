import { z } from 'zod';

export const cardRequestIdParamSchema = z
  .object({
    requestId: z.uuid('requestId is not a valid UUID'),
  })
  .strict();

export type CardRequestIdParamInput = z.infer<typeof cardRequestIdParamSchema>;
