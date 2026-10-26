// TUTOR MOBILE HARNESS — mounts the REAL Tutor page with stubbed backend.
// Used only for browser-level responsive verification (320-430px).

import "@/i18n";
import "@/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AppBootstrapProvider } from "@/components/AppBootstrap";
import Tutor from "@/pages/Tutor";

function Harness() {
  return (
    <AppBootstrapProvider>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/tutor"]}>
          <Routes>
            <Route path="*" element={<Tutor />} />
          </Routes>
          <Toaster position="top-center" />
        </MemoryRouter>
      </ThemeProvider>
    </AppBootstrapProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
