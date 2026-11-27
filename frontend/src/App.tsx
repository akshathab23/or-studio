import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { StudioProvider } from './context/StudioContext';
import { DashboardPage } from './pages/DashboardPage';
import { DatasetExplorerPage } from './pages/DatasetExplorerPage';
import { GoalProgrammingPage } from './pages/GoalProgrammingPage';
import { MCDMPage } from './pages/MCDMPage';
import { MultiPeriodPage } from './pages/MultiPeriodPage';
import { RecommendationPage } from './pages/RecommendationPage';
import { ScenariosPage } from './pages/ScenariosPage';
import { SensitivityPage } from './pages/SensitivityPage';
import { SolutionHistoryPage } from './pages/SolutionHistoryPage';
import { TradeoffExplorerPage } from './pages/TradeoffExplorerPage';
import { WhatIfLabPage } from './pages/WhatIfLabPage';

const RouteErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <ErrorBoundary
      resetKey={location.pathname}
      onNavigateHome={() => navigate('/')}
    >
      {children}
    </ErrorBoundary>
  );
};

export const App: React.FC = () => {
  return (
    <StudioProvider>
      <BrowserRouter>
        <Layout>
          <RouteErrorBoundary>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/multi-period" element={<MultiPeriodPage />} />
              <Route path="/goal-programming" element={<GoalProgrammingPage />} />
              <Route path="/mcdm" element={<MCDMPage />} />
              <Route path="/datasets" element={<DatasetExplorerPage />} />
              <Route path="/history" element={<SolutionHistoryPage />} />
              <Route path="/what-if" element={<WhatIfLabPage />} />
              <Route path="/sensitivity" element={<SensitivityPage />} />
              <Route path="/trade-offs" element={<TradeoffExplorerPage />} />
              <Route path="/recommendations" element={<RecommendationPage />} />
              <Route path="/scenarios" element={<ScenariosPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </RouteErrorBoundary>
        </Layout>
      </BrowserRouter>
    </StudioProvider>
  );
};

export default App;
