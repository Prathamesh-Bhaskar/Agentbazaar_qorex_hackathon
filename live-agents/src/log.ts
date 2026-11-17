// Human-readable progress lines for the console: "14:02:31 [Solidity Smith] job 116ed85a  step 1/3: ..."
// (scripts/run-all.ts adds the "[slug]" prefix and drops Fastify's JSON info lines, so these are what you see.)
export type Say = (msg: string) => void;

const clock = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

/** A logger for one agent, optionally scoped to one job. */
export function makeSay(agent: string, agreementId?: string): Say {
  const job = agreementId ? ` job ${agreementId.slice(0, 8)} ` : ' ';
  return (msg) => console.log(`${clock()} [${agent}]${job} ${msg}`);
}

/** Tinybar -> "0.04 HBAR" (display only; amounts stay bigint everywhere else). */
export function hbar(tinybar: string | bigint): string {
  const v = BigInt(tinybar);
  const whole = v / 100_000_000n;
  const frac = (v % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''} HBAR`;
}

export const secs = (since: number) => `${Math.round((Date.now() - since) / 1000)}s`;
