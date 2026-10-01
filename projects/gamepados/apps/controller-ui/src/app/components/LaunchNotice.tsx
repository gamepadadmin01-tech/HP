import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { requestDashboardTab } from "../store/navIntent";
import { KEYS, readJson, writeJson } from "../store/storage";
import { getAppInfo } from "../platform/native";

// v2 (2026-10-01): the time rules changed, so everyone sees the new wording once.
const NOTICE_ID = "guest-intro-v2";

export function LaunchNotice() {
  const [visible] = useState(() => readJson<string>(KEYS.noticeDismissed, "") !== NOTICE_ID);
  useEffect(() => {
    if (visible) writeJson(KEYS.noticeDismissed, NOTICE_ID);
  }, [visible]);
  if (!visible) return null;
  return <motion.section className="calm-launch-notice" data-testid="first-launch-intro" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
    <div>
      <span className="console-eyebrow">WELCOME TO YOUR NEW CONTROLLER</span><h2>Less hardware. More possibility.</h2>
      <p>Start with 30 free minutes, no account needed. Want more? Watch a short ad for 30 more minutes whenever you have under an hour left.</p>
      {/* The Play build sells nothing -- "plans" would point at nothing there. */}
      <button onClick={() => requestDashboardTab("account")}>{getAppInfo().channel === "playstore" ? "See your time" : "Explore plans"}</button>
    </div>
  </motion.section>;
}
