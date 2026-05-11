import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

const Landing              = lazy(() => import('./pages/Landing.jsx'));
const Profiling            = lazy(() => import('./pages/Profiling.jsx'));
const Diagnostic           = lazy(() => import('./pages/Diagnostic.jsx'));
const Dashboard            = lazy(() => import('./pages/Dashboard.jsx'));
const Session              = lazy(() => import('./pages/Session.jsx'));
const Report               = lazy(() => import('./pages/Report.jsx'));
const SimulationLab        = lazy(() => import('./pages/SimulationLab.jsx'));
const CareerTwin           = lazy(() => import('./pages/CareerTwin.jsx'));
const ExplainabilityConsole = lazy(() => import('./pages/ExplainabilityConsole.jsx'));
const DemoMode             = lazy(() => import('./pages/DemoMode.jsx'));
const InterviewSimulator   = lazy(() => import('./pages/InterviewSimulator.jsx'));

const Loader = () => (
  <div className="mx-auto max-w-4xl px-6 py-14 text-slate-400 text-center">
    <div className="animate-spin text-indigo-400 text-3xl mb-3">⟳</div>
    <div className="text-sm">Loading...</div>
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <div className="min-h-screen bg-[#0F172A] text-[#F8FAFC]">
          <Navbar />
          <Suspense fallback={<Loader />}>
            <Routes>
              <Route path="/"             element={<Landing />} />
              <Route path="/profiling"    element={<Profiling />} />
              <Route path="/diagnostic"   element={<Diagnostic />} />
              <Route path="/dashboard"    element={<Dashboard />} />
              <Route path="/session/:day" element={<Session />} />
              <Route path="/report"       element={<Report />} />
              {/* Frontier Pages */}
              <Route path="/simulation"   element={<SimulationLab />} />
              <Route path="/career-twin"  element={<CareerTwin />} />
              <Route path="/explain"      element={<ExplainabilityConsole />} />
              <Route path="/demo"         element={<DemoMode />} />
              <Route path="/interview"    element={<InterviewSimulator />} />
            </Routes>
          </Suspense>
        </div>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
