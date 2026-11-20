import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Ocurrió un error inesperado en la interfaz.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary capturó un error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">
                  Se detuvo la renderización por un error de datos o permisos
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Revisa tu conexión o recarga la vista para restablecer el panel de monitoreo.
                </p>
              </div>
            </div>
            <pre className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-700 overflow-x-auto whitespace-pre-wrap break-all">
              {this.state.errorMessage}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Recargar panel
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
