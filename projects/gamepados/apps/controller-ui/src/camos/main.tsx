import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import CamOSApp from "./CamOSApp";
import "../styles/index.css";
import "./camos.css";

// CamOS entry. Built with `npm run build:camos` into dist-camos/camos.html, which is copied to
// apps/camos-android/app/src/main/assets/dist/index.html.
createRoot(document.getElementById("root")!).render(<MotionConfig reducedMotion="user"><CamOSApp /></MotionConfig>);
