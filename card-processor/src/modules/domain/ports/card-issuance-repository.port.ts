import { CardIssuance } from '../card-issuance';

export type CardIssuanceRepository = {
  findByRequestId(requestId: string): Promise<CardIssuance | null>;
  save(record: CardIssuance): Promise<void>;
};
