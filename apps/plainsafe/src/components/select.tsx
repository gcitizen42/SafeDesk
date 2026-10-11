// A native <select>, styled like the app's inputs.
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn('h-9 rounded-lg border bg-background px-2 text-sm', className)}
      {...props}
    />
  )
}
