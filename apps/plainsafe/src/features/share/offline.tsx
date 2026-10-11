// The offline step of opening a shared package (SPEC §3.7 step 1), for #/import and #/verify:
// decode it, recompute its hashes and recover its signers, before any request.
import { Either } from 'effect'
import { type ReactNode, useState } from 'react'
import { Callout } from '@/components/callout'
import { FileButton } from '@/components/file-button'
import { Button } from '@/components/ui/button'
import {
  type PackageProblem,
  parseShared,
  type VerifiedPackage,
  verifyPackage,
} from '@/core/package'

export function problemText(p: PackageProblem): string {
  return p._tag === 'HashMismatch'
    ? `The package's ${p.field} hash (${p.claimed}) doesn't match the one computed from its contents (${p.computed}). It was changed or corrupted.`
    : `This isn't a valid Plain Safe package. ${p.message}`
}

/** A pasted link, plainsafe:1: code or package JSON, or a dropped or chosen .json file. */
export function PackageInput(props: {
  /** The submit button's label. */
  action: string
  /** Each package that passes; undefined while the next input is checked, and if it's rejected. */
  onVerified: (v: VerifiedPackage | undefined) => void | Promise<void>
  /** More buttons next to the submit button. */
  children?: ReactNode
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const submit = async (input: string) => {
    setError(undefined)
    await props.onVerified(undefined)
    try {
      const v = await verifyPackage(await parseShared(input))
      if (Either.isLeft(v)) return setError(problemText(v.left))
      await props.onVerified(v.right)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <textarea
        aria-label="Link, code or JSON"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const file = e.dataTransfer.files[0]
          if (!file) return
          e.preventDefault()
          void file.text().then((t) => {
            setText(t)
            return submit(t)
          })
        }}
        rows={6}
        spellCheck={false}
        placeholder="https://…/#/import/…, plainsafe:1:…, or package JSON"
        className="rounded-lg border bg-background p-2 font-mono text-xs"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void submit(text)} disabled={!text.trim()}>
          {props.action}
        </Button>
        <FileButton label="Choose a file" onFile={(f) => f.text().then(submit)} />
        {props.children}
      </div>
      {error && (
        <div data-testid="package-rejected">
          <Callout severity="red" title="Rejected">
            {error}
          </Callout>
        </div>
      )}
    </div>
  )
}

/** SPEC §6: a package's note is always shown as unverified. */
export function ProposerNote({ note }: { note: string }) {
  return (
    <p className="rounded-lg border border-dashed p-3 text-sm">
      <span className="font-medium">Proposer's note (unverified): </span>
      {note}
    </p>
  )
}
