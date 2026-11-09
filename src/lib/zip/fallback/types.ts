export interface File {
  name: string;
  contents?: string | Uint8Array;
  size?: number;
}
