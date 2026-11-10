import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from '../preview_compiled/components/ErrorBoundary';
import './index.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <ErrorBoundary panelName="Runs">
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
