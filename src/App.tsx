import { lazy, Suspense } from 'react'
import { Route, Switch } from 'wouter'
import 'leaflet/dist/leaflet.css'
import { SessionGate } from './components/shared/SessionGate'
import { NotFound } from './pages/NotFound'
import { RouteFallback } from './components/shared/RouteFallback'
import './App.css'

const LandingPage = lazy(() => import('./pages/public/LandingPage').then(m => ({ default: m.LandingPage })))
const GovernmentDirectoryPage = lazy(() =>
  import('./pages/public/GovernmentDirectoryPage').then(m => ({ default: m.GovernmentDirectoryPage }))
)
const GovernmentServiceDetailPage = lazy(() =>
  import('./pages/public/GovernmentServiceDetailPage').then(m => ({ default: m.GovernmentServiceDetailPage }))
)
const LoginPage = lazy(() => import('./pages/auth/LoginPage').then(m => ({ default: m.LoginPage })))
const OperationsLogin = lazy(() => import('./pages/auth/OperationsLogin').then(m => ({ default: m.OperationsLogin })))
const SuperAdminLogin = lazy(() => import('./pages/auth/SuperAdminLogin').then(m => ({ default: m.SuperAdminLogin })))
const SuperAdminDashboard = lazy(() =>
  import('./pages/super-admin/SuperAdminDashboard').then(m => ({ default: m.SuperAdminDashboard }))
)
const OnboardingPage = lazy(() => import('./pages/citizen/OnboardingPage').then(m => ({ default: m.OnboardingPage })))
const CitizenNotificationsPage = lazy(() =>
  import('./pages/citizen/CitizenNotificationsPage').then(m => ({ default: m.CitizenNotificationsPage }))
)
const CitizenFeedbackPage = lazy(() =>
  import('./pages/citizen/CitizenFeedbackPage').then(m => ({ default: m.CitizenFeedbackPage }))
)
const CitizenFeedbackDetailPage = lazy(() =>
  import('./pages/citizen/CitizenFeedbackDetailPage').then(m => ({ default: m.CitizenFeedbackDetailPage }))
)
const CitizenDashboard = lazy(() =>
  import('./pages/citizen/CitizenDashboard').then(m => ({ default: m.CitizenDashboard }))
)
const ServiceFormPage = lazy(() =>
  import('./pages/services/ServiceFormPage').then(m => ({ default: m.ServiceFormPage }))
)
const ApplicationPage = lazy(() =>
  import('./pages/citizen/ApplicationPage').then(m => ({ default: m.ApplicationPage }))
)
const EmployeeDashboard = lazy(() =>
  import('./pages/employee/EmployeeDashboard').then(m => ({ default: m.EmployeeDashboard }))
)
const OperationsCenter = lazy(() =>
  import('./pages/operations/OperationsCenter').then(m => ({ default: m.OperationsCenter }))
)
const GovernorDashboard = lazy(() =>
  import('./pages/operations/GovernorDashboard').then(m => ({ default: m.GovernorDashboard }))
)
const VerifyScanner = lazy(() => import('./pages/verify/VerifyScanner').then(m => ({ default: m.VerifyScanner })))
const VerifyPage = lazy(() => import('./pages/verify/VerifyPage').then(m => ({ default: m.VerifyPage })))

function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/directory" component={GovernmentDirectoryPage} />
        <Route path="/government-services/:id">{params => <GovernmentServiceDetailPage id={params.id} />}</Route>
        <Route path="/login" component={LoginPage} />
        <Route path="/operations/login" component={OperationsLogin} />
        <Route path="/super-admin/login" component={SuperAdminLogin} />
        <Route path="/super-admin">
          <SessionGate role="SUPER_ADMIN">
            <SuperAdminDashboard />
          </SessionGate>
        </Route>
        <Route path="/onboarding" component={OnboardingPage} />
        <Route path="/citizen/notifications">
          <SessionGate role="CITIZEN">
            <CitizenNotificationsPage />
          </SessionGate>
        </Route>
        <Route path="/citizen/feedback">
          <SessionGate role="CITIZEN">
            <CitizenFeedbackPage />
          </SessionGate>
        </Route>
        <Route path="/citizen/feedback/:reference">
          {params => (
            <SessionGate role="CITIZEN">
              <CitizenFeedbackDetailPage reference={params.reference} />
            </SessionGate>
          )}
        </Route>
        <Route path="/citizen">
          <SessionGate role="CITIZEN">
            <CitizenDashboard />
          </SessionGate>
        </Route>
        <Route path="/service/:key">{params => <ServiceFormPage serviceKey={params.key} />}</Route>
        <Route path="/citizen/application/:reference">
          {params => <ApplicationPage reference={params.reference} />}
        </Route>
        <Route path="/employee" component={EmployeeDashboard} />
        <Route path="/operations">
          <SessionGate role="OPERATIONS">
            <OperationsCenter />
          </SessionGate>
        </Route>
        <Route path="/governor">
          <SessionGate role="OPERATIONS">
            <GovernorDashboard />
          </SessionGate>
        </Route>
        <Route path="/verify" component={VerifyScanner} />
        <Route path="/verify/:id">{params => <VerifyPage verificationId={params.id} />}</Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  )
}

export default App
