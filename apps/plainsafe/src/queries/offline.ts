// A view that promises no chain reads (Verify until "Check against chain", SPEC §3.10) renders
// inside <OfflineView value>: reads made only to decorate what's shown, such as ENS names, stay
// off there.
import { createContext, useContext } from 'react'

export const OfflineView = createContext(false)

export const useOfflineView = () => useContext(OfflineView)
