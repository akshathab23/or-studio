import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { StudioProvider } from './context/StudioContext';
import { DashboardPage } from './pages/DashboardPage';
import { DatasetExplorerPage } from './pages/DatasetExplorerPage';
import { GoalProgrammingPage } from './pages/GoalProgrammingPage';
import { MCDMPage } from './pages/MCDMPage';
import { MultiPeriodPage } from './pages/MultiPeriodPage';
import { ScenariosPage } from './pages/ScenariosPage';
import { SolutionHistoryPage } from './pages/SolutionHistoryPage';
import { WhatIfLabPage } from './pages/WhatIfLabPage';

export const App: React.FC = () => {
  return (
    <StudioProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/multi-period" element={<MultiPeriodPage />} />
            <Route path="/goal-programming" element={<GoalProgrammingPage />} />
            <Route path="/mcdm" element={<MCDMPage />} />
            <Route path="/datasets" element={<DatasetExplorerPage />} />
            <Route path="/history" element={<SolutionHistoryPage />} />
            <Route path="/what-if" element={<WhatIfLabPage />} />
            <Route path="/scenarios" element={<ScenariosPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </StudioProvider>
  );
};

export default App;
