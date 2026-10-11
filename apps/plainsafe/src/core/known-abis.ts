// Bundled ABIs for standard interfaces (SPEC §7.1 level 3 "bundled"). A function from these is
// only used when its selector is in the target's bytecode (SPEC §7.3).
import { erc20Abi, erc721Abi, parseAbi } from 'viem'

const wethAbi = parseAbi(['function deposit() payable', 'function withdraw(uint256 wad)'])

export const safeManagementAbi = parseAbi([
  'function addOwnerWithThreshold(address owner, uint256 _threshold)',
  'function removeOwner(address prevOwner, address owner, uint256 _threshold)',
  'function swapOwner(address prevOwner, address oldOwner, address newOwner)',
  'function changeThreshold(uint256 _threshold)',
  'function enableModule(address module)',
  'function disableModule(address prevModule, address module)',
  'function setGuard(address guard)',
  'function setModuleGuard(address moduleGuard)',
  'function setFallbackHandler(address handler)',
  'function approveHash(bytes32 hashToApprove)',
])

const erc1155Abi = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] values, bytes data)',
  'function setApprovalForAll(address operator, bool approved)',
])

/** Uniswap's Permit2 (the same address on every chain); the swap batch calls approve (§3.13). */
export const permit2Abi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
])

/**
 * What a name owner calls on ENS: the registry, resolvers (any resolver implements these
 * record setters), the reverse registrar, the .eth registrar controllers (2023 and 2025) and
 * the NameWrapper. Signatures checked against the Mainnet contracts verified on Sourcify.
 */
export const ensAbi = parseAbi([
  // Registry (EIP-137); setApprovalForAll is the same as ERC-721's
  'function setOwner(bytes32 node, address owner)',
  'function setRecord(bytes32 node, address owner, address resolver, uint64 ttl)',
  'function setResolver(bytes32 node, address resolver)',
  'function setSubnodeOwner(bytes32 node, bytes32 label, address owner)',
  'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)',
  'function setTTL(bytes32 node, uint64 ttl)',
  // Resolver records
  'function approve(bytes32 node, address delegate, bool approved)',
  'function clearRecords(bytes32 node)',
  'function multicall(bytes[] data)',
  'function multicallWithNodeCheck(bytes32 nodehash, bytes[] data)',
  'function setABI(bytes32 node, uint256 contentType, bytes data)',
  'function setAddr(bytes32 node, address addr)',
  'function setAddr(bytes32 node, uint256 coinType, bytes addressBytes)',
  'function setContenthash(bytes32 node, bytes hash)',
  'function setDNSRecords(bytes32 node, bytes data)',
  'function setInterface(bytes32 node, bytes4 interfaceID, address implementer)',
  'function setName(bytes32 node, string newName)',
  'function setPubkey(bytes32 node, bytes32 x, bytes32 y)',
  'function setText(bytes32 node, string key, string value)',
  'function setZonehash(bytes32 node, bytes hash)',
  // Reverse registrar
  'function claim(address owner)',
  'function claimForAddr(address addr, address owner, address resolver)',
  'function claimWithResolver(address owner, address resolver)',
  'function setName(string name)',
  'function setNameForAddr(address addr, address owner, address resolver, string name)',
  // .eth registrar controllers and the base registrar
  'function commit(bytes32 commitment)',
  'function register(string name, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) payable',
  'struct Registration { string label; address owner; uint256 duration; bytes32 secret; address resolver; bytes[] data; uint8 reverseRecord; bytes32 referrer; }',
  'function register(Registration registration) payable',
  'function renew(string name, uint256 duration) payable',
  'function renew(string label, uint256 duration, bytes32 referrer) payable',
  'function reclaim(uint256 id, address owner)',
  // NameWrapper; setRecord, setResolver and setTTL are the same as the registry's
  'function extendExpiry(bytes32 parentNode, bytes32 labelhash, uint64 expiry)',
  'function setChildFuses(bytes32 parentNode, bytes32 labelhash, uint32 fuses, uint64 expiry)',
  'function setFuses(bytes32 node, uint16 ownerControlledFuses)',
  'function setSubnodeOwner(bytes32 parentNode, string label, address owner, uint32 fuses, uint64 expiry)',
  'function setSubnodeRecord(bytes32 parentNode, string label, address owner, address resolver, uint64 ttl, uint32 fuses, uint64 expiry)',
  'function unwrap(bytes32 parentNode, bytes32 labelhash, address controller)',
  'function unwrapETH2LD(bytes32 labelhash, address registrant, address controller)',
  'function upgrade(bytes name, bytes extraData)',
  'function wrap(bytes name, address wrappedOwner, address resolver)',
  'function wrapETH2LD(string label, address wrappedOwner, uint16 ownerControlledFuses, address resolver)',
])

export const knownAbis = [
  { name: 'ERC-20', abi: erc20Abi },
  { name: 'ERC-721', abi: erc721Abi },
  { name: 'ERC-1155', abi: erc1155Abi },
  { name: 'WETH', abi: wethAbi },
  { name: 'Safe', abi: safeManagementAbi },
  { name: 'Permit2', abi: permit2Abi },
  { name: 'ENS', abi: ensAbi },
] as const
