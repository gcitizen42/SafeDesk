export function walletActionsEnabled(doc: Pick<Document, 'querySelector'> = document): boolean {
  return (
    doc.querySelector<HTMLMetaElement>('meta[name="safedesk-wallet-actions"]')?.content ===
    'enabled'
  )
}

export function requireWalletActions(doc: Pick<Document, 'querySelector'> = document): void {
  if (!walletActionsEnabled(doc))
    throw new Error(
      'This Safe Management session is read-only. Wallet signing, approvals, creation and execution are disabled.',
    )
}
