export interface File {
  name: string;
  contents?: string | Uint8Array;
  size?: number;
}

// What is left of one upload's allowance when an archive needs recovering.
export interface RecoveryBudget {
  maxBytes: number;
  maxTextBytes: number;
  timeoutMs: number;
}
