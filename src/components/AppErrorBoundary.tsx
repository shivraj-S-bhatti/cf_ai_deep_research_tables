import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { Button } from "@/components/ui/button";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("AppErrorBoundary caught render error", error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleGoHome = (): void => {
    window.location.assign("/");
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="min-h-dvh flex items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold tracking-tight">Workspace crashed</h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            A render error interrupted the current view. Reload the app or return home.
          </p>
          <div className="mt-4 flex gap-2">
            <Button type="button" onClick={this.handleReload}>
              Reload app
            </Button>
            <Button type="button" variant="outline" onClick={this.handleGoHome}>
              Go home
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
