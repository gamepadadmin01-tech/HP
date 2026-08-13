---
name: brand-voice-email-no-personal-name
description: "Outgoing user-facing email/messages must NEVER mention Akhil's name — sign as GamepadOS (brand only)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 25081129-704a-46c9-a8a9-82b6139dcec6
---

All outward-facing communication for GamepadOS (broadcast emails, ticket replies, store listings, social posts, any drafted message body) must **never mention the user's personal name (Akhil)** — no "Akhil — GamepadOS" sign-offs, no "from Akhil". Sign as **"GamepadOS"** or the existing "— GamepadOS Support" sender signature only.

**Why:** User mandate 2026-07-16 ("never mention my name anywhere"), after the first mailing-list broadcast went out signed "Akhil — GamepadOS".

**How to apply:** When drafting any email/message body, end with "GamepadOS" (the server's broadcast mechanism already appends "— GamepadOS Support" via SENDER_NAME). The backend templates in [[downloads-feedback-platform]]'s server.js are already brand-only (audited 2026-07-16) — keep them that way; the risk surface is drafted content, not code.
