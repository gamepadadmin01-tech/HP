import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { requestDashboardTab } from "../store/navIntent";
import { KEYS, readJson, writeJson } from "../store/storage";

const NOTICE_ID = "guest-intro-v1";

export function LaunchNotice() {
  const [visible] = useState(() => readJson<string>(KEYS.noticeDismissed, "") !== NOTICE_ID);
  useEffect(() => {
    if (visible) writeJson(KEYS.noticeDismissed, NOTICE_ID);
  }, [visible]);
  if (!visible) return null;
  return <motion.section className="calm-launch-notice" data-testid="first-launch-intro" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
    <div>
      <span className="console-eyebrow">WELCOME TO YOUR NEW CONTROLLER</span><h2>Less hardware. More possibility.</h2>
      <p>Guests get 30 minutes of controller time every day on this device. No account needed. Your account's plan applies when signed in.</p>
      <button onClick={() => requestDashboardTab("account")}>Explore plans</button>
    </div>
  </motion.section>;
}
