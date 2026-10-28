import React from "react";

// Last-resort safety net: a render crash anywhere below shows a recoverable
// screen instead of a blank page. Self-contained (inline styles, no i18n or
// app imports) so it still works if the thing that crashed is a shared module.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    console.error("Unhandled render error:", error, info?.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 10px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.5, color: "#475569" }}>
            The page hit an unexpected problem. Reloading usually fixes it, and nothing you have already saved is lost.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ background: "#2563eb", color: "#fff", border: 0, borderRadius: 8, padding: "11px 22px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

