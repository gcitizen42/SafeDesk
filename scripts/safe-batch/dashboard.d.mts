export function mountRotations(root: Document | ShadowRoot, options?: {
  apiBase?: string;
  renderIcons?: (root: Document | ShadowRoot) => void;
  onBusy?: (busy: boolean) => void;
  getSafeContext?: () => {
    selectedSafe?: {chainId: number; address: string; label?: string};
    safes: readonly {chainId: number; address: string; label?: string}[];
  };
  onSafeSelected?: (safe: {chainId: number; address: string; label?: string}) => void;
  onSafeAdded?: (safe: {chainId: number; address: string; label?: string}) => void;
}): () => void;
