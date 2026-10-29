import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/assets/main.css";
import { SessionProvider } from "@/hooks/session";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    // Never auto-retry exchange actions: a retried order is a second order.
    mutations: { retry: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
