import {ethers} from 'ethers';

export function safeIdentity(input) {
  if (!input || !Number.isSafeInteger(Number(input.chainId)) || Number(input.chainId) < 1) return null;
  try {
    const address = ethers.getAddress(input.address ?? input.safe);
    if (address === ethers.ZeroAddress) return null;
    return {chainId: Number(input.chainId), address, ...(typeof input.label === 'string' && input.label.trim() ? {label: input.label.trim().slice(0, 200)} : {})};
  } catch { return null; }
}
export const safeKey = input => {const safe = safeIdentity(input);return safe ? `${safe.chainId}:${safe.address.toLowerCase()}` : null;};
export function workspaceSafes(context, operations) {
  const result = [], seen = new Set();
  for (const item of [context?.selectedSafe, ...(context?.safes || []), ...operations.map(operation => ({chainId: operation.chainId, address: operation.safe}))]) {
    const safe = safeIdentity(item), key = safeKey(safe);
    if (safe && !seen.has(key)) {seen.add(key);result.push(safe);}
  }
  return result;
}
export const operationsForSafe = (operations, safe) => safe ? operations.filter(operation => safeKey(operation) === safeKey(safe)) : [];
export function preferredOperation(operations, safe) {
  return operationsForSafe(operations, safe).slice().sort((a,b) => {
    const diff = BigInt(b.nonce) - BigInt(a.nonce);
    return diff ? (diff > 0n ? 1 : -1) : operations.indexOf(b) - operations.indexOf(a);
  })[0];
}
export function safeQueueHref(safe, chains) {
  const identity = safeIdentity(safe), prefix = identity && chains[identity.chainId]?.short;
  if (!prefix || !/^[a-z0-9]+$/.test(prefix)) return null;
  return `${identity.chainId === 60808 ? 'https://safe.gobob.xyz' : 'https://app.safe.global'}/transactions/queue?safe=${prefix}:${identity.address}`;
}
export function replacementHashes(snapshot) {
  const hashes = [...(snapshot?.queuedTransactions || []).map(item => item.hash), ...(snapshot?.localOperations || []).map(item => item.hash)];
  if (hashes.some(hash => typeof hash !== 'string' || !/^0x[\da-f]{64}$/i.test(hash))) throw Error('A queued transaction hash is invalid; reload the Safe.');
  return [...new Set(hashes.map(hash => hash.toLowerCase()))].sort();
}

// Network dialogs may stay open while the Safe nonce or proposal queue changes.
export async function requestReviewedSignature({item, sender, method, request, check, assertCurrent}) {
  if (!['eip712','eth_sign'].includes(method)) throw Error('Choose a supported signing method');
  const computed = ethers.TypedDataEncoder.hash(item.signing.domain,item.signing.types,item.signing.message);
  if (computed.toLowerCase() !== item.hash.toLowerCase()) throw Error('Hash mismatch');
  assertCurrent();
  const live = await check();
  assertCurrent();
  if (live.hash?.toLowerCase() !== computed.toLowerCase() || !live.owners?.some(owner=>owner.toLowerCase() === sender.toLowerCase())) throw Error('Signing readiness does not match the reviewed hash and account');
  const target = '0x'+item.chainId.toString(16);
  if ((await request({method:'eth_chainId'})).toLowerCase() !== target) throw Error('Wallet network changed before signing');
  const accounts = await request({method:'eth_accounts'});
  assertCurrent();
  if (accounts[0]?.toLowerCase() !== sender.toLowerCase()) throw Error('Wallet account changed; reconnect');
  const payload = ethers.TypedDataEncoder.getPayload(item.signing.domain,item.signing.types,item.signing.message);
  return request(method === 'eth_sign' ? {method:'personal_sign',params:[item.hash,sender]} :
    {method:'eth_signTypedData_v4',params:[sender,JSON.stringify(payload)]});
}
