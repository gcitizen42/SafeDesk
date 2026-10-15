import {createHash} from 'node:crypto';
import {SuiGrpcClient} from '@mysten/sui/grpc';
import {SuiGraphQLClient} from '@mysten/sui/graphql';
import {MultiSigPublicKey} from '@mysten/sui/multisig';
import {parseSerializedSignature} from '@mysten/sui/cryptography';
import {publicKeyFromSuiBytes} from '@mysten/sui/verify';
import {Transaction} from '@mysten/sui/transactions';
import {normalizeSuiAddress, normalizeStructTag, isValidTransactionDigest} from '@mysten/sui/utils';

export const SUI_RPC = 'https://fullnode.mainnet.sui.io:443';
export const SUI_ARCHIVE = 'https://graphql.mainnet.sui.io/graphql';
export const SUI_MAINNET = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';
const SUI_TYPE = normalizeStructTag('0x2::sui::SUI');
const SUI_COIN = normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>');
const GAS_BUDGET = 50_000_000n;
const MAX_GAS_BUDGET = 100_000_000n;
const MAX_AGE = 15 * 60 * 1000;
// MSafe sui3-utils 5.1.0: a final Ed25519 "maven" nonce key is an account specifier, not an owner.
function msafeNonce(key) {
  const bytes = key.toRawBytes();
  return key.flag() === 0 && bytes.length === 32 && Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from('maven', 'ascii')) && bytes.subarray(5, 16).every(byte => byte === 0) && bytes.subarray(20).every(byte => byte === 0)
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16, true) : null;
}
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const hashRecord = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function suiAddress(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value) || BigInt(value) === 0n) throw Error('A nonzero Sui address is required.');
  return normalizeSuiAddress(value);
}
function uint(value, name) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw Error(`Invalid ${name}.`);
  if (!/^(0|[1-9]\d{0,19})$/.test(String(value))) throw Error(`Invalid ${name}.`);
  return BigInt(value);
}
function assertPublic(value) {
  if (!isRecord(value)) throw Error('A public configuration object is required.');
  const visit = item => {
    if (Array.isArray(item)) { for (const v of item) visit(v); return; }
    if (!isRecord(item)) return;
    for (const [key, v] of Object.entries(item)) {
      if (/private|secret|mnemonic|seed|password|token|signature/i.test(key)) throw Error('Only public keys and wallet configuration are accepted.');
      visit(v);
    }
  };
  visit(value);
}
export function normalizePolicy(input, expectedAddress) {
  assertPublic(input);
  if (!Number.isInteger(input.threshold) || input.threshold < 1 || input.threshold > 65535 || !Array.isArray(input.members) || input.members.length < 2 || input.members.length > 10) throw Error('Policy needs 2-10 public keys and a reachable weighted threshold.');
  const publicKeys = input.members.map(member => {
    if (!isRecord(member) || typeof member.publicKey !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(member.publicKey) || member.publicKey.length > 100) throw Error('Each owner needs its scheme-prefixed Base64 Sui public key. Addresses alone are not public keys.');
    const bytes = Buffer.from(member.publicKey, 'base64');
    if (bytes.toString('base64') !== member.publicKey || ![0, 1, 2].includes(bytes[0]) || bytes.length !== (bytes[0] === 0 ? 33 : 34)) throw Error('Only Ed25519, Secp256k1 and Secp256r1 Sui public keys are supported.');
    if (!Number.isInteger(member.weight) || member.weight < 1 || member.weight > 255) throw Error('Owner weights must be integers from 1 to 255.');
    const publicKey = publicKeyFromSuiBytes(bytes);
    if (member.address !== undefined && suiAddress(member.address) !== publicKey.toSuiAddress()) throw Error('An owner address does not match its public key.');
    return {publicKey, weight: member.weight};
  });
  if (input.creationNonce !== undefined) {
    if (!Number.isInteger(input.creationNonce) || input.creationNonce < 0 || input.creationNonce > 0xffffffff) throw Error('Invalid MSafe creation nonce.');
    if (msafeNonce(publicKeys.at(-1).publicKey) === null) {
      if (publicKeys.length > 9) throw Error('MSafe accepts at most nine owners plus its account specifier.');
      const bytes = Buffer.alloc(33); bytes.write('maven', 1, 'ascii'); bytes.writeUInt32LE(input.creationNonce, 17);
      publicKeys.push({publicKey: publicKeyFromSuiBytes(bytes), weight: 1});
    } else if (msafeNonce(publicKeys.at(-1).publicKey) !== input.creationNonce) throw Error('MSafe specifier and creation nonce differ.');
  }
  const hasSpecifier = msafeNonce(publicKeys.at(-1).publicKey) !== null;
  if (hasSpecifier && publicKeys.at(-1).weight !== 1) throw Error('MSafe specifier weight must be exactly one and is not an owner approval.');
  if (publicKeys.slice(0, -1).some(member => msafeNonce(member.publicKey) !== null)) throw Error('MSafe account specifier must be the final key.');
  if (input.threshold > publicKeys.slice(0, hasSpecifier ? -1 : undefined).reduce((sum, member) => sum + member.weight, 0)) throw Error('The weighted threshold cannot be reached without the MSafe specifier.');
  const key = MultiSigPublicKey.fromPublicKeys({threshold: input.threshold, publicKeys});
  const address = key.toSuiAddress();
  if ((expectedAddress && address !== suiAddress(expectedAddress)) || (input.address && address !== suiAddress(input.address))) throw Error('The public policy does not derive the expected vault address. Include every key in its original order, including any MSafe account specifier.');
  return {address, threshold: key.getThreshold(), ownerCount: publicKeys.length - (hasSpecifier ? 1 : 0), ...(hasSpecifier ? {creationNonce: msafeNonce(publicKeys.at(-1).publicKey)} : {}), members: key.getPublicKeys().map((member, index) => ({address: member.publicKey.toSuiAddress(), publicKey: member.publicKey.toSuiPublicKey(), weight: member.weight, ...(hasSpecifier && index === publicKeys.length - 1 ? {role: 'msafe-specifier'} : {})}))};
}
export function policyFromTransaction(transaction, vault) {
  if (!transaction?.status?.success || suiAddress(transaction.transaction?.sender) !== vault || !Array.isArray(transaction.signatures)) throw Error('Evidence must be a successful outgoing transaction from this vault.');
  for (const signature of transaction.signatures) {
    try {
      const parsed = parseSerializedSignature(signature);
      if (parsed.signatureScheme !== 'MultiSig') continue;
      const key = new MultiSigPublicKey(parsed.multisig.multisig_pk);
      if (key.toSuiAddress() !== vault) continue;
      return normalizePolicy({threshold: key.getThreshold(), members: key.getPublicKeys().map(member => ({publicKey: member.publicKey.toSuiPublicKey(), weight: member.weight}))}, vault);
    } catch { /* Ignore unrelated sponsor or unsupported signatures. */ }
  }
  throw Error('No supported multisig public policy matches this vault in the evidence.');
}
// Unknown non-coin objects may confer authority too (kiosks, policies, custom capabilities).
const objectKind = type => type === SUI_COIN ? 'sui-gas' : type.startsWith(`${normalizeSuiAddress('0x2')}::coin::Coin<`) ? 'coin' : 'privileged';
const capabilitySelectionHash = (sourceVault, destinationVault, objects) => hashRecord({sourceVault, destinationVault, objects: objects.filter(object => object.kind === 'privileged')});
function objectView(object, vault) {
  const objectId = suiAddress(object.objectId);
  const type = normalizeStructTag(object.type);
  if (object.owner?.$kind !== 'AddressOwner' || suiAddress(object.owner.AddressOwner) !== vault) throw Error('An object is not directly owned by this vault.');
  if (!object.digest || typeof object.digest !== 'string' || !isValidTransactionDigest(object.digest) || uint(object.version, 'object version') < 1n) throw Error('An object reference is incomplete.');
  const kind = objectKind(type);
  return {objectId, type, version: String(object.version), digest: object.digest, kind, selectable: kind !== 'sui-gas'};
}
async function pages(read, field, maximum = 5) {
  const values = [], cursors = new Set();
  let cursor = null;
  for (let page = 0; page < maximum; page++) {
    const result = await read(cursor);
    if (!Array.isArray(result[field]) || result[field].length > 50) throw Error('Invalid Sui page.');
    values.push(...result[field]);
    if (!result.hasNextPage) return {values, complete: true};
    if (typeof result.cursor !== 'string' || cursors.has(result.cursor)) throw Error('Invalid Sui pagination.');
    cursor = result.cursor; cursors.add(cursor);
  }
  return {values, complete: false};
}
function resultTx(result) { return result?.Transaction || result?.FailedTransaction; }

export class SuiOperations {
  constructor({client = new SuiGrpcClient({network: 'mainnet', baseUrl: SUI_RPC}), archiveClient = new SuiGraphQLClient({network: 'mainnet', url: SUI_ARCHIVE}), now = () => Date.now()} = {}) { this.client = client; this.archiveClient = archiveClient; this.now = now; }
  async assertNetwork(signal) {
    const {chainIdentifier} = await this.client.getChainIdentifier({signal});
    if (chainIdentifier !== SUI_MAINNET) throw Error('RPC is not the pinned Sui mainnet.');
    return chainIdentifier;
  }
  async sourcePolicy(input, vault, signal) {
    if (input.sourcePolicy) return {...normalizePolicy(input.sourcePolicy, vault), source: 'imported-address-verified'};
    if (input.evidenceDigest) {
      if (!isValidTransactionDigest(input.evidenceDigest)) throw Error('Invalid Sui evidence transaction digest.');
      let result;
      try { result = await this.client.getTransaction({digest: input.evidenceDigest, include: {transaction: true}, signal}); }
      catch {
        if (signal?.aborted) throw Error('Sui inspection timed out.');
        await this.assertArchive(signal);
        result = await this.archiveClient.getTransaction({digest: input.evidenceDigest, include: {transaction: true}, signal});
      }
      const transaction = resultTx(result);
      if (transaction?.digest !== input.evidenceDigest) throw Error('Evidence digest does not match the returned transaction.');
      return {...policyFromTransaction(transaction, vault), source: `executed-transaction:${input.evidenceDigest}`};
    }
    for (const client of [this.client, this.archiveClient]) try {
      if (client === this.archiveClient) await this.assertArchive(signal);
      let before = undefined;
      for (let page = 0; page < 3; page++) {
        const recent = await client.listTransactions({filter: {sender: vault}, order: 'descending', before, limit: 10, include: {transaction: true}, signal});
        for (const result of recent.transactions) {
          try { const tx = resultTx(result); return {...policyFromTransaction(tx, vault), source: `executed-transaction:${tx.digest}`}; } catch { /* Continue bounded history inspection. */ }
        }
        if (!recent.hasNextPage || !recent.endCursor || recent.endCursor === before) break;
        before = recent.endCursor;
      }
    } catch { if (signal?.aborted) throw Error('Sui inspection timed out.'); }
    return null;
  }
  async assertArchive(signal) {
    if ((await this.archiveClient.getChainIdentifier({signal})).chainIdentifier !== SUI_MAINNET) throw Error('Archive is not the pinned Sui mainnet.');
  }
  async resolveTarget(input, signal) {
    assertPublic(input);
    if (!Array.isArray(input.members) || input.members.length < 2 || input.members.length > 10) throw Error('Target needs 2-10 owner rows.');
    const members = [];
    for (const member of input.members) {
      if (member.publicKey) { members.push(member); continue; }
      const address = suiAddress(member.address);
      let found;
      await this.assertArchive(signal);
      const recent = await this.archiveClient.listTransactions({filter: {sender: address}, order: 'descending', limit: 10, include: {transaction: true}, signal});
      for (const result of recent.transactions) {
        const tx = resultTx(result);
        if (!tx?.status?.success || tx.transaction?.sender !== address) continue;
        for (const signature of tx.signatures) {
          try {
            const parsed = parseSerializedSignature(signature);
            if (!['ED25519', 'Secp256k1', 'Secp256r1'].includes(parsed.signatureScheme)) continue;
            const bytes = Buffer.concat([Buffer.from([parsed.signatureScheme === 'ED25519' ? 0 : parsed.signatureScheme === 'Secp256k1' ? 1 : 2]), Buffer.from(parsed.publicKey)]);
            const key = publicKeyFromSuiBytes(bytes);
            if (key.toSuiAddress() === address) { found = key.toSuiPublicKey(); break; }
          } catch { /* Other signers or unsupported signature schemes are not key evidence. */ }
        }
        if (found) break;
      }
      if (!found) throw Error("An incoming owner public key could not be resolved from bounded history. Supply that owner's scheme-prefixed Base64 public key.");
      members.push({...member, publicKey: found});
    }
    return normalizePolicy({...input, members});
  }
  async inspect(input, signal = AbortSignal.timeout(30000)) {
    assertPublic(input);
    const vault = suiAddress(input.vault), signer = input.signer ? suiAddress(input.signer) : null;
    const chainIdentifier = await this.assertNetwork(signal);
    const owned = await pages(cursor => this.client.listOwnedObjects({owner: vault, cursor, limit: 50, signal}), 'objects');
    const balances = await pages(cursor => this.client.listBalances({owner: vault, cursor, limit: 50, signal}), 'balances');
    const objects = owned.values.map(object => objectView(object, vault));
    if (new Set(objects.map(object => object.objectId)).size !== objects.length) throw Error('Duplicate inventory objects; refresh before planning.');
    const policy = await this.sourcePolicy(input, vault, signal);
    const warnings = [];
    const amounts = [];
    for (const [index, item] of balances.values.entries()) {
      const coinType = normalizeStructTag(item.coinType);
      const balance = uint(item.balance, 'token balance').toString();
      let metadata = coinType === SUI_TYPE ? {symbol: 'SUI', decimals: 9} : null;
      if (!metadata && index < 20 && typeof this.client.getCoinMetadata === 'function') {
        try { metadata = (await this.client.getCoinMetadata({coinType, signal})).coinMetadata; }
        catch { if (signal?.aborted) throw Error('Sui inspection timed out.'); }
      }
      amounts.push({coinType, balance, coinBalance: uint(item.coinBalance, 'coin balance').toString(), addressBalance: uint(item.addressBalance, 'address balance').toString(), ...(metadata && typeof metadata.symbol === 'string' && metadata.symbol.length <= 40 && Number.isInteger(metadata.decimals) && metadata.decimals >= 0 && metadata.decimals <= 255 ? {symbol: metadata.symbol, decimals: metadata.decimals} : {})});
    }
    if (!policy) warnings.push('Public signer policy could not be recovered. Import the complete public policy or an executed vault transaction digest. No migration export is allowed until it derives this vault.');
    if (!owned.complete || !balances.complete) warnings.push('Inventory is partial; migration building is blocked.');
    if (objects.some(object => object.kind === 'privileged')) warnings.push('This vault owns authority-sensitive or unknown non-coin objects. Token transfers alone do not migrate these objects or their permissions.');
    warnings.push('Native Sui signer changes derive a different address. MSafe account specifiers must be preserved when verifying existing policies. Destination MSafe registration and signer access need independent confirmation.');
    return {network: 'sui:mainnet', checkedAt: new Date(this.now()).toISOString(), chainIdentifier, vault, complete: owned.complete && balances.complete, policy, signerMember: signer && policy ? policy.members.some(member => member.address === signer && member.role !== 'msafe-specifier') : null, balances: amounts, objects, warnings};
  }
  async plan(input, signal = AbortSignal.timeout(30000)) {
    assertPublic(input);
    const source = await this.inspect(input, signal);
    if (!source.complete || !source.policy) throw Error('A complete inventory and source public policy verified against the vault are required.');
    if (input.signer && source.signerMember !== true) throw Error('The supplied signer is not in the source public policy.');
    const target = await this.resolveTarget(input.targetPolicy, signal);
    if (target.address === source.vault) throw Error('Destination policy is unchanged; this is not a rotation.');
    if (input.ackDestination !== true) throw Error('Confirm that destination keys, weighted threshold, wallet access and any required MSafe registration have been independently verified.');
    if (!Array.isArray(input.objectIds) || input.objectIds.length < 1 || input.objectIds.length > 50) throw Error('Select 1-50 exact objects. Empty transactions and automatic sweep-all exports are not allowed.');
    const ids = input.objectIds.map(suiAddress);
    if (new Set(ids).size !== ids.length) throw Error('Duplicate object selection.');
    const selected = ids.map(id => {
      const object = source.objects.find(item => item.objectId === id);
      if (!object || !object.selectable) throw Error('Selected object is missing, not directly owned, or reserved SUI gas.');
      if (object.kind === 'privileged' && input.ackPrivileged !== true) throw Error('Administrative capability transfers require explicit acknowledgement.');
      return object;
    });
    const budget = input.gasBudgetMist === undefined ? GAS_BUDGET : uint(input.gasBudgetMist, 'gas budget');
    if (budget < 1n || budget > MAX_GAS_BUDGET) throw Error('Gas budget must be at most 0.1 SUI.');
    const coins = await pages(cursor => this.client.listCoins({owner: source.vault, coinType: SUI_TYPE, cursor, limit: 50, signal}), 'objects');
    if (!coins.complete) throw Error('Gas inventory is partial.');
    const gas = coins.values.filter(coin => uint(coin.balance, 'coin balance') >= budget).sort((a, b) => BigInt(a.balance) > BigInt(b.balance) ? -1 : 1)[0];
    if (!gas) throw Error('No reserved SUI coin covers the gas budget. This first version does not spend address balances or merge gas coins.');
    const gasView = objectView(gas, source.vault);
    if (gasView.kind !== 'sui-gas') throw Error('Gas payment is not a SUI coin.');
    const {referenceGasPrice} = await this.client.getReferenceGasPrice({signal});
    const price = uint(referenceGasPrice, 'gas price');
    if (price < 1n) throw Error('Invalid reference gas price.');
    const {systemState} = await this.client.getCurrentSystemState({signal});
    const expiration = uint(systemState.epoch, 'epoch') + 1n;
    const tx = new Transaction();
    tx.setSender(source.vault); tx.setGasOwner(source.vault); tx.setGasPrice(price); tx.setGasBudget(budget);
    tx.setGasPayment([{objectId: gasView.objectId, version: gasView.version, digest: gasView.digest}]);
    tx.setExpiration({Epoch: expiration.toString()});
    tx.transferObjects(selected.map(object => tx.objectRef({objectId: object.objectId, version: object.version, digest: object.digest})), tx.pure.address(target.address));
    const bytes = await tx.build();
    const transactionJson = await tx.toJSON();
    const result = {schema: 'safedesk-sui-migration-v1', network: 'sui:mainnet', createdAt: new Date(this.now()).toISOString(), sourceVault: source.vault, destinationVault: target.address, sourcePolicy: source.policy, targetPolicy: target, selectedObjects: selected, remainingObjectIds: source.objects.filter(object => !ids.includes(object.objectId)).map(object => object.objectId), transaction: JSON.parse(transactionJson), transactionJson, transactionBytes: Buffer.from(bytes).toString('base64'), transactionDigest: await tx.getDigest(), buildOnly: true, warnings: [...source.warnings, 'Partial migration only: unselected objects and SUI gas remain in the old vault. Native destination configuration is not proof of MSafe registration or private-key availability.', 'MSafe can rebuild gas/transaction data. Compare its final sender, destination, object list and digest before signing. This export contains no signature or authorization.']};
    result.acknowledgements = {destination: true, privileged: input.ackPrivileged === true, capabilitySelectionHash: capabilitySelectionHash(source.vault, target.address, selected)};
    return {...result, packageHash: hashRecord(result)};
  }
  async simulate(input, signal = AbortSignal.timeout(30000)) {
    const pkg = input.package;
    assertPublic(pkg);
    const {packageHash, ...content} = pkg;
    if (pkg.schema !== 'safedesk-sui-migration-v1' || pkg.network !== 'sui:mainnet' || pkg.buildOnly !== true || packageHash !== hashRecord(content)) throw Error('Migration package hash or schema does not match.');
    const created = Date.parse(pkg.createdAt);
    if (!Number.isFinite(created) || created > this.now() + 1000 || this.now() - created > MAX_AGE) throw Error('Rebuild a fresh migration package before simulation.');
    await this.assertNetwork(signal);
    const source = suiAddress(pkg.sourceVault), destination = suiAddress(pkg.destinationVault);
    normalizePolicy(pkg.sourcePolicy, source); normalizePolicy(pkg.targetPolicy, destination);
    if (source === destination || !Array.isArray(pkg.selectedObjects) || pkg.selectedObjects.length < 1 || pkg.selectedObjects.length > 50) throw Error('Invalid migration selection.');
    const tx = Transaction.from(pkg.transactionJson);
    const data = tx.getData();
    if (JSON.stringify(pkg.transaction) !== JSON.stringify(JSON.parse(pkg.transactionJson)) || suiAddress(data.sender) !== source || suiAddress(data.gasData.owner) !== source || data.commands.length !== 1 || data.commands[0].$kind !== 'TransferObjects') throw Error('Only the reviewed single-command object migration is supported.');
    if (uint(data.gasData.budget, 'gas budget') > MAX_GAS_BUDGET || uint(data.gasData.budget, 'gas budget') < 1n || !Array.isArray(data.gasData.payment) || data.gasData.payment.length !== 1) throw Error('Invalid migration gas configuration.');
    const expected = new Transaction();
    const ids = pkg.selectedObjects.map(object => suiAddress(object.objectId));
    if (new Set(ids).size !== ids.length) throw Error('Duplicate migration objects.');
    expected.transferObjects(pkg.selectedObjects.map(object => expected.objectRef({objectId: suiAddress(object.objectId), version: String(object.version), digest: object.digest})), expected.pure.address(destination));
    const expectedData = Transaction.from(await expected.toJSON()).getData();
    if (hashRecord(data.inputs) !== hashRecord(expectedData.inputs) || hashRecord(data.commands) !== hashRecord(expectedData.commands)) throw Error('Calldata does not match the reviewed destination and exact objects.');
    const refs = [...pkg.selectedObjects, ...data.gasData.payment];
    const current = await this.client.getObjects({objectIds: refs.map(object => object.objectId), signal});
    if (current.objects.length !== refs.length) throw Error('Incomplete current object verification.');
    current.objects.forEach((object, index) => {
      const view = objectView(object, source), ref = refs[index];
      if (view.version !== String(ref.version) || view.digest !== ref.digest || (index < ids.length && view.kind === 'sui-gas') || (index === ids.length && view.kind !== 'sui-gas')) throw Error('Object version, ownership or gas changed. Rebuild before simulation.');
      if (index < ids.length && (view.type !== ref.type || view.kind !== ref.kind || view.selectable !== ref.selectable)) throw Error('Selected object authority/type metadata does not match the current chain object.');
    });
    if (pkg.acknowledgements?.destination !== true || pkg.acknowledgements?.capabilitySelectionHash !== capabilitySelectionHash(source, destination, pkg.selectedObjects) || (pkg.selectedObjects.some(object => object.kind === 'privileged') && pkg.acknowledgements?.privileged !== true)) throw Error('Exact destination and authority-object acknowledgements are required.');
    const {systemState} = await this.client.getCurrentSystemState({signal});
    if (!data.expiration?.Epoch || uint(data.expiration.Epoch, 'expiration') < uint(systemState.epoch, 'epoch') || uint(data.expiration.Epoch, 'expiration') > uint(systemState.epoch, 'epoch') + 1n) throw Error('Migration expiration is not current.');
    const {referenceGasPrice} = await this.client.getReferenceGasPrice({signal});
    if (uint(data.gasData.price, 'gas price') !== uint(referenceGasPrice, 'gas price')) throw Error('Gas price changed. Rebuild before simulation.');
    const bytes = await tx.build();
    if (Buffer.from(bytes).toString('base64') !== pkg.transactionBytes || await tx.getDigest() !== pkg.transactionDigest) throw Error('Transaction bytes or digest do not match the review package.');
    const result = await this.client.simulateTransaction({transaction: bytes, checksEnabled: true, doGasSelection: false, include: {effects: true, balanceChanges: true}, signal});
    const transaction = resultTx(result), changed = transaction?.effects?.changedObjects || [];
    const transferred = ids.every(id => changed.some(object => object.objectId === id && object.outputOwner?.$kind === 'AddressOwner' && object.outputOwner.AddressOwner === destination));
    const gasRetained = changed.some(object => object.objectId === data.gasData.payment[0].objectId && object.outputOwner?.$kind === 'AddressOwner' && object.outputOwner.AddressOwner === source);
    const passed = transaction?.status?.success === true && result.gasPaymentMocked === false && transferred && gasRetained;
    return {status: passed ? 'passed' : 'failed', checkedAt: new Date(this.now()).toISOString(), transactionDigest: pkg.transactionDigest, packageHash, gasPaymentMocked: result.gasPaymentMocked !== false, authorizationVerified: false, checksEnabled: true, gasUsed: transaction?.effects?.gasUsed || {}, balanceChanges: transaction?.balanceChanges || [], changedObjects: changed.map(object => ({objectId: object.objectId, inputOwner: object.inputOwner, outputOwner: object.outputOwner, outputVersion: object.outputVersion, idOperation: object.idOperation})), warnings: [passed ? 'Exact selected objects reached the derived destination in native simulation with real gas references.' : 'Native simulation failed, mocked gas, or did not show every reviewed destination ownership change.', 'Unsigned simulation does not verify owner signatures or authorize execution. No transaction was submitted.']};
  }
}
