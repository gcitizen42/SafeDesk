// Opening a shared package (SPEC §3.7). Step 1 runs offline, before any request: decode, recompute
// the hashes, recover the signers. Chain checks come only after setup.
import { useQuery } from '@tanstack/react-query'
import { Either } from 'effect'
import { useEffect, useRef } from 'react'
import { useLocation, useParams } from 'wouter'
import { AddressView } from '@/components/address'
import { Callout } from '@/components/callout'
import { Button } from '@/components/ui/button'
import { describeCall, tokenLookup } from '@/core/describe'
import { decodeOffline } from '@/core/offline-decode'
import { decodePayload, encodePayload, type VerifiedPackage, verifyPackage } from '@/core/package'
import { HashesPanel } from '@/features/review/hashes'
import { TxFields } from '@/features/review/tx-fields'
import { AddChain } from '@/features/safes/add-chain'
import { hasSafe, safeRecord } from '@/features/safes/store'
import { isSetupDone, useGoToSetup } from '@/features/setup/return-to'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import { keys } from '@/queries/keys'
import { useSavePackage } from '@/queries/packages'
import { useSafe, useSafeList, useSaveSafe } from '@/queries/safes'
import { useChain, useLoadedSettings, useNativeCurrency } from '@/queries/settings'
import { useTokenUniverse } from '@/queries/tokens'
import { PackageInput, ProposerNote, problemText } from './offline'

export function ImportPaste() {
  const [, navigate] = useLocation()
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="text-xl font-semibold">Import a transaction</h1>
      <p className="text-sm text-muted-foreground">
        Paste a Plain Safe link, a <span className="font-mono">plainsafe:1:</span> code, or package
        JSON, or drop a .json file here. Nothing is sent anywhere: the hashes and signatures are
        checked in this browser.
      </p>
      <PackageInput
        action="Open"
        onVerified={async (v) => {
          if (v) navigate(`/import/${await encodePayload(v.pkg)}`)
        }}
      />
    </div>
  )
}

export function ImportPayload() {
  const { payload } = useParams<{ payload: string }>()
  const verified = useQuery({
    queryKey: keys.importPayload(payload ?? ''),
    queryFn: async () => verifyPackage(await decodePayload(payload ?? '')),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  if (verified.isPending)
    return (
      <p className="mx-auto max-w-2xl px-4 py-8 text-muted-foreground">Checking the package…</p>
    )
  if (verified.error) {
    return (
      <Failure text="This link is damaged or incomplete. Ask for the file or the plainsafe:1: code instead." />
    )
  }
  if (Either.isLeft(verified.data)) return <Failure text={problemText(verified.data.left)} />
  return <Imported v={verified.data.right} />
}

function Failure({ text }: { text: string }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8" data-testid="import-rejected">
      <h1 className="text-xl font-semibold">Can't open this transaction</h1>
      <Callout severity="red" title="Rejected">
        {text}
      </Callout>
    </div>
  )
}

function Imported({ v }: { v: VerifiedPackage }) {
  const settings = useLoadedSettings()
  const goToSetup = useGoToSetup()
  const { pkg, tx } = v
  const chain = useChain(pkg.chainId)
  const currency = useNativeCurrency(pkg.chainId)
  const tokens = useTokenUniverse(pkg.chainId)
  const decoded = decodeOffline(pkg.chainId, pkg.safe, tx)
  const summary = describeCall(tx, decoded, pkg.safe, currency, tokenLookup(tokens))

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8" data-testid="import-offline">
      <p className="text-sm text-muted-foreground">
        {chain?.name ?? `Chain ${pkg.chainId}`} · Safe {shortAddress(pkg.safe)} (claims v
        {pkg.safeVersion}) · nonce {pkg.tx.nonce}
      </p>
      <h1 className="text-xl font-semibold">{summary}</h1>
      {pkg.note && <ProposerNote note={pkg.note} />}
      <Callout severity="info" title="Not yet checked against the chain">
        The hashes below were recomputed in this browser and match the package, and every signature
        was recovered. Whether this is a real Safe, who its owners are and what the target contract
        is still need to be checked over your RPC.
      </Callout>
      {decoded.kind === 'abi' && (
        <p className="text-sm">
          Decoded offline as <span className="font-mono">{decoded.signature}</span> with the{' '}
          {decoded.source} ABI; not yet checked against the target's bytecode.
        </p>
      )}
      <HashesPanel hashes={v.hashes} />
      <section
        className="flex flex-col gap-1 rounded-lg border p-4 text-sm"
        data-testid="offline-signers"
      >
        <h2 className="font-medium">Signatures ({v.signatures.length})</h2>
        {v.signatures.map((s) => (
          <p key={s.signer}>
            Signed by <span className="font-mono">{s.signer}</span> (not yet confirmed as owner)
          </p>
        ))}
        {v.rejected.map((r) => (
          <p key={r.signer} className="text-destructive">
            Rejected signature claimed by {r.signer}: {r.reason}.
          </p>
        ))}
      </section>
      <TxFields chainId={pkg.chainId} tx={tx} />

      {!isSetupDone(settings) ? (
        <Button size="lg" className="self-end" onClick={goToSetup}>
          Set up Plain Safe to check it against the chain
        </Button>
      ) : !chain ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            This transaction is for chain {pkg.chainId}, which isn't set up yet. Add it to continue:
          </p>
          <AddChain onAdded={() => undefined} initialChainId={pkg.chainId} />
        </div>
      ) : (
        <ChainCheck v={v} />
      )}
    </div>
  )
}

/** With an RPC: authenticity, owners and nonce, then save to the queue and Recent (SPEC §3.7). */
function ChainCheck({ v }: { v: VerifiedPackage }) {
  const { pkg } = v
  const [, navigate] = useLocation()
  const safe = useSafe(pkg.chainId, pkg.safe, { fresh: true })
  const mySafes = useSafeList('safes')
  const saveRecent = useSaveSafe('recent')
  const savePackage = useSavePackage()
  const started = useRef(false)
  const a = safe.data?.authenticity

  useEffect(() => {
    if (started.current || !safe.data || !mySafes.data || a?.status !== 'verified') return
    started.current = true
    const recent = hasSafe(mySafes.data.safes, pkg.chainId, pkg.safe)
      ? undefined
      : safeRecord(safe.data)
    void (async () => {
      await savePackage.mutateAsync(v)
      if (recent) await saveRecent.mutateAsync(recent)
      navigate(`/safe/${pkg.chainId}/${pkg.safe}/tx/${v.hashes.safeTx}`, { replace: true })
    })().catch(() => undefined) // shown below, from the mutation's error
  }, [safe.data, mySafes.data, a, pkg, v, navigate, savePackage, saveRecent])

  if (safe.isPending)
    return <p className="text-muted-foreground">Checking the Safe against the chain…</p>
  if (safe.error) return <p className="text-destructive">{describeError(safe.error)}</p>
  if (a && a.status !== 'verified') {
    return (
      <Callout severity="red" title="This Safe could not be verified">
        <AddressView chainId={pkg.chainId} address={pkg.safe} />{' '}
        {a.status === 'not-a-contract' ? 'has no code.' : "doesn't match a known Safe release."} The
        transaction was not saved, and signing is refused.
      </Callout>
    )
  }
  const saveError = mySafes.error ?? savePackage.error ?? saveRecent.error
  if (saveError) return <p className="text-destructive">{describeError(saveError)}</p>
  return <p className="text-muted-foreground">Saving to this Safe's queue…</p>
}
