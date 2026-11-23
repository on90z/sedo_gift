import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Google Maps Platform Demo Key Quota Detection (Case A)
declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

window.gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded', { detail: 'gm_authFailure' }));
};

const origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  origConsoleError(...args);
  const text = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : ''))
    .join(' ');
  if (
    text.includes('OverQuotaMapError') ||
    text.includes('QuotaExceededError') ||
    (text.includes('maps.googleapis.com') && text.toLowerCase().includes('quota'))
  ) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded', { detail: text }));
  }
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
