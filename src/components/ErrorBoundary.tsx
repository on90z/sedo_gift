import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'Unexpected error occurred',
    };
  }

  componentDidCatch(error: Error): void {
    console.error('Application ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#5E1D2F] text-white flex items-center justify-center p-6">
          <div className="max-w-md w-full border border-[#944A5E] bg-[#6E2438] p-8 text-center space-y-4">
            <h2 className="text-2xl font-bold text-white">SEDO — تنبيه النظام</h2>
            <p className="text-sm text-white/80">
              حدث خطأ غير متوقع أثناء عرض الصفحة. يرجى إعادة المحاولة.
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, errorMessage: '' })}
              className="px-6 py-2.5 bg-[#0E0A0C] border border-[#944A5E] text-white text-sm font-medium hover:bg-[#1E1418] transition-colors"
            >
              إعادة التحميل
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
