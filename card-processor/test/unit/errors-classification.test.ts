import {
  InvalidCardRequestEventError,
  TransientApprovalError,
  isTransientError,
} from '../../src/modules/domain/errors';

describe('transient vs permanent error classification', () => {
  it('classifies TransientApprovalError as transient (retryable)', () => {
    expect(isTransientError(new TransientApprovalError())).toBe(true);
  });

  it('classifies InvalidCardRequestEventError as permanent (not retryable)', () => {
    expect(isTransientError(new InvalidCardRequestEventError('malformed payload'))).toBe(false);
  });

  it('classifies a generic Error as permanent by default (not retryable)', () => {
    expect(isTransientError(new Error('anything else'))).toBe(false);
  });

  it('classifies a non-Error value as permanent', () => {
    expect(isTransientError('I am not an error')).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });
});
