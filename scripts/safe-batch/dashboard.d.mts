export function mountRotations(root: Document | ShadowRoot, options?: {
  apiBase?: string;
  renderIcons?: (root: Document | ShadowRoot) => void;
  onBusy?: (busy: boolean) => void;
}): () => void;
