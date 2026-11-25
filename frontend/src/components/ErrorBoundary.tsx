import { AlertTriangle, RotateCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

/** Shows a friendly message instead of a blank screen if a page crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("Page crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card m-4 flex flex-col items-center px-6 py-14 text-center">
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-surface-2">
          <AlertTriangle size={22} className="text-bad" />
        </div>
        <h2 className="font-semibold">This page couldn't be displayed</h2>
        <p className="mt-1 max-w-sm text-[13px] text-ink-2">
          The site may have just been updated. Reloading usually fixes it.
        </p>
        <code className="mt-3 max-w-lg break-words rounded-lg bg-surface-2 px-3 py-2 text-left text-[11px] text-muted">
          {this.state.error.message}
        </code>
        <button className="btn-primary mt-5" onClick={() => window.location.reload()}>
          <RotateCw size={15} /> Reload
        </button>
      </div>
    );
  }
}
