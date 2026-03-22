import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "./App";
import "./styles.css";

const convex = new ConvexReactClient(
  import.meta.env["VITE_CONVEX_URL"] ?? "http://localhost:3210"
);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing root element");
createRoot(rootEl).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </StrictMode>
);
