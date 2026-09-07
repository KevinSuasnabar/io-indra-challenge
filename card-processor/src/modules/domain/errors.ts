export class TransientApprovalError extends Error {
  constructor(message = 'Transient failure of the external approval simulator') {
    super(message);
    this.name = 'TransientApprovalError';
  }
}

export class InvalidCardRequestEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCardRequestEventError';
  }
}

export class DuplicateCardIssuanceError extends Error {
  constructor(public readonly requestId: string) {
    super(`An issuance record already exists for request ${requestId}`);
    this.name = 'DuplicateCardIssuanceError';
  }
}

export function isTransientError(error: unknown): boolean {
  return error instanceof TransientApprovalError;
}
