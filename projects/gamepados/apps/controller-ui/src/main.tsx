import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import { migrate } from "./app/store/storage";

// Bring stored data up to the current schema before anything reads it. React's
// useState initialisers run during the first render, so this has to happen
// here — not in a component effect, which would fire after they had already
// read the old shape.
migrate();

createRoot(document.getElementById("root")!).render(<App />);
