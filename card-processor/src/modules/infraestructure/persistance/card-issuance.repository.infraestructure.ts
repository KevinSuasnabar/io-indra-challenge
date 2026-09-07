import Database from 'better-sqlite3';
import { CardProcessingStatusEnum } from '../../../constants/card-processing-status.enum';
import { CardIssuance } from '../../domain/card-issuance';
import { DuplicateCardIssuanceError } from '../../domain/errors';
import { CardIssuanceRepository } from '../../domain/ports/card-issuance-repository.port';

const SQLITE_UNIQUE_VIOLATION_CODE = 'SQLITE_CONSTRAINT_UNIQUE';

function isSqliteUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === SQLITE_UNIQUE_VIOLATION_CODE
  );
}

interface CardIssuanceRow {
  request_id: string;
  document_number: string;
  card_number: string | null;
  card_expiry: string | null;
  card_cvv: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapRowToCardIssuance(row: CardIssuanceRow): CardIssuance {
  return {
    requestId: row.request_id,
    documentNumber: row.document_number,
    card:
      row.card_number && row.card_expiry && row.card_cvv
        ? { number: row.card_number, expiry: row.card_expiry, cvv: row.card_cvv }
        : null,
    status: row.status as CardProcessingStatusEnum,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CardIssuanceRepositoryInfrastructure implements CardIssuanceRepository {
  private readonly insertStatement;
  private readonly selectByRequestIdStatement;

  constructor(private readonly db: Database.Database) {
    this.insertStatement = this.db.prepare(
      `INSERT INTO card_issuances
         (request_id, document_number, card_number, card_expiry, card_cvv, status, created_at, updated_at)
       VALUES
         (@requestId, @documentNumber, @cardNumber, @cardExpiry, @cardCvv, @status, @createdAt, @updatedAt)`,
    );

    this.selectByRequestIdStatement = this.db.prepare(
      `SELECT request_id, document_number, card_number, card_expiry, card_cvv, status, created_at, updated_at
       FROM card_issuances
       WHERE request_id = ?`,
    );
  }

  async findByRequestId(requestId: string): Promise<CardIssuance | null> {
    const row = this.selectByRequestIdStatement.get(requestId) as CardIssuanceRow | undefined;
    return row ? mapRowToCardIssuance(row) : null;
  }

  async save(record: CardIssuance): Promise<void> {
    try {
      this.insertStatement.run({
        requestId: record.requestId,
        documentNumber: record.documentNumber,
        cardNumber: record.card?.number ?? null,
        cardExpiry: record.card?.expiry ?? null,
        cardCvv: record.card?.cvv ?? null,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    } catch (error) {
      if (isSqliteUniqueViolation(error)) {
        throw new DuplicateCardIssuanceError(record.requestId);
      }
      throw error;
    }
  }
}
