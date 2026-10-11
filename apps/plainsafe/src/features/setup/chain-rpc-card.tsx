// One chain's RPC, edited on the setup screen and in Settings → RPCs (SPEC §3.1, §3.12): a URL or
// the wallet's RPC, with Test and Remove.
import type { UseQueryResult } from '@tanstack/react-query'
import { Schema } from 'effect'
import { CheckCircle2, CircleAlert, Trash2, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSwitchChain } from 'wagmi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { defaultRpcFor } from '@/features/settings/defaults'
import { describeError } from '@/lib/errors'
import { useUrlRpcTest, useWalletRpcTest } from '@/queries/rpc-test'
import { RpcUrl } from '@/schemas/common'
import type { ChainSettings } from '@/schemas/settings'
import type { RpcTestResult } from './rpc-test'

export interface Draft {
  readonly chain: ChainSettings
  readonly useWallet: boolean
  readonly url: string
}

export const draftOf = (chain: ChainSettings): Draft => ({
  chain,
  useWallet: chain.rpc._tag === 'wallet',
  url: chain.rpc._tag === 'url' ? chain.rpc.url : defaultRpcFor(chain.id),
})

/** The RPC setting a draft saves as. */
export const rpcOf = (d: Draft): ChainSettings['rpc'] =>
  d.useWallet ? { _tag: 'wallet' } : { _tag: 'url', url: d.url.trim() }

/** Why the draft can't be saved, if it can't. */
export const draftProblem = (d: Draft) =>
  d.useWallet || Schema.is(RpcUrl)(d.url.trim())
    ? undefined
    : 'Use an https:// URL (http:// is allowed only for localhost)'

export function ChainRpcCard({
  draft,
  onChange,
  onRemove,
}: {
  draft: Draft
  onChange: (d: Draft) => void
  onRemove: () => void
}) {
  const { chain } = draft
  const problem = draftProblem(draft)
  const id = `rpc-${chain.id}`
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle>{chain.name}</CardTitle>
          <CardDescription>Chain ID {chain.id}</CardDescription>
        </div>
        <Button variant="ghost" size="icon" aria-label={`Remove ${chain.name}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <RadioGroup
          value={draft.useWallet ? 'wallet' : 'url'}
          onValueChange={(v) => onChange({ ...draft, useWallet: v === 'wallet' })}
          className="flex flex-wrap gap-4"
        >
          <Label className="flex items-center gap-2 font-normal">
            <RadioGroupItem value="url" /> RPC URL
          </Label>
          <Label className="flex items-center gap-2 font-normal">
            <RadioGroupItem value="wallet" /> Use my wallet's RPC
          </Label>
        </RadioGroup>
        {draft.useWallet ? (
          <>
            <p className="text-sm text-muted-foreground">
              Reads go through your browser wallet, so this page makes no requests for {chain.name}.
              Your wallet must be on {chain.name} while you use it.
            </p>
            <WalletRpcTest chain={chain} />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id}>RPC URL</Label>
              <Input
                id={id}
                value={draft.url}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!problem}
                onChange={(e) => onChange({ ...draft, url: e.target.value })}
                className="font-mono text-sm"
              />
              {problem && <p className="text-sm text-destructive">{problem}</p>}
            </div>
            {!problem && <UrlRpcTest chain={chain} url={draft.url.trim()} />}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function UrlRpcTest({ chain, url }: { chain: ChainSettings; url: string }) {
  const test = useUrlRpcTest(url)
  return <TestRow chain={chain} test={test} subject="This RPC" />
}

function WalletRpcTest({ chain }: { chain: ChainSettings }) {
  const switchChain = useSwitchChain()
  const test = useWalletRpcTest(chain.id)
  return (
    <div className="flex flex-col gap-2">
      <TestRow chain={chain} test={test} subject="Your wallet" />
      {test.data && test.data.chainId !== chain.id && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={switchChain.isPending}
          onClick={() =>
            switchChain.mutate({ chainId: chain.id }, { onSuccess: () => void test.refetch() })
          }
        >
          Switch wallet to {chain.name}
        </Button>
      )}
    </div>
  )
}

function TestRow({
  chain,
  test,
  subject,
}: {
  chain: ChainSettings
  test: UseQueryResult<RpcTestResult>
  subject: string
}) {
  const { data: result, error, isFetching: pending } = test
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <Button variant="secondary" size="sm" onClick={() => void test.refetch()} disabled={pending}>
        {pending ? 'Testing…' : 'Test'}
      </Button>
      <div className="flex flex-col gap-1 text-sm" data-testid={`test-result-${chain.id}`}>
        {!pending && error && <Line tone="bad">{describeError(error)}</Line>}
        {!pending && result && <TestResult chain={chain} result={result} subject={subject} />}
      </div>
    </div>
  )
}

function TestResult({
  chain,
  result: { chainId, simulation },
  subject,
}: {
  chain: ChainSettings
  result: RpcTestResult
  subject: string
}) {
  if (chainId !== chain.id)
    return (
      <Line tone="bad">
        {subject} is on chain {chainId}, not {chain.name} ({chain.id}).
      </Line>
    )
  return (
    <>
      <Line tone="good">Connected to {chain.name} (chain ID matches).</Line>
      {simulation.status === 'supported' && (
        <Line tone="good">Supports transaction simulation (eth_simulateV1).</Line>
      )}
      {simulation.status === 'unsupported' && (
        <Line tone="warn">
          This RPC can't simulate transactions. Reviews will show a warning instead of a simulation.
        </Line>
      )}
      {simulation.status === 'temporary' && (
        <Line tone="warn">
          Couldn't check simulation support right now ({simulation.reason}). It will be checked
          again when needed.
        </Line>
      )}
    </>
  )
}

function Line({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: ReactNode }) {
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'warn' ? TriangleAlert : CircleAlert
  const color = {
    good: 'text-emerald-700 dark:text-emerald-400',
    warn: 'text-amber-700 dark:text-amber-400',
    bad: 'text-destructive',
  }[tone]
  return (
    <p className={`flex items-start gap-1.5 ${color}`}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
