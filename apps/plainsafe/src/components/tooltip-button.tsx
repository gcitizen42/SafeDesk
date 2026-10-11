// A button that explains itself on hover or focus. The tooltip sits on a wrapper, so it still
// shows while the button is disabled.
import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function TooltipButton({ tip, ...props }: ComponentProps<typeof Button> & { tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button {...props} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}
