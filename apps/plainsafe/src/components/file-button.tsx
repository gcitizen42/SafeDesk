// A file picker that looks like the app's other buttons: a real button opens the hidden native
// input, which stays out of the accessibility tree. The chosen file's name shows beside it.
import { Upload } from 'lucide-react'
import { type ComponentProps, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

export function FileButton({
  label,
  onFile,
  accept = 'application/json,.json',
  variant = 'outline',
  size = 'sm',
  ...props
}: Omit<ComponentProps<typeof Button>, 'onClick' | 'children'> & {
  label: string
  onFile: (file: File) => void | Promise<void>
  accept?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [name, setName] = useState<string>()
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => input.current?.click()}
        {...props}
      >
        <Upload /> {label}
      </Button>
      {name && <span className="truncate text-sm text-muted-foreground">{name}</span>}
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          // Cleared so choosing the same file again still fires
          e.target.value = ''
          if (!f) return
          setName(f.name)
          void onFile(f)
        }}
      />
    </span>
  )
}
