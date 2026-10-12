import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import { parsePublishedQueue, publishedSnapshot } from '@/features/queue/published'
import type { SafeSnapshot } from '@/features/safes/load-safe'

const REQUEST_ERROR = 'Published queue could not be checked.'

export async function fetchPublishedQueue(snapshot: SafeSnapshot, signal?: AbortSignal) {
  if (!publishedSnapshot(snapshot.chainId, snapshot.address, snapshot))
    throw new Error(REQUEST_ERROR)
  const params = new URLSearchParams({
    chainId: snapshot.chainId.toString(),
    safe: snapshot.address,
    nonce: (snapshot.nonce as bigint).toString(),
  })
  try {
    const response = await fetch(`/api/safe-queue?${params}`, {
      method: 'GET',
      signal,
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(REQUEST_ERROR)
    const queue = await parsePublishedQueue(await response.json(), snapshot)
    signal?.throwIfAborted()
    return queue
  } catch {
    if (signal?.aborted) signal.throwIfAborted()
    throw new Error(REQUEST_ERROR)
  }
}

export function publishedQueryOptions(
  chainId: number,
  safe: Address,
  snapshot: SafeSnapshot | undefined,
  visible = true,
) {
  const target = visible ? publishedSnapshot(chainId, safe, snapshot) : undefined
  const authenticity = target?.authenticity
  return queryOptions({
    queryKey: [
      'published-queue',
      chainId,
      safe.toLowerCase(),
      target?.nonce?.toString() ?? 'inactive',
      authenticity?.status === 'verified' ? authenticity.codeHash : '',
      authenticity?.status === 'verified' ? authenticity.version : '',
    ],
    queryFn: ({ signal }) => {
      if (!target) throw new Error(REQUEST_ERROR)
      return fetchPublishedQueue(target, signal)
    },
    enabled: !!target,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: false,
  })
}

export function usePublishedQueue(
  chainId: number,
  safe: Address,
  snapshot: SafeSnapshot | undefined,
  visible: boolean,
) {
  const client = useQueryClient()
  const query = useQuery(publishedQueryOptions(chainId, safe, snapshot, visible))
  return {
    ...query,
    // Use the newly refreshed nonce/authenticity, not a refetch closure over the old snapshot.
    refresh: (fresh: SafeSnapshot) =>
      client.fetchQuery(publishedQueryOptions(chainId, safe, fresh)),
  }
}
