# GamepadOS app: every English text on screen (2.1 translation, step 1)

First automatic pass, 506 texts, 2026-11-18. Some lines are not really on screen (internal words the scan caught); they get removed before translation.

## Home, layouts, controller top bar (App.tsx, 107)

- 0 && indAbs
- (v.h || []), stdHeld: new Set
- ← BACK
- GYRO
- Idle
- CALIBRATE
- ROTATE
- No buttons — edit this pad in Dashboard
- ), home:
- , menu:
- Empty layout
- Edit
- Duplicate
- Share
- Delete
- Cancel
- Your layouts
- pad ?
- Create a layout
- Uploading your layout...
- Anyone can load this controller in
- New Layout, Import from Code
- using:
- Copy code
- Submit feedback
- Contact us
- Thanks! Your feedback was sent ✓
- We'll reply to your email if it needs a response.
- Done
- Send feedback
- 0 && !emailOk &&
- Enter a valid email
- gamepad.space
- Check for updates
- USB detected
- LOADING
- Share controller layout
- Close
- Your email
- Feedback message
- Tell us what's on your mind…
- Play
- Settings
- Account
- Main navigation
- Standard Controller
- Full-size wireless controller layout
- Standard Racing Controller
- Racing layout: brake, throttle and steering stick
- FPS Pro Layout
- Fighter Arcade
- Racing Layout
- RPG Adventure
- Blank Canvas
- My Custom Pad
- : (up.startsWith(
- , std: true, hap: tier(STD_BTN_HAPTIC[isLeft ?
- [usbWS] worker init failed:
- Guest
- Native sendGamepadPacket failed:
- native input activate failed
- top left
- 1px solid rgba(255,255,255,0.08)
- right center
- left center
- 1px solid rgba(255,255,255,0.12)
- 1px solid rgba(224,160,48,0.45)
- 1px solid rgba(255,255,255,0.14)
- ) : up.startsWith(
- xMidYMid meet
- Couldn't share this pad.
- Couldn't reach the server. Check your connection.
- App User
- Server error — please try again.
- No connection — check your internet.
- 1px solid var(--calm-line, #343c3f)
- 1px solid rgba(255,255,255,0.1)
- 2px auto 14px
- 1px solid rgba(255,104,38,0.35)
- Write at least 10 characters
- Message looks good
- A new version is ready on Google Play.
- Opening installer…
- Update failed.
- Permission needed — tap Update again.
- Update failed · tap to try again
- Allow installs, then tap again
- Update available
- Retry update
- Download & install update
- Update via Google Play
- Update via store
- Checking for updates…
- You're on the latest version.
- Couldn't check right now. Try again shortly.
- Couldn't check right now — check your connection.
- Escape
- No layout found for that code.
- Imported Pad
- Couldn't reach the server. Check your connection and try again.
- Open your profile
- Sign in to GamepadOS
- Time
- Plans
- Failed to save custom pads — storage refused the write
- 1px solid rgba(251,191,36,0.4)
- 'Space Grotesk',sans-serif

## Connect to PC (CalmConnect.tsx, 39)

- Make the connection.
- Wi-Fi
- USB
- Keep your phone and PC on the same Wi-Fi network.
- Get the PC server
- Scan PC QR code
- Enter the IP address and pairing key shown below your PC’s QR code. Keep port 7777 unless your PC shows a different port.
- PC IP address
- Port
- Pairing key
- Connect
- Enable USB debugging in Developer options and approve your PC's authorization prompt. Auto can use this connection when tethering is unavailable.
- In your phone's About screen, tap Build number seven times, then return to Settings and open Developer options.
- Back to Play
- Connection method
- 8 characters from your PC
- USB connection mode
- Enter a valid PC IPv4 address and a port from 1 to 65535.
- Enter the 8-character pairing key shown on your PC.
- Manual connection is available in the Android app.
- Open GamepadServer
- Scan the code on your PC
- The code appears in the GamepadServer window. Point your phone camera at it to pair.
- Auto
- Tethering
- Debugging
- Auto prefers USB tethering and can fall back to USB debugging.
- Use your phone's USB tethering connection.
- Use the USB debugging connection to your PC.
- Connect a USB data cable
- Plug your phone into your PC and open GamepadServer.
- Allow USB debugging
- On your phone, open Developer options and enable USB debugging. Approve your PC when the authorization prompt appears.
- Turn on USB tethering
- On your phone, look under Settings → Hotspot & tethering → USB tethering. The setting name may vary by phone.
- Wait for the connection
- GamepadOS connects automatically when the selected USB connection and PC server are ready.
- Using USB debugging instead?
- Can't find Developer options?

## Account (TabAccount.tsx, 38)

- Sign in for unlimited time ·
- Already have an account?
- Your plan and profile
- My layouts
- Cloud backup
- Sign out
- Your layouts stay on this phone. Sign in again any time.
- Delete account
- Delete this account permanently?
- Layouts saved on this phone are kept
- — the app keeps working without an account.
- Keep my account
- Test rumble
- Privacy policy
- Controller library
- Backup
- Rumble
- Session
- Danger zone
- Auto backup
- Confirm your password
- Support
- None yet — create one from Play.
- Backing up…
- Not backed up yet
- Automatic backup is off
- gp-spin 900ms linear infinite
- Sync now
- just now
- 1px solid rgba(224,87,79,0.30)
- Signing out…
- Could not delete the account.
- 1px solid rgba(224,87,79,0.25)
- 1px solid rgba(224,87,79,0.35)
- Delete forever
- Rumble off
- Not supported
- Tap to test

## Sign in / sign up (AccountAuth.tsx, 35)

- YOUR PLAYER PROFILE
- Back to sign in
- Display name
- Email address
- 6-digit email code
- Forgot your password?
- Create an account
- Didn’t get it? Send a new code
- Already have an account? Sign in
- Continue with Google
- Couldn't open Google sign-in. Try again.
- If that email has an account, a reset code is on its way.
- Password changed. Sign in with your new password.
- Confirm your email to finish setting up your account.
- Something went wrong.
- New code sent.
- Sign in
- Create your account
- Confirm your email
- Reset password
- Choose a new password
- Sign in to keep your controller layouts safe.
- Save your layouts and get them back on any phone.
- We'll email you a code to set a new password.
- Enter the code from your email and a new password.
- Password
- Hide password
- Show password
- Please wait…
- Create account
- Confirm email
- Send reset code
- Change password
- Sign up with Google
- Sign in with Google

## Welcome tour and rating pop-up (FeatureIntroOverlay.tsx, 25)

- How's GamepadOS playing?
- How does it feel to play? Tell us what works for you and what could feel better.
- Submit
- What went wrong?
- Tell us what to fix and it reaches the team directly. A short reason is needed, so we can actually fix it.
- Send
- Follow us on Instagram
- Tips, updates and new features first.
- Rate your GamepadOS experience
- Lag, a button that doesn't work, anything…
- 1px solid rgba(255,104,38,0.12)
- color 160ms ease, fill 160ms ease
- Tap a star
- 1px solid rgba(255,104,38,0.14)
- Thanks for the rating
- Thanks — message sent
- It genuinely helps a small team.
- We read every one and we'll get it fixed.
- Sends when you're back online.
- Something's badly broken
- Needs work
- It's okay
- Good
- Excellent
- 1px solid rgba(255,104,38,0.25)

## Plans (PlanPanel.tsx, 25)

- Checking your plan…
- 0 || onPlay) &&
- Lifetime
- Get it on Google Play
- Price shown by
- Active
- Have a code?
- Your plan
- Refresh plan
- Play without the limit
- That code could not be used.
- Promo code
- Free
- 3-Day Pass
- Quarterly
- Unlimited playtime
- Yours forever
- Unlimited
- Today
- Change plan
- Paid once through Google Play. Unlimited play starts right away and never expires.
- sign in
- sign in with this same account
- transform 400ms ease-out, background 200ms ease
- Buy with Google Play

## Notices from the portal (AppControl.tsx, 24)

- Sign in for unlimited time
- From GamepadOS
- Got it
- Notifications
- Nothing new right now. News from GamepadOS will show up here.
- Update GamepadOS
- Update required
- 0 24px 60px rgba(0,0,0,0.35)
- 8px auto 0
- Couldn't add free time. Try again in a moment.
- This version of the app can't add free time. Update to the latest version.
- You need an internet connection to get free time.
- 1px solid var(--calm-good)
- Needs internet
- Adding your free time…
- That was today's last free-time tap.
- Continue playing
- Notifications, 1 new
- Google Play
- Uptodown
- Aptoide
- Amazon Appstore
- Indus Appstore
- Download the update

## Settings (CalmSettings.tsx, 23)

- Browser preview · Live device readings are available in the Android app.
- Motion
- Lock-to-lock range
- Motion mode
- Racing
- 3D aim
- Aim
- Feel
- Your device
- Temperature
- Right stick sensitivity
- Right stick sensitivity presets
- Tilt steering
- Wheel mode
- Wheel range
- Steering sensitivity
- Ignore small tilts
- Tilt throttle
- Pause when laid flat
- App vibration
- Game rumble
- Normal 100%
- Unavailable

## Layout editor (CustomPadEditor.tsx, 21)

- Rectangular
- ) : !isCustomSize ? (
- Size
- Width
- Height
- Roundness
- Response
- Throttle
- Normal
- Save changes?
- You changed this layout. Save it before you leave the editor?
- Save and exit
- Discard
- Keep editing
- Add a button
- Exit layout editor
- Layout name
- Widget settings
- Delete button
- Enter
- Add widget

## Buying messages (purchase.ts, 18)

- The payment app sent something unreadable.
- The payment screen didn't come back.
- Could not start checkout.
- Payment could not be verified.
- The purchase could not be confirmed.
- Sign in to buy a plan.
- This build cannot take payments. Buy at gamepad.space instead.
- The payment was not completed.
- The payment app answered unexpectedly.
- Sign in to finish this purchase.
- Your payment is still being processed. It will appear once it completes.
- That plan is not available on Google Play yet.
- This version of the app cannot take payments. Update from Google Play.
- ) ? (d.stage as api.PlayAttempt[
- Nothing is sold in this version of the app.
- A purchase is already in progress.
- This build cannot sell plans.
- Plans cannot be bought in this version of the app.

## Editor: add a button (addItems.ts, 17)

- DPAD
- ABXY
- LS
- RS
- Hybrid
- Touchpad
- L-Mod
- R-Mod
- LB
- RB
- LT
- RT
- Left stick
- Right stick
- View
- Home
- Menu

## Pop-ups (Dialogs.tsx, 17)

- Scan. Pair. Play.
- Camera pairing is available in the Android app. Open GamepadServer on your PC, then scan its QR code with your phone.
- Back to connection options
- Align the PC Server QR Code within the frame
- Pairing…
- Pairing failed
- Rescan
- Close scanner
- Mock QR Scan Received:
- That QR code isn't a valid server code. Make sure the PC server window is showing its QR, then try again.
- Paired, but no response from the PC. Check that:\n
- • the PC server is running\n
- • phone and PC are on the same network\n
- • the phone is NOT plugged in by USB (that uses a different path)\n
- • Windows firewall isn't blocking it\n\nThen rescan.
- 1px solid rgba(255,104,38,0.2)
- 3px solid var(--calm-accent)

## Top bar and tabs (CalmShell.tsx, 16)

- See why?
- Usually one of these:
- OK
- You’re connected
- PC not replying
- Connection interrupted
- No PC connected
- Pair up. Power on.
- Manage PC connection
- Connect to PC
- Your membership
- Play time
- Your plan & playtime
- Get free time
- View account
- View plans

## Connection status words (linkState.ts, 15)

- Controller ready.
- Sending input, but the PC isn't answering. The controller may still work. Check a VPN or firewall on the PC — it can block replies while letting input through.
- The PC stopped answering. Check the server is still running.
- Not connected to a PC.
- The app is trying to reach your PC, but no reply has come back yet.
- GamepadOS Server isn't open on your PC. Open it and wait a few seconds.
- Your phone and PC are on different Wi-Fi networks, or the phone is on mobile data. Put both on the same Wi-Fi.
- The PC is asleep, or it restarted and the server didn't open. Wake the PC and open the server.
- Your Wi-Fi router gave the PC a new address. Scan the QR code on the PC again.
- A firewall, antivirus or VPN on the PC is blocking the replies. Allow GamepadOS Server, or turn the VPN off.
- Your PC was answering, then stopped.
- GamepadOS Server was closed. Open it again on your PC.
- The PC went to sleep or restarted. Wake it and open the server.
- The phone's Wi-Fi dropped, or it switched to mobile data or another network. Check the phone's Wi-Fi.
- The phone is too far from the Wi-Fi router. Move closer.

## Controller buttons (Widgets.tsx, 12)

- r 0.5s cubic-bezier(0.22,1,0.36,1), opacity 0.54s ease-out
- Btn: Pointer capture failed
- opacity 0.2s ease-out
- transform 0.16s cubic-bezier(0.22,0.61,0.36,1)
- stroke 0.16s ease-out, stroke-width 0.16s ease-out
- opacity 0.16s ease-out
- stroke-width 0.16s ease-out
- , down: dirIds?.down ||
- stroke 0.12s ease-out
- fill 0.16s ease-out
- RightStick: Pointer capture failed
- TriggerPill: Pointer capture failed

## account.ts (account.ts, 9)

- (path: string, body?: unknown, token?: string): Promise
- GamepadOS took too long to respond. Try again in a moment.
- Couldn't reach GamepadOS. Check your connection.
- You are not signed in.
- Google sign-in didn't work. Try again.
- Google sign-in was cancelled.
- Google says that email address isn't verified, so it can't be used.
- That sign-in took too long. Try again.
- Google sign-in isn't available right now.

## Create a layout (LayoutDialog.tsx, 8)

- Promise
- Create or import a layout
- Share code
- Enter code
- Custom Pad
- Create custom pad
- Import from code
- Import

## Watch an ad (rewardedAd.ts, 8)

- Loading an ad…
- No ad for you right now. Adding free time…
- Ads are not available in this version of the app.
- The ad did not start. Try again in a minute.
- No ad is available right now, and today's free time is already used. Try again a bit later.
- Couldn't add your time. Check your internet and watch the ad again.
- Your time is on the way. It will appear in a moment.
- No ad is available right now. Try again in a minute.

## Plans (not signed in) (GuestPlans.tsx, 7)

- · No sign-in needed
- : error ?
- Try again
- : catalogue?.buyOnGooglePlay ?
- : catalogue?.purchasable && offers.length ?
- Loading plans
- Plans could not load. Your play time still works offline.

## Touchpad (Touchpad.tsx, 7)

- round ?
- opacity 0.12s ease-out
- transform 0.08s ease-out
- opacity 0.25s ease-out
- transform 0.12s ease-out
- transform 0.22s cubic-bezier(0.22,1,0.36,1)
- stroke 0.16s ease-out

## Touchpad settings (TouchpadSettings.tsx, 7)

- On lift
- Sensitivity
- Reset
- Speed
- Distance
- Instant
- Glide

## appConfig.ts (appConfig.ts, 4)

- Sign in to get unlimited time
- Rewarded ads aren't working right now, so we're giving free time instead. Signed-in players play unlimited until ads are back.
- This version is no longer supported. Please update to keep playing.
- Your play time is used up. Ads aren't working right now: get free time below, or sign in for unlimited time.

## sync.ts (sync.ts, 4)

- Offline. Layouts stay on this phone.
- No connection. Layouts stay on this phone.
- Sign in again to back up.
- Backup failed. It will retry.

## PlaytimeLockout.tsx (PlaytimeLockout.tsx, 3)

- 1px solid var(--calm-line)
- More time in Account
- See plans in Account

## PlaytimeToast.tsx (PlaytimeToast.tsx, 3)

- 0 6px 20px rgba(0,0,0,0.45)
- wrapping up soon
- of play time

## AdRewardButton.tsx (AdRewardButton.tsx, 2)

- Ad privacy choices
- 1px solid var(--calm-accent)

## useOverlayFocus.ts (useOverlayFocus.ts, 2)

- Array.from(root.current?.querySelectorAll
- Tab

## billing.ts (billing.ts, 2)

- Could not load your plan.
- Resets shortly

## feedback.ts (feedback.ts, 1)

- Android

## touchpad.ts (touchpad.ts, 1)

- 0 && (dx * dx) / (a * a) + (dy * dy) / (b * b)

## transportCoordinator.ts (transportCoordinator.ts, 1)

- 0 && now - s.wirelessIntentAt

## AdRewardChip.tsx (AdRewardChip.tsx, 1)

- Watch an ad

## FreePlay.tsx (FreePlay.tsx, 1)

- or keep playing free

## SignInScreen.tsx (SignInScreen.tsx, 1)

- Back

## native.ts (native.ts, 1)

- Could not read the free trial clock.

## playtime.ts (playtime.ts, 1)

- This phone
