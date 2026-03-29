import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { NetworkStatusProvider } from "./context/NetworkStatusContext.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/*
     * NetworkStatusProvider must be outside ErrorBoundary so the API event
     * listener is active even when the boundary is showing its fallback UI.
     * ErrorBoundary wraps App to catch any render errors inside the tree.
     */}
    <NetworkStatusProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </NetworkStatusProvider>
  </StrictMode>,
);
