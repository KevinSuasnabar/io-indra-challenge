import { APPROVAL_MAX_DELAY_MS, APPROVAL_MIN_DELAY_MS } from '../../constants/constants';
import { TransientApprovalError } from './errors';

export interface SimulateExternalApprovalOptions {
  forceError?: boolean;
  randomFn?: () => number;
  delayFn?: (ms: number) => Promise<void>;
  minDelayMs?: number;
  maxDelayMs?: number;
}

const defaultDelayFn = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function simulateExternalApproval(
  options: SimulateExternalApprovalOptions = {},
): Promise<void> {
  const {
    forceError = false,
    randomFn = Math.random,
    delayFn = defaultDelayFn,
    minDelayMs = APPROVAL_MIN_DELAY_MS,
    maxDelayMs = APPROVAL_MAX_DELAY_MS,
  } = options;

  const delayMs = minDelayMs + randomFn() * (maxDelayMs - minDelayMs);
  await delayFn(delayMs);

  const approved = forceError ? false : randomFn() < 0.5;

  if (!approved) {
    throw new TransientApprovalError();
  }
}
