import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logAppError } from '../lib/logger';
import { AlertTriangle, RefreshCw, Home, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
  copied: boolean;
}

export class GlobalErrorBoundary extends React.Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
    copied: false
  };

  constructor(props: Props) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('Unhandled UI Exception caught by GlobalErrorBoundary:', error, errorInfo);

    // Send error report directly to Firestore errors subcollection
    logAppError(error, {
      componentStack: errorInfo.componentStack || undefined,
      url: typeof window !== 'undefined' ? window.location.href : undefined
    }).catch(err => {
      console.warn('Failed to dispatch error report to Firestore:', err);
    });
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (typeof window !== 'undefined') {
      window.location.hash = '';
    }
  };

  handleCopyDetails = () => {
    const { error, errorInfo } = this.state;
    const details = `Error: ${error?.message || 'Unknown error'}\n\nStack:\n${error?.stack || 'No stack'}\n\nComponent Stack:\n${errorInfo?.componentStack || 'No component stack'}`;
    navigator.clipboard.writeText(details).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, errorInfo, showDetails, copied } = this.state;

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6 font-sans">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="bg-red-50 p-6 border-b border-red-100 flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0 shadow-sm">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h1 className="text-xl font-bold text-slate-800">
                  เกิดข้อผิดพลาดในการแสดงผลระบบ (Application Error)
                </h1>
                <p className="text-sm text-slate-600 leading-relaxed">
                  ระบบได้บันทึกรายงานข้อผิดพลาดนี้เข้าสู่ฐานข้อมูลระบบเรียบร้อยแล้ว ท่านสามารถรีเฟรชหน้าเว็บหรือกลับสู่หน้าหลักเพื่อใช้งานต่อ
                </p>
              </div>
            </div>

            {/* Error Message Box */}
            <div className="p-6 space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  ข้อความข้อผิดพลาด (Error Message)
                </div>
                <div className="text-sm font-mono text-red-600 break-words font-medium">
                  {error?.message || 'Unknown Application Error'}
                </div>
              </div>

              {/* Collapsible Details */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => this.setState({ showDetails: !showDetails })}
                  className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-semibold text-slate-700 transition-colors"
                >
                  <span>รายละเอียดเชิงเทคนิค (Stack Trace & Components)</span>
                  {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showDetails && (
                  <div className="p-4 bg-slate-900 text-slate-200 text-xs font-mono overflow-x-auto space-y-3 max-h-72">
                    <div className="flex justify-end">
                      <button
                        onClick={this.handleCopyDetails}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded border border-slate-700 transition-colors"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อมูล Error'}
                      </button>
                    </div>

                    {error?.stack && (
                      <div>
                        <div className="text-slate-400 text-[11px] mb-1 font-bold">Error Stack:</div>
                        <pre className="whitespace-pre-wrap leading-relaxed">{error.stack}</pre>
                      </div>
                    )}

                    {errorInfo?.componentStack && (
                      <div>
                        <div className="text-slate-400 text-[11px] mb-1 font-bold">Component Stack:</div>
                        <pre className="whitespace-pre-wrap leading-relaxed">{errorInfo.componentStack}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
                <button
                  onClick={this.handleReset}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition-colors"
                >
                  <Home className="w-4 h-4" />
                  กลับสู่หน้าเริ่มต้น
                </button>

                <button
                  onClick={this.handleReload}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-md shadow-blue-200 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  รีเฟรชหน้าเว็บ (Reload)
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
