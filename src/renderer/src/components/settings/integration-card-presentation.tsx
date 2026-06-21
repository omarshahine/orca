import { createContext, useContext } from 'react'
import { cn } from '@/lib/utils'

type IntegrationCardPresentation = 'default' | 'setup-guide'

const IntegrationCardPresentationContext = createContext<IntegrationCardPresentation>('default')

export function IntegrationCardPresentationProvider(props: {
  value: IntegrationCardPresentation
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <IntegrationCardPresentationContext.Provider value={props.value}>
      {props.children}
    </IntegrationCardPresentationContext.Provider>
  )
}

export function useIntegrationCardPresentation(): IntegrationCardPresentation {
  return useContext(IntegrationCardPresentationContext)
}

export function useIntegrationCardShellClass(className?: string): string {
  const presentation = useIntegrationCardPresentation()
  return cn(
    presentation === 'setup-guide'
      ? 'border-t border-border/60 bg-card px-1 py-3 first:border-t-0'
      : 'rounded-xl border border-border bg-card px-4 py-3.5 shadow-xs',
    className
  )
}

export function useIntegrationSubordinateRowClass(className?: string): string {
  const presentation = useIntegrationCardPresentation()
  return cn(
    presentation === 'setup-guide'
      ? 'border-t border-border/60 px-0 py-2 first:border-t-0'
      : 'rounded-md border border-border/50 bg-muted/50 px-3 py-2',
    className
  )
}

export function useIntegrationCommandRowClass(): string {
  const presentation = useIntegrationCardPresentation()
  return cn(
    'flex items-center gap-2 font-mono text-xs',
    presentation === 'setup-guide'
      ? 'border-t border-border/60 px-0 py-2'
      : 'rounded-md border border-border/50 bg-muted/50 px-3 py-2'
  )
}
