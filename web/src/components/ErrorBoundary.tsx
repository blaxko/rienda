import { Component, type ReactNode } from "react";

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
    return (
      <div className="banner banner-red" role="alert" style={{ margin: 16, borderRadius: 10 }}>
        <strong>Something went wrong on this page.</strong>
        <div className="mono" style={{ margin: "6px 0", overflowWrap: "anywhere" }}>{this.state.error.message}</div>
        <button onClick={() => { this.setState({ error: null }); }}>Try again</button>
      </div>
    );
  }
}
