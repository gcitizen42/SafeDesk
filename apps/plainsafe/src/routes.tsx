// The screen and route map (SPEC §9.4).
import { useEffect } from 'react'
import { Route, Switch, useLocation } from 'wouter'
import { NotFound } from '@/components/layout/not-found'
import { Builder, NewTransaction, SwapScreen } from '@/features/builder/builder'
import { QueueScreen } from '@/features/queue/queue-screen'
import { DraftReview } from '@/features/review/draft-review'
import { PackageReview } from '@/features/review/package-review'
import { AddSafe } from '@/features/safes/add-safe'
import { CreateSafe } from '@/features/safes/create-safe'
import { Home } from '@/features/safes/home'
import { SafeOverview } from '@/features/safes/safe-overview'
import { SettingsScreen } from '@/features/settings/settings-screen'
import { isSetupDone, setReturnTo } from '@/features/setup/return-to'
import { SetupScreen } from '@/features/setup/setup-screen'
import { ImportPaste, ImportPayload } from '@/features/share/import'
import { VerifyScreen } from '@/features/verify/verify-screen'
import { useLoadedSettings } from '@/queries/settings'

const SAFE = '/safe/:chainId/:address'

/** Routes that work before setup is done: setup itself, opening a shared link, and Verify. */
const openBeforeSetup = (location: string) =>
  location === '/setup' ||
  location === '/import' ||
  location.startsWith('/import/') ||
  location === '/verify'

export function Routes() {
  const settings = useLoadedSettings()
  const [location, navigate] = useLocation()
  const gated = !isSetupDone(settings) && !openBeforeSetup(location)

  useEffect(() => {
    if (gated) {
      // A plain first visit goes on to Add a Safe after setup (SPEC §3.1), not back home.
      if (location !== '/') setReturnTo(location)
      navigate('/setup', { replace: true })
    }
  }, [gated, location, navigate])
  if (gated) return null

  return (
    <Switch>
      <Route path="/setup">
        <SetupScreen settings={settings} />
      </Route>
      <Route path="/" component={Home} />
      <Route path="/add" component={AddSafe} />
      <Route path="/add/new" component={CreateSafe} />
      <Route path={SAFE} component={SafeOverview} />
      <Route path={`${SAFE}/queue`}>
        <QueueScreen />
      </Route>
      <Route path={`${SAFE}/history`}>
        <QueueScreen history />
      </Route>
      <Route path={`${SAFE}/new`} component={NewTransaction} />
      <Route path={`${SAFE}/new/:preset`} component={Builder} />
      <Route path={`${SAFE}/swap`} component={SwapScreen} />
      <Route path={`${SAFE}/review`} component={DraftReview} />
      <Route path={`${SAFE}/tx/:safeTxHash`} component={PackageReview} />
      <Route path="/import" component={ImportPaste} />
      <Route path="/import/:payload" component={ImportPayload} />
      <Route path="/verify" component={VerifyScreen} />
      <Route path="/settings" component={SettingsScreen} />
      <Route path="/settings/:section" component={SettingsScreen} />
      <Route component={NotFound} />
    </Switch>
  )
}
