import { Component, type ReactNode } from "react";
import { Button, Notice } from "./ui";

// Without this, any render error unmounts the whole popup to a blank page.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col justify-center gap-3 p-6">
        <Notice tone="error">{this.state.error.message}</Notice>
        <Button onClick={() => location.reload()}>Reload</Button>
      </div>
    );
  }
}
