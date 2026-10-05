'use client';

import {
  Tooltip as TooltipRoot,
  TooltipTrigger,
  TooltipContent,
} from './ui/tooltip';

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  shortcut?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * Thin wrapper over the Radix tooltip primitives whose provider is mounted
 * app-wide in src/app/providers.tsx. (The previous version depended on a
 * custom TooltipProvider that was only mounted in dead code, so rendering
 * this component crashed the page.)
 */
export default function Tooltip({
  children,
  content,
  shortcut,
  placement = 'top',
}: TooltipProps) {
  const displayContent = shortcut ? (
    <div>
      {content}
      <div className="text-gray-400 mt-1 text-[10px] font-mono">{shortcut}</div>
    </div>
  ) : (
    content
  );

  return (
    <TooltipRoot delayDuration={300}>
      <TooltipTrigger asChild>
        <span className="relative inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side={placement}>{displayContent}</TooltipContent>
    </TooltipRoot>
  );
}
