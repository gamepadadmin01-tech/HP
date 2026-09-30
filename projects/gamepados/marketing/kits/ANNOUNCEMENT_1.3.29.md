# GamepadOS 1.3.29 — announcement copy

Everything that goes out with this release, in one place. **Nothing here has been
sent or published** — each block is a draft for you to paste and send yourself.

**The shape of the message, in order of importance:**

1. What got faster (this is the release; it is what earns the goodwill)
2. Plans are *coming*, not here — cheap, and the free hour stays free forever
3. Existing users get 24 hours of unlimited, tied to an **account**
4. Ask for feedback

**Two rules the copy follows.** No superlatives — "world's fastest" is an
unsubstantiated claim under Play policy and a competitor can demand proof, so the
measured figure is used instead: Phase 3 native input is **3.7× faster than the
previous engine, device-verified**. And nothing is signed with a personal name;
everything signs off as GamepadOS.

**One caveat on ordering.** Plans are described as *coming in a future update*
because that is what this build is: the notice ships one release ahead of the
limit, per `docs/research/BILLING_DECISIONS.md` §2.1. Do not reuse this copy for
the release that actually turns the limit on — it needs its own, and by then the
24-hour gift should already be granted.

---

## 1. In-app banner — ALREADY SHIPPING in this build

No action needed; this is in the APK. Recorded here so all the copy lives
together. It adapts: signed out it asks for an account, signed in it asks for
feedback, and once both are done it says so and stops asking.

> **A heads-up, and a thank-you**
> Plans are coming · 24h unlimited for you
>
> We've rebuilt the input path — this build is the fastest GamepadOS has been.
> To keep that work going, plans are coming in a future update. They'll be
> cheap, and **an hour of play every day stays free, forever**.
>
> Everyone already using GamepadOS gets 24 hours of unlimited playtime when that
> lands. It's tied to your account, so make one now — and tell us what you think
> while you're there.

---

## 2. Broadcast email

Send from the admin portal → 📣 Broadcast. **Read the recipient note below first.**

> ⚠️ **Who this reaches.** The portal's contacts come from support tickets, so
> many recipients will never have made an account — which is exactly the group
> the gift would otherwise miss. The copy therefore explains the account rather
> than assuming one. Do not send it to a list you have not checked; there is no
> unsend.

**Subject**

```
GamepadOS just got faster — and there's something for you
```

**Body**

```
Hi,

A new GamepadOS build is out, and it's the fastest one yet.

We rewrote the part that matters most: the path from your thumb to the game.
The new native input engine measures 3.7x faster than the one it replaces —
tested on real devices, not in a benchmark. Lower latency, and steadier when
your Wi-Fi isn't perfect.

That work takes time, and time has to be paid for. So we want to be upfront:
plans are coming to GamepadOS in a future update. They'll be cheap, and an
hour of play every day stays free, forever — enough for a real session, not a
demo. Nothing changes today.

And because you were here before any of this existed: when plans arrive,
you'll get 24 hours of unlimited playtime, free.

There's one thing to do to make sure it reaches you. The gift is tied to your
GamepadOS account, so if you haven't made one yet, open the app and create it
now — it takes a moment. While you're in there, tell us how the app has been
for you. We read everything, and it genuinely shapes what we build next.

Update the app, make your account, and enjoy your time.

— GamepadOS
gamepad.space
```

**If you would rather send something shorter**, this works on its own:

```
Hi,

A faster GamepadOS is out — the new input engine measures 3.7x quicker than
the last one, verified on real devices.

Plans are coming in a future update. They'll be cheap, and an hour of play a
day stays free forever. Nothing changes today.

You were here early, so you get 24 hours of unlimited playtime when that
lands. It's tied to your account — open the app and make one if you haven't,
and send us your feedback while you're there.

— GamepadOS
```

---

## 3. Google Play — "What's new"

Play truncates around 500 characters in the collapsed view, so the important
half is first.

```
Faster, end to end.

We rebuilt the input path — measured 3.7x faster than the previous engine on
real hardware. Lower latency, steadier under load.

Plans are coming to GamepadOS in a future update. They'll be cheap, and an
hour of play every day stays free, forever. Nothing changes in this build.

Already using GamepadOS? You'll get 24 hours of unlimited playtime when plans
arrive — it's tied to your account, so make one in the app if you haven't.

Tell us what you think from Account → Support.
```

> **Play only:** never render our own price next to a Play SKU — the
> authoritative price lives in Play Console and the app reads it from
> ProductDetails at runtime. This text names no prices, deliberately.

---

## 4. Website announcement

For the site — longer, because people arrive here deliberately.

**Heading**

```
Faster, end to end
```

**Body**

```
We rewrote the part that matters most — the path from your thumb to the game.
Native input, measured at 3.7x faster than the engine it replaces, verified on
real devices rather than in a benchmark.

Why we're mentioning plans

That work takes time, and time has to be paid for. So this release also comes
with a heads-up: plans are coming to GamepadOS. We've tried to make them the
least annoying version of that idea — an hour of play every day, free, forever.
Enough for a real session, not a demo. If you want more, it starts at ₹19, and
unlimited forever is ₹400. Buy once, own it.

Nothing changes in this build. The limit arrives in a later update, and you'll
see it coming.

For everyone already here

You started using GamepadOS before any of this existed, and it feels wrong to
hand you a limit without handing you something first. Every existing account
gets 24 hours of unlimited playtime when plans arrive. No code, nothing to
claim — it'll be there when you open the app.

Make sure you have an account so it can find you. Enjoy your time.
```

---

## Before any of this goes out

- [ ] Release APK built from current source and installed on a real device
      (`app-direct-release.apk`, signed with `release.keystore`)
- [ ] The billing backend is **deployed** — production currently 404s on
      `/api/billing/*`, so the Account tab shows an error rather than a plan
- [ ] `grant-launch-bonus.js` has been dry-run against production and the
      eligible count looks right
- [ ] Recipient list for the broadcast checked by eye. There is no unsend.
