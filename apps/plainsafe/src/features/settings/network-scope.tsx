import { createContext, type ReactNode, useContext, useState } from 'react'

const Context = createContext<{
  network: number | 'all'
  setNetwork: (id: number | 'all') => void
}>({ network: 'all', setNetwork: () => undefined })
export function NetworkScope({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<number | 'all'>('all')
  return <Context.Provider value={{ network, setNetwork }}>{children}</Context.Provider>
}
export const useNetworkScope = () => useContext(Context)
