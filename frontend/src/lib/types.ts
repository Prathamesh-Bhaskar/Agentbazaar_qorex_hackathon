// Shapes returned by the AgentBazaar API (backend/src/routes). Money is always a tinybar decimal string.

export type AgentStatus = 'draft' | 'benchmarking' | 'listed' | 'failed';

export type Agent = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string;
  capabilities: string[];
  endpointUrl: string | null;
  payoutAddress: string;
  hederaAccountId: string | null;
  priceTinybar: string;
  repoUrl: string | null;
  repoCommit: string | null;
  status: AgentStatus;
  latestBenchmarkId: string | null;
  isSeeded: boolean;
  modelsUsed?: string[]; // models the agent says it uses; declared by its owner
  createdAt: string;
  // added by the list/detail endpoints
  score?: number | null;
  customScore?: number | null;
  aiScore?: number | null;
  jobsCompleted?: number;
  jobsFailed?: number;
  earnedTinybar?: string;
};

// NEAR AI response-signature check for an AI judgement. Only "tee_signature" means the signer matched a model attestation.
export type LlmProof = {
  provider: 'near'; model: string; chatId: string | null; signatureKind: string | null;
  signingAddress: string | null; signingAlgo: string | null; requestHash: string; responseHash: string;
  level: 'tee_signature' | 'gateway_signature' | 'unverified'; checkedAt: string; note?: string;
};

// GET /models: the NEAR AI catalog, reduced. tee = runs in a NEAR-verifiable TEE.
export type ModelOption = { id: string; name: string; owner: string; tee: boolean; ready: boolean };

// `label` appears on seeded sample data only; real benchmark and verification items use `name` + `detail`.
export type CheckItem = { name?: string; label?: string; passed: boolean; detail?: string; kind?: 'criterion' | 'check' };

export type Benchmark = {
  id: string;
  agentId: string;
  repoUrl: string;
  repoCommit: string | null;
  status: 'running' | 'passed' | 'failed' | 'error';
  customScore: string | null;
  aiScore: string | null;
  score: string | null;
  reviewText: string | null;
  items: CheckItem[] | null;
  error: string | null;
  reportRoot: string | null;
  proof?: LlmProof | null;
  createdAt: string;
};

export type JobRequest = {
  id: string;
  clientUserId: string;
  title: string;
  requirements: string;
  checksRequested: string[];
  budgetTinybar: string;
  deadlineAt: string | null;
  status: 'open' | 'agreed' | 'closed';
  createdAt: string;
  quoting?: 'started';
};

export type Quote = {
  id: string;
  requestId: string;
  agentId: string;
  priceTinybar: string;
  etaHours: number | null;
  status: 'open' | 'accepted' | 'rejected';
  createdAt: string;
  agent?: { id: string; name: string; capabilities: string[]; score: number | null; jobsCompleted: number; jobsFailed: number };
};

export type AgreementStatus = 'agreed' | 'funded' | 'submitted' | 'verifying' | 'released' | 'refunded';

export type Agreement = {
  id: string;
  requestId: string;
  quoteId: string;
  clientUserId: string;
  agentId: string;
  priceTinybar: string;
  deadlineAt: string | null;
  escrowAddress: string | null;
  taskAccountId: string | null;
  taskDispatchStatus: 'sent' | 'failed' | 'no_endpoint' | null;
  taskDispatchError: string | null;
  taskDispatchedAt: string | null;
  status: AgreementStatus;
  createdAt: string;
  escrowError?: string;
};

export type ContractSpec = {
  priceTinybar: string;
  deadlineHours: number;
  maxSubBps: number;
  maxSubLegs: number;
  payoutGraceSecs: number;
  passThresholdPct: number;
  checks: string[];
  complexity: number;
  effortHours: number;
  risk: 'low' | 'medium' | 'high';
  trustScore: number;
  trustTier: 'new' | 'standard' | 'trusted';
  rationale: string[];
  warnings: string[];
};

export type TermsPreview = {
  spec: ContractSpec;
  specHash: string;
  trust: { score: number; tier: string; reasons: string[] };
  source: 'ai' | 'fallback';
  agent: { id: string; name: string };
};

export type Payment = {
  id: string;
  agreementId: string;
  kind: 'fund' | 'release' | 'refund' | 'a2a';
  amountTinybar: string;
  txHash: string | null;
  hederaTxId: string | null;
  payerAccountId: string | null;
  status: 'pending' | 'confirmed' | 'failed';
  createdAt: string;
};

export type SubLeg = {
  id: string;
  agreementId: string;
  legId: number;
  calleeAgentId: string;
  calleeName?: string;
  payeeAddress: string;
  payeeAccountId: string;
  priceTinybar: string;
  termsHash: string;
  status: 'pending' | 'paid' | 'defaulted';
  payoutTx: string | null;
  addLegTx: string | null;
  payUrl: string;
};

export type Submission = { id: string; agreementId: string; content: string; kind: 'text' | 'repo'; deliverableHash: string; submittedAt: string };
export type Verdict = { id: string; agreementId: string; result: 'PASS' | 'FAIL'; settleTxHash: string | null; settleError: string | null; createdAt: string };

export type AgreementDetail = {
  agreement: Agreement;
  request: JobRequest;
  agent: { id: string; name: string; payoutAddress: string };
  submission: Submission | null;
  verdict: Verdict | null;
  payments: Payment[];
  terms: { spec: ContractSpec; specHash: string; source: string } | null;
  subLegs: SubLeg[];
};

export type Verification = {
  id: string;
  agreementId: string;
  result: 'PASS' | 'FAIL' | 'ERROR';
  items: CheckItem[] | null;
  summary: string | null;
  error: string | null;
  reportRoot: string | null;
  proof?: LlmProof | null;
  createdAt: string;
};

export type VerificationDetail = {
  status: AgreementStatus;
  terms: { passThresholdPct: number; checks: string[] } | null;
  latest: Verification | null;
  history: Verification[];
  verdict: Verdict | null;
  disclaimer: string;
};

export type FundingInfo = {
  status: AgreementStatus;
  priceTinybar: string;
  taskContract: string;
  taskAccountId: string | null;
  x402: { url: string; network: string; asset: string; amountTinybar: string; payTo: string | null };
  wallet: { method: string; to: string; valueTinybar: string; note: string };
};

export type GithubStatus = { configured: boolean; connected: boolean; login: string | null };
export type GithubRepo = { fullName: string; url: string; private: boolean; description: string | null; updatedAt: string };

export type MySummary = {
  lockedTinybar: string;
  earnedTinybar: string;
  activeJobs: number;
  activity: { at: string; text: string; amountTinybar: string; txId: string | null }[];
};

export type JobRow = {
  id: string;
  title: string;
  status: AgreementStatus;
  priceTinybar: string;
  agentId: string;
  agentName: string;
  clientAddress?: string;
  createdAt: string;
};

export const CHECKS = [
  { key: 'build_config', label: 'Build config valid', desc: 'Project builds; manifests and configs parse.', kind: 'Code' },
  { key: 'lint_rules', label: 'Lint rules', desc: 'A lint or format config is present.', kind: 'Code' },
  { key: 'secrets_scan', label: 'Secrets scan', desc: 'No keys, tokens or .env files committed.', kind: 'Security' },
  { key: 'dependency_check', label: 'Dependency check', desc: 'Dependencies are pinned; none point at remote code.', kind: 'Security' },
  { key: 'security_review', label: 'AI security review', desc: 'A NEAR AI model reviews for exploitable issues.', kind: 'Security' },
] as const;

export const TAGS = ['Code review', 'Security', 'Backend', 'Frontend', 'Smart contracts', 'Data', 'Docs', 'Testing', 'DevOps'];

export type RecentJob = { id: string; title: string; status: AgreementStatus; priceTinybar: string; createdAt: string };
export type AgentDetail = { agent: Agent; benchmark: Benchmark | null; recentJobs: RecentJob[] };
export type Me = {
  id: string; address: string; displayName: string | null; email: string | null; role: 'client' | 'lister' | 'both' | null;
  hederaAccountId: string | null; hasPassword: boolean; createdAt: string;
};

// ---- contract design (GET /agreements/:id/design) ----
export type ProofRow = { key: string; label: string; designed: string; onchain: string; match: boolean };
export type TermsProof =
  | { state: 'not_deployed' }
  | { state: 'no_design' }
  | { state: 'unavailable'; error?: string | null }
  | { state: 'checked'; rows: ProofRow[] };
export type DesignSub = {
  legId: number;
  status: string;
  priceTinybar: string;
  termsHash: string;
  addLegTx: string | null;
  callee: { id: string; name: string; capabilities: string[] } | null;
  design: { spec: ContractSpec | null; source: string; specHash: string };
  proof: { state: 'checked'; onchainHash: string; match: boolean; onchainPrice: string; priceMatch: boolean } | { state: 'missing' | 'unavailable' };
};
export type DesignDetail = {
  agreementId: string;
  inputs: { title: string; requirements: string; agent: { id: string; name: string; description: string; capabilities: string[]; priceTinybar: string } };
  root: { spec: ContractSpec; specHash: string; source: string; deployTx: string | null } | null;
  contract: string | null;
  proof: TermsProof;
  subs: DesignSub[];
};
