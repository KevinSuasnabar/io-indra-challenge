import Database from 'better-sqlite3';
import { CardRequestStatusEnum } from '../../../constants/card-request-status.enum';
import {
  CardIssuancePayload,
  CardRequest,
  CardRequestListItem,
  CardRequestListResult,
} from '../../domain/card-request';
import { DuplicateCardRequestError, InvalidCursorError } from '../../domain/errors';
import { CardRequestRepository } from '../../domain/ports/card-request-repository.port';

const SQLITE_UNIQUE_VIOLATION_CODE = 'SQLITE_CONSTRAINT_UNIQUE';

function isSqliteUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === SQLITE_UNIQUE_VIOLATION_CODE
  );
}

interface CardRequestRow {
  request_id: string;
  document_number: string;
  status: string;
  payload: string;
  created_at: string;
  updated_at: string;
  failure_reason: string | null;
  failure_attempts: number | null;
}

interface CardRequestListRow extends CardRequestRow {
  id: number;
}

function mapRowToCardRequest(row: CardRequestRow): CardRequest {
  return {
    requestId: row.request_id,
    documentNumber: row.document_number,
    status: row.status as CardRequestStatusEnum,
    payload: JSON.parse(row.payload) as CardIssuancePayload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    failureReason: row.failure_reason,
    failureAttempts: row.failure_attempts,
  };
}

function mapRowToListItem(row: CardRequestListRow): CardRequestListItem {
  return {
    requestId: row.request_id,
    documentNumber: row.document_number,
    status: row.status as CardRequestStatusEnum,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface DecodedCursor {
  createdAt: string;
  id: number;
}

function encodeCursor(cursor: DecodedCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(rawCursor: string): DecodedCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError(rawCursor);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).createdAt !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'number'
  ) {
    throw new InvalidCursorError(rawCursor);
  }

  return parsed as DecodedCursor;
}

export class CardRequestRepositoryInfrastructure implements CardRequestRepository {
  private readonly insertStatement;
  private readonly selectByDocumentNumberStatement;
  private readonly selectByRequestIdStatement;
  private readonly retryFailedRequestStatement;
  private readonly updateStatusByRequestIdStatement;
  private readonly markAsFailedStatement;
  private readonly listRecentFirstPageStatement;
  private readonly listRecentAfterCursorStatement;

  private static readonly SELECT_COLUMNS =
    'request_id, document_number, status, payload, created_at, updated_at, failure_reason, failure_attempts';

  constructor(private readonly db: Database.Database) {
    this.insertStatement = this.db.prepare(
      `INSERT INTO card_requests
         (request_id, document_number, status, payload, created_at, updated_at, failure_reason, failure_attempts)
       VALUES
         (@requestId, @documentNumber, @status, @payload, @createdAt, @updatedAt, @failureReason, @failureAttempts)`,
    );

    this.selectByDocumentNumberStatement = this.db.prepare(
      `SELECT ${CardRequestRepositoryInfrastructure.SELECT_COLUMNS}
       FROM card_requests
       WHERE document_number = ?`,
    );

    this.selectByRequestIdStatement = this.db.prepare(
      `SELECT ${CardRequestRepositoryInfrastructure.SELECT_COLUMNS}
       FROM card_requests
       WHERE request_id = ?`,
    );

    this.retryFailedRequestStatement = this.db.prepare(
      `UPDATE card_requests
       SET request_id = @requestId, status = @status, payload = @payload,
           created_at = @createdAt, updated_at = @updatedAt,
           failure_reason = @failureReason, failure_attempts = @failureAttempts
       WHERE document_number = @documentNumber AND status = 'failed'`,
    );

    this.updateStatusByRequestIdStatement = this.db.prepare(
      `UPDATE card_requests
       SET status = @status, updated_at = @updatedAt
       WHERE request_id = @requestId AND status = 'pending'`,
    );

    this.markAsFailedStatement = this.db.prepare(
      `UPDATE card_requests
       SET status = 'failed', failure_reason = @reason, failure_attempts = @attempts,
           updated_at = @updatedAt
       WHERE request_id = @requestId AND status = 'pending'`,
    );

    this.listRecentFirstPageStatement = this.db.prepare(
      `SELECT id, ${CardRequestRepositoryInfrastructure.SELECT_COLUMNS}
       FROM card_requests
       ORDER BY created_at DESC, id DESC
       LIMIT @limit`,
    );

    this.listRecentAfterCursorStatement = this.db.prepare(
      `SELECT id, ${CardRequestRepositoryInfrastructure.SELECT_COLUMNS}
       FROM card_requests
       WHERE created_at < @createdAt OR (created_at = @createdAt AND id < @id)
       ORDER BY created_at DESC, id DESC
       LIMIT @limit`,
    );
  }

  async save(request: CardRequest): Promise<void> {
    try {
      this.insertStatement.run({
        requestId: request.requestId,
        documentNumber: request.documentNumber,
        status: request.status,
        payload: JSON.stringify(request.payload),
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        failureReason: request.failureReason,
        failureAttempts: request.failureAttempts,
      });
    } catch (error) {
      if (isSqliteUniqueViolation(error)) {
        throw new DuplicateCardRequestError(request.documentNumber);
      }
      throw error;
    }
  }

  async findByDocumentNumber(documentNumber: string): Promise<CardRequest | null> {
    const row = this.selectByDocumentNumberStatement.get(documentNumber) as
      CardRequestRow | undefined;
    return row ? mapRowToCardRequest(row) : null;
  }

  async findByRequestId(requestId: string): Promise<CardRequest | null> {
    const row = this.selectByRequestIdStatement.get(requestId) as CardRequestRow | undefined;
    return row ? mapRowToCardRequest(row) : null;
  }

  async retryFailedRequest(request: CardRequest): Promise<boolean> {
    const info = this.retryFailedRequestStatement.run({
      requestId: request.requestId,
      documentNumber: request.documentNumber,
      status: request.status,
      payload: JSON.stringify(request.payload),
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      failureReason: request.failureReason,
      failureAttempts: request.failureAttempts,
    });
    return info.changes > 0;
  }

  async updateStatusByRequestId(
    requestId: string,
    status: CardRequestStatusEnum,
    updatedAt: string,
  ): Promise<void> {
    this.updateStatusByRequestIdStatement.run({ requestId, status, updatedAt });
  }

  async markAsFailed(
    requestId: string,
    reason: string,
    attempts: number,
    updatedAt: string,
  ): Promise<void> {
    this.markAsFailedStatement.run({ requestId, reason, attempts, updatedAt });
  }

  async listRecent(options: { limit: number; cursor: string | null }): Promise<CardRequestListResult> {
    const { limit, cursor } = options;

    const rows = cursor
      ? (this.listRecentAfterCursorStatement.all({
          ...decodeCursor(cursor),
          limit: limit + 1,
        }) as CardRequestListRow[])
      : (this.listRecentFirstPageStatement.all({ limit: limit + 1 }) as CardRequestListRow[]);

    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];

    return {
      items: pageRows.map(mapRowToListItem),
      nextCursor:
        hasNextPage && lastRow
          ? encodeCursor({ createdAt: lastRow.created_at, id: lastRow.id })
          : null,
    };
  }
}