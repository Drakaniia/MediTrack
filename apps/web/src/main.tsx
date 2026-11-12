import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createAppRouter } from "@/app/router";
import { createQueryClient } from "@/lib/query-client";

import "./index.css";

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element #app not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
