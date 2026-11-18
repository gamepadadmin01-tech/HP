import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import { migrate } from "./app/store/storage";
import { MotionConfig } from "framer-motion";
import { applyThemeVariant } from "./app/themeVariant";
import { startScreenTranslation } from "./app/i18n/dom";

// Bring stored data up to the current schema before anything reads it. React's
// useState initialisers run during the first render, so this has to happen
// here — not in a component effect, which would fire after they had already
// read the old shape.
migrate();

applyThemeVariant();
// 2.1: every screen shows in the chosen language (i18n/dom.ts). Started before the first render, so no English
// flashes up on a translated phone.
startScreenTranslation(document.body);   // the body, not #root: pop-ups are portalled to the body
createRoot(document.getElementById("root")!).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);
