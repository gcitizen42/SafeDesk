import {
  Check,
  Copy,
  Download,
  FlaskConical,
  Hammer,
  Layers3,
  LockKeyhole,
  Minus,
  Plus,
  ScanSearch,
  ShieldAlert,
} from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { downloadJson } from '@/lib/download'
import { cn } from '@/lib/utils'
import { formatSuiBalance, type SuiInputs, selectableObject, targetPolicyJson } from './model'
import { createSuiSession, type SuiSession, suiAvailability } from './session'

const editorClass =
  'w-full min-w-0 resize-y rounded-[8px] border bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

function downloadPlainTransaction(json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'sui-msafe-plain-transaction.json'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Warnings({ items }: { items: readonly string[] }) {
  return (
    items.length > 0 && (
      <ul className="flex flex-col gap-1 border-l-2 border-amber-500 pl-3 text-xs text-amber-800 dark:text-amber-300">
        {[...new Set(items)].map((warning) => (
          <li key={warning} className="break-words">
            {warning}
          </li>
        ))}
      </ul>
    )
  )
}

export function OtherChainsScreen({ session: supplied }: { session?: SuiSession }) {
  const [session] = useState(() => supplied ?? createSuiSession())
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useEffect(() => () => session.cancel(), [session])
  const { inputs, inspection, plan, simulation, busy } = state
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!plan) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [plan])
  const availability = suiAvailability(state, now)
  const remainingSeconds = plan
    ? Math.max(0, Math.floor((Date.parse(plan.createdAt) + 15 * 60 * 1000 - now) / 1000))
    : 0
  const [copyState, setCopyState] = useState<{ revision: number; status: 'copied' | 'failed' }>()
  const currentCopy = copyState?.revision === state.revision ? copyState.status : undefined
  const editText = (
    field: 'vault' | 'signer' | 'evidenceDigest' | 'sourcePolicyJson',
    value: string,
  ) => session.edit({ [field]: value })
  const targetEdit = (value: string) => {
    let threshold = inputs.targetThreshold
    try {
      threshold = targetPolicyJson(value).policy.threshold.toString()
    } catch {
      /* Keep invalid JSON editable. */
    }
    session.edit({ targetPolicyJson: value, targetThreshold: threshold })
  }
  const thresholdEdit = (value: string) => {
    let json = inputs.targetPolicyJson
    try {
      json = JSON.stringify(targetPolicyJson(json, value).policy, null, 2)
    } catch {
      /* Keep invalid input editable. */
    }
    session.edit({ targetThreshold: value, targetPolicyJson: json })
  }
  const currentPlan = () => {
    const current = session.getSnapshot()
    return suiAvailability(current).exportable ? current.plan : undefined
  }
  const copy = async () => {
    const packageToCopy = currentPlan()
    if (!packageToCopy) return
    const revision = session.getSnapshot().revision
    try {
      await navigator.clipboard.writeText(packageToCopy.transactionJson)
      if (revision === session.getSnapshot().revision) setCopyState({ revision, status: 'copied' })
    } catch {
      if (revision === session.getSnapshot().revision) setCopyState({ revision, status: 'failed' })
    }
  }
  let target: ReturnType<typeof targetPolicyJson> | undefined
  try {
    target = targetPolicyJson(inputs.targetPolicyJson, inputs.targetThreshold)
  } catch {
    /* Validation is shown beside the editor. */
  }
  const policy = inspection?.policy
  const owners =
    policy?.ownerCount ??
    policy?.members.filter((member) => member.role !== 'msafe-specifier').length
  const selected = inputs.objectIds.length

  return (
    <div
      className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6"
      data-testid="other-chains-workspace"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Layers3 className="size-5" /> Other Chains
        </h1>
        <span className="text-xs text-muted-foreground">Sui mainnet</span>
      </header>

      <section
        className="flex min-w-0 flex-col gap-4 border-t pt-4"
        aria-labelledby="sui-source-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sui-source-title" className="font-medium">
            Sui / MSafe source
          </h2>
          <Button
            variant="outline"
            disabled={!!busy || !!availability.inspectProblem}
            onClick={() => void session.inspect()}
          >
            <ScanSearch /> {busy === 'inspect' ? 'Inspecting...' : 'Inspect'}
          </Button>
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <TextField label="Source vault" field="vault" inputs={inputs} onChange={editText} />
          <TextField
            label="Signer address (optional)"
            field="signer"
            inputs={inputs}
            onChange={editText}
          />
          <div className="sm:col-span-2">
            <TextField
              label="Evidence transaction digest (optional)"
              field="evidenceDigest"
              inputs={inputs}
              onChange={editText}
            />
          </div>
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Source public policy JSON (optional)
          </summary>
          <textarea
            aria-label="Source public policy JSON"
            rows={6}
            value={inputs.sourcePolicyJson}
            onChange={(event) => editText('sourcePolicyJson', event.target.value)}
            spellCheck={false}
            className={cn(editorClass, 'mt-2')}
          />
        </details>
        {(inputs.vault || inputs.signer || inputs.evidenceDigest || inputs.sourcePolicyJson) &&
          availability.inspectProblem && (
            <p className="text-sm text-destructive" role="alert">
              {availability.inspectProblem}
            </p>
          )}
        {inspection && (
          <>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span>{inspection.complete ? 'Inventory checked' : 'Partial inventory'}</span>
              <span>Chain {inspection.chainIdentifier}</span>
              <time dateTime={inspection.checkedAt}>Checked {inspection.checkedAt}</time>
              {inputs.signer && (
                <span>
                  {inspection.signerMember === true
                    ? 'Signer is a source owner'
                    : inspection.signerMember === false
                      ? 'Signer is not a source owner'
                      : 'Signer membership unknown'}
                </span>
              )}
            </div>
            <Warnings items={inspection.warnings} />
            {policy ? (
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <h3 className="font-medium">Source public policy</h3>
                  <span>
                    Threshold weight {policy.threshold} / {owners} owners / {policy.members.length}{' '}
                    native keys
                  </span>
                </div>
                <p className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
                  <ShieldAlert className="size-4 shrink-0" /> Address binding checked; private-key
                  availability not verified.
                </p>
                {policy.creationNonce !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    MSafe creation nonce {policy.creationNonce}
                  </span>
                )}
                <ul className="divide-y border-y">
                  {policy.members.map((member) => (
                    <li
                      key={member.publicKey}
                      className={cn(
                        'flex min-w-0 flex-wrap items-start justify-between gap-2 py-3',
                        member.role === 'msafe-specifier' && 'text-muted-foreground',
                      )}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="font-mono text-xs break-all">{member.address}</span>
                        <span className="font-mono text-xs text-muted-foreground break-all">
                          {member.publicKey}
                        </span>
                      </div>
                      <span className="text-xs">
                        {member.role === 'msafe-specifier'
                          ? 'MSafe specifier (reserved)'
                          : `Owner / weight ${member.weight}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Source public policy unverified
              </p>
            )}
            {inspection.balances.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Balances</h3>
                <ul className="divide-y border-y">
                  {inspection.balances.map((balance) => (
                    <li
                      key={balance.coinType}
                      className="grid min-w-0 gap-1 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        {balance.symbol && <span className="font-medium">{balance.symbol}</span>}
                        <span className="font-mono break-all">{balance.coinType}</span>
                      </div>
                      <span className="font-mono break-all" title={`Raw units: ${balance.balance}`}>
                        {formatSuiBalance(balance.balance, balance.decimals)}
                        {balance.decimals !== undefined && balance.symbol
                          ? ` ${balance.symbol}`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      <section
        className="flex min-w-0 flex-col gap-4 border-t pt-4"
        aria-labelledby="sui-target-title"
      >
        <h2 id="sui-target-title" className="font-medium">
          Target public policy
        </h2>
        <label className="flex min-w-0 flex-col gap-2 text-sm" htmlFor="sui-target-json">
          Owner policy JSON
          <textarea
            id="sui-target-json"
            aria-label="Target owner policy JSON"
            value={inputs.targetPolicyJson}
            onChange={(event) => targetEdit(event.target.value)}
            rows={8}
            spellCheck={false}
            aria-invalid={!!availability.targetProblem}
            className={editorClass}
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="sui-target-threshold" className="text-sm">
              Threshold weight
            </label>
            <Button
              variant="outline"
              size="icon"
              aria-label="Decrease threshold"
              title="Decrease threshold"
              disabled={!target || target.policy.threshold <= 1}
              onClick={() => thresholdEdit(String((target?.policy.threshold ?? 1) - 1))}
            >
              <Minus />
            </Button>
            <Input
              id="sui-target-threshold"
              aria-label="Target threshold"
              type="number"
              min={1}
              max={65535}
              value={inputs.targetThreshold}
              onChange={(event) => thresholdEdit(event.target.value)}
              className="w-20 font-mono"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Increase threshold"
              title="Increase threshold"
              disabled={!target || target.policy.threshold >= 65535}
              onClick={() => thresholdEdit(String((target?.policy.threshold ?? 0) + 1))}
            >
              <Plus />
            </Button>
          </div>
          {target && (
            <span className="text-xs text-muted-foreground">
              {target.policy.members.filter((member) => member.role !== 'msafe-specifier').length}{' '}
              owner entries
              {target.policy.creationNonce !== undefined
                ? ` / MSafe nonce ${target.policy.creationNonce}`
                : ''}
            </span>
          )}
        </div>
        {availability.targetProblem && (
          <p role="alert" className="text-sm text-destructive">
            {availability.targetProblem}
          </p>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-emerald-700"
            checked={inputs.ackDestination}
            onChange={(event) => session.edit({ ackDestination: event.target.checked })}
          />
          Target keys and threshold verified by owners
        </label>
        <p className="border-l-2 border-amber-500 pl-3 text-xs text-amber-800 dark:text-amber-300">
          Derived destination may require separate MSafe setup. Selected objects move to a new
          vault; ownership is not changed in place.
        </p>
      </section>

      <section
        className="flex min-w-0 flex-col gap-4 border-t pt-4"
        aria-labelledby="sui-inventory-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sui-inventory-title" className="font-medium">
            Object inventory
          </h2>
          <span className="text-xs text-muted-foreground">{selected} selected</span>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-emerald-700"
            checked={inputs.ackPrivileged}
            onChange={(event) => session.edit({ ackPrivileged: event.target.checked })}
          />
          Acknowledge transfer of administrative and unknown non-coin objects
        </label>
        {inspection ? (
          inspection.objects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No owned objects returned.</p>
          ) : (
            <ul className="divide-y border-y">
              {inspection.objects.map((object) => (
                <li
                  key={object.objectId}
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                >
                  <input
                    type="checkbox"
                    aria-label={`Select object ${object.objectId}`}
                    className="mt-1 size-4 accent-emerald-700"
                    checked={inputs.objectIds.includes(object.objectId)}
                    disabled={!selectableObject(object, inputs.ackPrivileged)}
                    onChange={(event) =>
                      session.toggleObject(object.objectId, event.target.checked)
                    }
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-mono text-xs break-all">{object.objectId}</span>
                    <span className="text-xs text-muted-foreground break-all">{object.type}</span>
                    <span className="text-xs text-muted-foreground">Version {object.version}</span>
                  </div>
                  <span className="col-start-2 inline-flex items-center gap-1 text-xs text-muted-foreground sm:col-start-auto">
                    {object.kind === 'sui-gas' ? (
                      <>
                        <LockKeyhole className="size-3" /> SUI gas reserved
                      </>
                    ) : object.kind === 'privileged' ? (
                      'Administrative / unknown non-coin'
                    ) : object.selectable ? (
                      object.kind
                    ) : (
                      'Not transferable'
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <span className="text-sm text-muted-foreground">Not inspected</span>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!!busy || !!availability.buildProblem}
            onClick={() => void session.build()}
          >
            <Hammer /> {busy === 'plan' ? 'Building...' : 'Build'}
          </Button>
          <Button
            variant="outline"
            disabled={!!busy || !availability.planCurrent}
            onClick={() => void session.simulate()}
          >
            <FlaskConical /> {busy === 'simulate' ? 'Simulating...' : 'Simulate'}
          </Button>
        </div>
        {availability.buildProblem && inspection && inputs.targetPolicyJson && (
          <p className="text-xs text-muted-foreground">{availability.buildProblem}</p>
        )}
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
      </section>

      <section
        className="flex min-w-0 flex-col gap-3 border-t pt-4"
        aria-labelledby="sui-export-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="sui-export-title" className="font-medium">
            MSafe Plain Transaction
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy MSafe Plain Transaction"
              title="Copy MSafe Plain Transaction"
              disabled={!availability.exportable}
              onClick={() => void copy()}
            >
              {currentCopy === 'copied' ? <Check /> : <Copy />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Download MSafe Plain Transaction"
              title="Download MSafe Plain Transaction"
              disabled={!availability.exportable}
              onClick={() => {
                const current = currentPlan()
                if (current) downloadPlainTransaction(current.transactionJson)
              }}
            >
              <Download />
            </Button>
            <Button
              variant="outline"
              size="sm"
              title="Download review package"
              disabled={!availability.reviewable}
              onClick={() => {
                const current = session.getSnapshot()
                const packageToDownload = suiAvailability(current).reviewable
                  ? current.plan
                  : undefined
                if (packageToDownload)
                  downloadJson('sui-migration-review-package.json', packageToDownload)
              }}
            >
              <Download /> Review package
            </Button>
          </div>
        </div>
        {plan ? (
          <>
            <span className="text-xs text-muted-foreground">
              Built / unsigned / {plan.selectedObjects.length} objects /{' '}
              {plan.remainingObjectIds.length} remaining
            </span>
            <span
              className={cn(
                'text-xs',
                availability.planCurrent ? 'text-muted-foreground' : 'text-destructive',
              )}
            >
              {availability.planCurrent
                ? `Expires in ${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`
                : 'Expired; rebuild'}
            </span>
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
              <dt>Derived destination</dt>
              <dd className="font-mono break-all">{plan.destinationVault}</dd>
              <dt>Transaction digest</dt>
              <dd className="font-mono break-all">{plan.transactionDigest}</dd>
              <dt>Package hash</dt>
              <dd className="font-mono break-all">{plan.packageHash}</dd>
            </dl>
            <textarea
              aria-label="Built MSafe Plain Transaction JSON"
              readOnly
              value={plan.transactionJson}
              rows={8}
              className={editorClass}
            />
            <Warnings items={plan.warnings} />
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Not built</span>
        )}
        {currentCopy === 'failed' && (
          <p role="alert" className="text-sm text-destructive">
            Transaction JSON could not be copied.
          </p>
        )}
      </section>

      <section
        className="flex min-w-0 flex-col gap-3 border-t pt-4"
        aria-labelledby="sui-simulation-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sui-simulation-title" className="flex items-center gap-2 font-medium">
            <FlaskConical className="size-4" /> Native Sui simulation
          </h2>
          <span
            className={cn(
              'text-sm',
              simulation?.status === 'failed'
                ? 'text-destructive'
                : simulation?.status === 'passed'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-muted-foreground',
            )}
          >
            {simulation ? (simulation.status === 'passed' ? 'Passed' : 'Failed') : 'Not simulated'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Download native Sui simulation JSON"
            title="Download native Sui simulation JSON"
            disabled={!availability.simulationReviewable}
            onClick={() => {
              const current = session.getSnapshot()
              if (suiAvailability(current).simulationReviewable)
                downloadJson('sui-native-simulation.json', current.simulation)
            }}
          >
            <Download />
          </Button>
        </div>
        {simulation && (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Authorization not verified</span>
              <span>Checks enabled</span>
              {simulation.gasPaymentMocked && <span>Gas payment mocked</span>}
              <time dateTime={simulation.checkedAt}>{simulation.checkedAt}</time>
            </div>
            <Warnings items={simulation.warnings} />
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-xs">
              {Object.entries(simulation.gasUsed).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="break-all">{key}</dt>
                  <dd className="font-mono">
                    {typeof value === 'string' || typeof value === 'number' ? value : 'Unknown'}
                  </dd>
                </div>
              ))}
            </dl>
            <JsonDetails label="Balance changes" values={simulation.balanceChanges} />
            <JsonDetails label="Changed objects" values={simulation.changedObjects} />
          </>
        )}
      </section>

      <section
        className="flex flex-wrap items-center justify-between gap-2 border-t pt-4"
        aria-label="Starknet"
      >
        <h2 className="font-medium">Starknet</h2>
        <span className="text-sm text-muted-foreground">Inspection pending</span>
      </section>
    </div>
  )
}

function TextField({
  label,
  field,
  inputs,
  onChange,
}: {
  label: string
  field: 'vault' | 'signer' | 'evidenceDigest'
  inputs: SuiInputs
  onChange: (field: 'vault' | 'signer' | 'evidenceDigest', value: string) => void
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-sm" htmlFor={`sui-${field}`}>
      {label}
      <Input
        id={`sui-${field}`}
        value={inputs[field]}
        onChange={(event) => onChange(field, event.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="font-mono text-xs"
      />
    </label>
  )
}

function JsonDetails({ label, values }: { label: string; values: readonly unknown[] }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm">
        {label} ({values.length})
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto border-l pl-3 text-xs whitespace-pre-wrap break-all">
        {JSON.stringify(values, null, 2)}
      </pre>
    </details>
  )
}
