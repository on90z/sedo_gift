import { Component, type ErrorInfo, type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

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

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message || 'حدث خطأ غير متوقع' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    origConsoleError('UI Error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen bg-[#5E1D2F] text-white flex items-center justify-center p-6"
        >
          <div className="max-w-md w-full rounded-2xl bg-[#461221] border border-white/20 p-6 text-center space-y-4">
            <h1 className="text-xl font-bold">تعذّر عرض الصفحة</h1>
            <p className="text-sm text-white/80">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-[#0E0A0C] text-white font-medium border border-white/20 hover:bg-black transition"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
