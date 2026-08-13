---
name: user-akhil-learning-state
description: "Akhil's actual skill profile — strong at flow/behaviour design, near-zero at code mechanics; how to work with him"
metadata: 
  node_type: memory
  type: user
  originSessionId: bbf616b5-f0ba-4a2e-924b-0f66aa80dabe
  modified: 2026-08-10T12:17:08.829Z
---

Akhil is a student (FFSD is a **3-semester** course; he finished 2'2 and started **3'1 in Aug 2026**). He built PlayCarys, GamepadOS and his internship work almost entirely through Claude, and on 2026-08-10 said plainly: *"i don't actually know anything about code how, what, why, what works in the platform."* He and his project teammates vibe-coded 2'2 together; none of them knows the code.

**Concrete evidence of the gap:** his lecturer asked him *"what is a server and how do you start it"* and he could not answer. The lecturer is now teaching middleware, which his own project already uses (`RolesGuard`). He does not know what UI/UX stand for. He says he is bad at reading technical terms.

**What he is genuinely good at — do not patronise him about this:**
- **Flow and behaviour design.** He drafts the flows himself in plain English, then has Claude implement them. Asked to describe the device-handoff login flow from memory, he got it completely right including the fallback branch.
- **Behavioural debugging.** The 2026-08-10 GamepadOS VPN bug report — "app shows disconnected, PC shows connected, everything works" — plus having already tested both Wi-Fi and USB, is what made the diagnosis possible.
- **Chained reasoning when the question is behavioural.** Asked what stops a password thief using the handoff fallback, he not only answered correctly but volunteered the escalation nobody prompted (no forgot-password flow + in-account password change = permanent lockout). That is a genuine security finding in his own project.

**Diagnosis: the split is not "smart vs not". It is behaviour-level (strong) vs code-level (absent).** He can reason about systems he can observe. He cannot yet read or explain the code that implements them, or the vocabulary around it.

**How to work with him:**
- **Explain before implementing**, not after. He has asked for this himself.
- **Plain words. Introduce one term at a time, only when it earns its place.** No jargon dumps.
- Ask behaviour-level questions first — that is where his real understanding lives, and it is the bridge to the code.
- Quiz mode works: he answers honestly, says "I don't know" without ego, and reasons well when the question is framed around observable behaviour.
- Give the short answer immediately after a wrong/blank answer, then move on — do not lecture.
- He explicitly asked to be told bluntly if his AI use has stopped being learning. Tell him the truth, tied to evidence, without theatrics in either direction.

See [[project-playcarys-hillclimb]] for the Review-4 status and the security hole he found.
