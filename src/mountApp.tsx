import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/assets/main.css";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SessionProvider } from "@/hooks/session";
import { App } from "@/entrypoints/popup/App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    // Never auto-retry exchange actions: a retried order is a second order.
    mutations: { retry: false },
  },
});

// Shared by the toolbar popup and the side panel; <html data-surface> picks the
// fixed 380x600 popup size or the full-height panel layout in main.css.
export function mountApp() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <SessionProvider>
            <App />
          </SessionProvider>
        </ErrorBoundary>
      </QueryClientProvider>
    </StrictMode>,
  );
}
