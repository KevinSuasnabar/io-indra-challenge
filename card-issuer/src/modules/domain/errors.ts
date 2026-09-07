export class DuplicateCardRequestError extends Error {
  constructor(public readonly documentNumber: string) {
    super(`A card request already exists for document ${documentNumber}`);
    this.name = 'DuplicateCardRequestError';
  }
}

export class CardRequestNotFoundError extends Error {
  constructor(public readonly requestId: string) {
    super(`No existe ninguna solicitud de tarjeta con requestId ${requestId}`);
    this.name = 'CardRequestNotFoundError';
  }
}

export class InvalidCursorError extends Error {
  constructor(public readonly cursor: string) {
    super(`Pagination cursor is not valid: ${cursor}`);
    this.name = 'InvalidCursorError';
  }
}