"use client";

// If the screen throws, the adjuster sees a manual-triage fallback with the
// claim list, never a blank page. Copied in spirit from the earlier prototype.

import React from "react";

interface Props {
  fallback: (error: Error, reset: () => void) => React.ReactNode;
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return this.props.fallback(this.state.error, () => this.setState({ error: null }));
    return this.props.children;
  }
}
