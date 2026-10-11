import { Component, type ReactNode } from "react";
import { ErrorNotice } from "./ErrorNotice";

/** A render crash must show a message, never a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[rienda] render error", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorNotice error={this.state.error} title="Something went wrong on this page." onRetry={() => this.setState({ error: null })} />;
  }
}
