import { createIcons, icons } from 'lucide'
import { useEffect, useRef } from 'react'
import css from '../../../../../scripts/safe-batch/dashboard.css?raw'
import markup from '../../../../../scripts/safe-batch/dashboard.html?raw'
import { mountRotations } from '../../../../../scripts/safe-batch/dashboard.mjs'

export function RotationsScreen() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' })
    const template = new DOMParser().parseFromString(markup, 'text/html')
    template.querySelectorAll('script, nav, .desk-brand-credit').forEach((node) => {
      node.remove()
    })
    const title = template.querySelector('h1')
    if (title) title.textContent = 'Safe Ownership Management'
    const style = document.createElement('style')
    style.textContent =
      css.replaceAll(':root', ':host') +
      '\n:host {display:block;} header{background:transparent;border:0;padding:24px 16px 0;} main{padding:16px;} @media(min-width:900px){header{padding:24px 28px 0;} main{padding:20px 28px;}}'
    root.replaceChildren(style, ...Array.from(template.body.childNodes))
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    const dispose = mountRotations(root, {
      renderIcons: (target) => createIcons({ icons, root: target }),
      onBusy: (busy) => {
        if (busy) window.addEventListener('beforeunload', warnBeforeUnload)
        else window.removeEventListener('beforeunload', warnBeforeUnload)
      },
    })
    return () => {
      dispose()
      window.removeEventListener('beforeunload', warnBeforeUnload)
      root.replaceChildren()
    }
  }, [])
  return <div ref={host} data-testid="rotations-workspace" />
}
