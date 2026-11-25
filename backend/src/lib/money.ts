import { z } from 'zod';
import { WEI_PER_UQOR } from '../chain/window.js';

/** A QOR amount in wei as a string. Native payments count in uqor (6 decimals), so finer amounts could never be paid exactly. */
export const weiAmount = z.string()
  .regex(/^\d+$/, 'amount must be a whole-number string (wei)')
  .refine((s) => BigInt(s) % WEI_PER_UQOR === 0n, 'amount can have at most 6 decimal places of QOR');
