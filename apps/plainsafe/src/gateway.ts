// SPEC §12: refuse to run on path-based IPFS gateways (`/ipfs/<cid>`, `/ipns/<name>`).
// Every site on a path gateway shares one origin, so any of them could read and modify our
// stored data. This module runs before netguard and storage, and imports nothing.

export interface PathGateway {
  readonly kind: 'ipfs' | 'ipns'
  readonly id: string
}

const ID = /^[a-zA-Z0-9.-]{1,253}$/

/** A malformed escape (`%zz`) would throw here and leave a blank page instead of the refusal. */
const decode = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return ''
  }
}

export function detectPathGateway(pathname: string): PathGateway | undefined {
  const m = /^\/(ipfs|ipns)\/([^/]+)/.exec(pathname)
  if (!m) return
  const id = decode(m[2] ?? '')
  return { kind: m[1] as 'ipfs' | 'ipns', id: ID.test(id) ? id : '' }
}

/** The same content on a subdomain gateway, keeping the `#` fragment (for example a shared link). */
export function subdomainUrl({ kind, id }: PathGateway, hash: string): string | undefined {
  if (!id) return
  const fragment = hash.startsWith('#') ? hash : ''
  if (kind === 'ipfs') {
    // CIDv1 (base32, lowercase) works as a subdomain label. CIDv0 (Qm…) is case-sensitive, so
    // link to dweb.link's path form, which redirects to the subdomain form with the CID converted.
    if (/^b[a-z2-7]+$/.test(id)) return `https://${id}.ipfs.dweb.link/${fragment}`
    if (id.startsWith('Qm')) return `https://dweb.link/ipfs/${id}/${fragment}`
    return
  }
  // DNSLink names are inlined into one label: '-' → '--', '.' → '-'
  const label = id.includes('.') ? id.replaceAll('-', '--').replaceAll('.', '-') : id.toLowerCase()
  return `https://${label}.ipns.dweb.link/${fragment}`
}

const ENS_URL = 'https://plainsafe.eth.limo/'

export function renderGatewayRefusal(doc: Document, gateway: PathGateway, hash: string): void {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = doc.createElement(tag)
    if (text) node.textContent = text
    return node
  }
  const link = (href: string, text: string) => {
    const a = el('a', text)
    a.href = href
    a.rel = 'noreferrer'
    a.style.cssText = 'display:block;margin:0.5rem 0;word-break:break-all'
    return a
  }
  const main = el('main')
  main.style.cssText =
    'max-width:36rem;margin:4rem auto;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.5'
  main.append(
    el('h1', 'Plain Safe will not run on a path gateway'),
    el(
      'p',
      'This address serves the app from a shared path (/ipfs/… or /ipns/…). Every site on this ' +
        'gateway shares one origin, so any of them could read or change your saved data, for ' +
        'example to swap in a malicious RPC. Open Plain Safe from one of these instead:',
    ),
  )
  const sub = subdomainUrl(gateway, hash)
  if (sub) main.append(link(sub, sub))
  main.append(link(ENS_URL + (hash.startsWith('#') ? hash : ''), 'plainsafe.eth.limo'))
  doc.body.replaceChildren(main)
}
