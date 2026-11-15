package space.gamepad.admin;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.os.*;
import android.security.keystore.*;
import android.text.InputType;
import android.text.method.PasswordTransformationMethod;
import android.util.Base64;
import android.view.*;
import android.view.animation.DecelerateInterpolator;
import android.view.inputmethod.EditorInfo;
import android.webkit.*;
import android.widget.*;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.ECGenParameterSpec;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Dedicated, origin-pinned portal client. No password or release key in the APK.
 *
 *  1.3.0 (owner, 2026-11-15): a calmer dark + white sign-in screen, the same theme on the top bar, and FACE sign-in.
 *  The POCO's face unlock is camera-only, which Android ranks "weak" (Class 2), and a weak biometric cannot unlock a
 *  Keystore key. So:
 *    - SIGN-IN accepts face OR fingerprint. The saved login is encrypted with a Keystore key that needs no biometric
 *      itself (vault v2); the app asks for face/fingerprint before it uses it.
 *    - RELEASE APPROVALS still need a STRONG biometric (fingerprint on the POCO): the approval key is bound to it, so a
 *      photo that fools face unlock can never publish a release. */
public class MainActivity extends Activity {
    private static final String ORIGIN = "https://supportportal.gamepad.space";
    // v1 = fingerprint-bound vault (1.0-1.2); v2 = face-or-fingerprint vault (1.3+). DEVICE = release approval key.
    private static final String VAULT_V1 = "gpos.admin.login.v1", VAULT = "gpos.admin.login.v2", DEVICE = "gpos.admin.approval.v1";
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private android.content.SharedPreferences prefs;
    private LinearLayout root;
    private WebView web;
    private EditText email, password;
    private TextView status;
    private Button signIn;
    private boolean background, picker, busy, destroyed;
    private int generation;
    private ValueCallback<Uri[]> fileCallback;
    private CancellationSignal cancellation;
    private JsPromptResult pendingApproval;

    // Dark + white (owner, 2026-11-15: "dark + white, not indigo").
    private static final int BG = Color.rgb(11,11,12), SURFACE = Color.rgb(22,22,24), FIELD = Color.rgb(28,28,31),
        LINE = Color.rgb(44,44,48), INK = Color.WHITE, MUTED = Color.rgb(161,161,166), FAINT = Color.rgb(110,110,115),
        ERROR = Color.rgb(255,138,128);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        prefs = getSharedPreferences("admin-vault", MODE_PRIVATE);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().removeAllCookies(null);
        String note = migrateVault();
        showLogin(note, false, note.isEmpty());
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::handleBack);
    }

    /** A login saved by 1.0-1.2 is bound to the fingerprint and cannot be opened by face. It is dropped (the release
     *  approval key is kept), and the player is asked to sign in with the password once to turn face sign-in on. */
    private String migrateVault() {
        if (!prefs.contains("cipher")) return "";
        prefs.edit().remove("cipher").remove("iv").apply();
        try { keys().deleteEntry(VAULT_V1); } catch (Exception ignored) {}
        return "Face sign-in is new. Sign in with your password once to turn it on.";
    }

    // ── Small view helpers ─────────────────────────────────────────────────────────────────────────────────────────
    private int dp(float n) { return (int)(getResources().getDisplayMetrics().density*n+.5f); }
    private GradientDrawable shape(int color, int radius, int stroke) {
        GradientDrawable g = new GradientDrawable(); g.setColor(color); g.setCornerRadius(dp(radius));
        if (stroke != 0) g.setStroke(dp(1), stroke); return g;
    }
    private TextView text(String value, float size, int color) {
        TextView t = new TextView(this); t.setText(value); t.setTextSize(size); t.setTextColor(color);
        t.setLineSpacing(0, 1.15f); return t;
    }
    private LinearLayout.LayoutParams wide(int height, int top) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, height); p.topMargin = dp(top); return p;
    }
    /** White filled (primary) or outlined (secondary) button with large, soft corners. */
    private Button button(String label, boolean primary, Runnable action) {
        Button b = new Button(this); b.setText(label); b.setAllCaps(false); b.setTextSize(16);
        b.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        b.setTextColor(primary ? Color.BLACK : INK); b.setStateListAnimator(null);
        b.setBackground(primary ? shape(INK, 16, 0) : shape(Color.TRANSPARENT, 16, LINE));
        b.setMinHeight(dp(56)); b.setOnClickListener(v -> action.run()); return b;
    }
    /** A filled, rounded input whose border turns white while it is being typed in. */
    private EditText field(String hint, int inputType) {
        EditText e = new EditText(this); e.setHint(hint); e.setHintTextColor(FAINT); e.setTextColor(INK); e.setTextSize(16);
        e.setSingleLine(true); e.setInputType(inputType); e.setPadding(dp(16), 0, dp(16), 0);
        StateListDrawable bg = new StateListDrawable();
        GradientDrawable focused = shape(FIELD, 14, 0); focused.setStroke(dp(1.5f), INK);
        bg.addState(new int[]{android.R.attr.state_focused}, focused);
        bg.addState(new int[]{}, shape(FIELD, 14, LINE));
        e.setBackground(bg); return e;
    }

    private void base() {
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(BG);
        if (Build.VERSION.SDK_INT >= 30) root.setOnApplyWindowInsetsListener((v,i)->{
            android.graphics.Insets s=i.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());
            v.setPadding(s.left,s.top,s.right,s.bottom); return i;
        });
        else {
            root.setOnApplyWindowInsetsListener((v,i)-> { v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom()); return i; });
        }
        setContentView(root); root.requestApplyInsets();
    }
    private void disposeWeb() {
        if (web != null) { web.stopLoading(); web.loadUrl("about:blank"); web.destroy(); web=null; }
    }

    // ── Sign-in screen ─────────────────────────────────────────────────────────────────────────────────────────────
    /** @param error   show the message in soft red (a problem) rather than grey (information)
     *  @param prompt  open the face / fingerprint sheet straight away when a login is saved */
    private void showLogin(String message, boolean error, boolean prompt) {
        generation++; busy=false;
        if (pendingApproval!=null) { pendingApproval.cancel(); pendingApproval=null; }
        disposeWeb(); base();
        boolean saved = hasSavedLogin() && biometricAvailable();
        String savedEmail = prefs.getString("email", "");

        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); root.addView(scroll, new LinearLayout.LayoutParams(-1,-1));
        LinearLayout frame = new LinearLayout(this); frame.setOrientation(LinearLayout.VERTICAL); frame.setGravity(Gravity.CENTER);
        frame.setPadding(dp(24), dp(32), dp(24), dp(32)); scroll.addView(frame, new ScrollView.LayoutParams(-1, -1));
        LinearLayout card = new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL);
        frame.addView(card, new LinearLayout.LayoutParams(Math.min(getResources().getDisplayMetrics().widthPixels-dp(48), dp(420)), -2));

        // The G, in a soft rounded tile.
        FrameLayout tile = new FrameLayout(this); tile.setBackground(shape(SURFACE, 22, LINE));
        ImageView mark = new ImageView(this); mark.setImageResource(R.drawable.ic_g_mark); mark.setContentDescription("GamepadOS");
        tile.addView(mark, new FrameLayout.LayoutParams(dp(36), dp(36), Gravity.CENTER));
        card.addView(tile, new LinearLayout.LayoutParams(dp(72), dp(72)));

        TextView hello = text(savedEmail.isEmpty() ? "Welcome" : "Welcome back", 30, INK);
        hello.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL)); hello.setPadding(0, dp(24), 0, 0);
        card.addView(hello);
        card.addView(text(saved ? savedEmail : "Sign in to your GamepadOS admin portal.", 15, MUTED));

        if (saved) {
            Button face = button("Unlock with face or fingerprint", true, this::unlock);
            Drawable icon = getDrawable(R.drawable.ic_face);
            if (icon != null) { icon.setTint(Color.BLACK); face.setCompoundDrawablesRelativeWithIntrinsicBounds(icon, null, null, null); }
            face.setCompoundDrawablePadding(dp(10)); face.setPadding(dp(20), 0, dp(20), 0);
            card.addView(face, wide(dp(56), 28));
            card.addView(divider("or use your password"));
        }

        email = field("Email", InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        email.setAutofillHints(View.AUTOFILL_HINT_USERNAME); email.setText(savedEmail); email.setImeOptions(EditorInfo.IME_ACTION_NEXT);
        card.addView(email, wide(dp(54), saved ? 0 : 28));

        // Password with a Show / Hide switch on the right, so a mistyped password is easy to spot.
        FrameLayout pwBox = new FrameLayout(this);
        password = field("Password", InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        password.setAutofillHints(View.AUTOFILL_HINT_PASSWORD); password.setPadding(dp(16), 0, dp(72), 0);
        password.setImeOptions(EditorInfo.IME_ACTION_DONE);
        pwBox.addView(password, new FrameLayout.LayoutParams(-1, -1));
        TextView reveal = text("Show", 14, MUTED); reveal.setGravity(Gravity.CENTER); reveal.setPadding(dp(16), 0, dp(16), 0);
        reveal.setContentDescription("Show password");
        reveal.setOnClickListener(v -> {
            boolean hidden = password.getTransformationMethod() instanceof PasswordTransformationMethod;
            password.setTransformationMethod(hidden ? null : PasswordTransformationMethod.getInstance());
            password.setSelection(password.getText().length());
            reveal.setText(hidden ? "Hide" : "Show"); reveal.setContentDescription(hidden ? "Hide password" : "Show password");
        });
        pwBox.addView(reveal, new FrameLayout.LayoutParams(-2, -1, Gravity.END|Gravity.CENTER_VERTICAL));
        card.addView(pwBox, wide(dp(54), 12));

        Runnable go = () -> login(email.getText().toString().trim(), password.getText().toString(), true);
        password.setOnEditorActionListener((v, id, ev) -> { if (id == EditorInfo.IME_ACTION_DONE) { go.run(); return true; } return false; });
        signIn = button("Sign in", !saved, go);
        card.addView(signIn, wide(dp(56), 20));

        status = text(message, 14, error ? ERROR : MUTED); status.setGravity(Gravity.CENTER_HORIZONTAL);
        status.setPadding(0, dp(14), 0, 0); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        card.addView(status);

        TextView privacy = text("Your face and fingerprint never leave this phone.", 12, FAINT);
        privacy.setGravity(Gravity.CENTER_HORIZONTAL); privacy.setPadding(0, dp(28), 0, 0); card.addView(privacy);
        if (hasSavedLogin()) {
            TextView forgetLink = text("Forget saved sign-in", 13, MUTED); forgetLink.setGravity(Gravity.CENTER_HORIZONTAL);
            forgetLink.setPadding(0, dp(12), 0, dp(12));
            forgetLink.setOnClickListener(v -> { forget(); showLogin("Saved sign-in removed from this phone.", false, false); });
            card.addView(forgetLink, wide(-2, 4));
        }

        // A soft entrance instead of the screen snapping in.
        card.setAlpha(0f); card.setTranslationY(dp(14));
        card.animate().alpha(1f).translationY(0).setDuration(320).setInterpolator(new DecelerateInterpolator(2f)).start();

        if (saved && prompt) card.postDelayed(() -> { if (!busy && !background && !destroyed) unlock(); }, 450);
    }
    private View divider(String label) {
        LinearLayout row = new LinearLayout(this); row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(24), 0, dp(20));
        View left = new View(this), right = new View(this); left.setBackgroundColor(LINE); right.setBackgroundColor(LINE);
        row.addView(left, new LinearLayout.LayoutParams(0, dp(1), 1));
        TextView t = text(label, 13, FAINT); t.setPadding(dp(12), 0, dp(12), 0); row.addView(t);
        row.addView(right, new LinearLayout.LayoutParams(0, dp(1), 1));
        return row;
    }
    /** Problems go in red under the form; everything else in grey. A toast only when the form is not on screen. */
    private void say(String m) { say(m, true); }
    private void say(String m, boolean error) {
        if (status != null && status.isAttachedToWindow()) { status.setTextColor(error ? ERROR : MUTED); status.setText(m); }
        else Toast.makeText(this, m, Toast.LENGTH_LONG).show();
    }

    // ── Keys and the saved login ───────────────────────────────────────────────────────────────────────────────────
    private static String b64(byte[] b) {return Base64.encodeToString(b,Base64.NO_WRAP);}
    private static byte[] un64(String s) {return Base64.decode(s,Base64.NO_WRAP);}
    private static String hex(byte[] b) {StringBuilder s=new StringBuilder();for(byte x:b)s.append(String.format(Locale.ROOT,"%02x",x&255));return s.toString();}
    private KeyStore keys() throws Exception {KeyStore k=KeyStore.getInstance("AndroidKeyStore");k.load(null);return k;}
    private boolean hasSavedLogin() { return prefs.contains("cipher2"); }
    private void forget() {
        prefs.edit().clear().apply();
        try {KeyStore k=keys(); k.deleteEntry(VAULT_V1); k.deleteEntry(VAULT); k.deleteEntry(DEVICE);} catch(Exception ignored){}
    }
    private void forgetLogin() {
        prefs.edit().remove("cipher2").remove("iv2").apply();
        try { keys().deleteEntry(VAULT); } catch (Exception ignored) {}
    }
    /** Face or fingerprint enrolled and usable (Android's own face unlock counts here, even camera-only). */
    private boolean biometricAvailable() {
        BiometricManager m = getSystemService(BiometricManager.class);
        if (m == null) return false;
        if (Build.VERSION.SDK_INT >= 30)
            return m.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG|BiometricManager.Authenticators.BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS;
        return m.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS;
    }
    /** The vault key: AES in the phone's Keystore (hardware-backed, cannot be copied off the phone). It needs no
     *  biometric itself, because a "weak" face unlock cannot unlock a Keystore key; the face / fingerprint check is
     *  done by {@link #biometricAny} before the app uses it. */
    private SecretKey vaultKey() throws Exception {
        KeyStore k = keys();
        if (k.containsAlias(VAULT)) return (SecretKey) k.getKey(VAULT, null);
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(VAULT, KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build());
        return g.generateKey();
    }
    private void storeLogin(String e, String p) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, vaultKey());
        byte[] secret = new JSONObject().put("email", e).put("password", p).toString().getBytes(StandardCharsets.UTF_8);
        byte[] encrypted = cipher.doFinal(secret); Arrays.fill(secret, (byte)0);
        prefs.edit().putString("email", e).putString("cipher2", b64(encrypted)).putString("iv2", b64(cipher.getIV())).apply();
    }

    // ── Biometric prompts ──────────────────────────────────────────────────────────────────────────────────────────
    /** STRONG only, bound to a Keystore key: used for release approvals. */
    private void biometric(BiometricPrompt.CryptoObject object, String title, String subtitle, java.util.function.Consumer<BiometricPrompt.CryptoObject> success, Runnable cancel) {
        if(cancellation!=null)cancellation.cancel(); cancellation=new CancellationSignal();
        BiometricPrompt.Builder builder=new BiometricPrompt.Builder(this).setTitle(title).setSubtitle(subtitle)
            .setNegativeButton("Cancel",getMainExecutor(),(d,w)->cancel.run());
        if(Build.VERSION.SDK_INT>=30)builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        builder.build().authenticate(object,cancellation,getMainExecutor(),new BiometricPrompt.AuthenticationCallback(){
            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r){ cancellation=null; if(!background&&!destroyed)success.accept(r.getCryptoObject()); else cancel.run(); }
            @Override public void onAuthenticationError(int c,CharSequence m){cancellation=null;cancel.run();if(c!=BiometricPrompt.BIOMETRIC_ERROR_CANCELED&&c!=BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED)say(m.toString());}
        });
    }
    /** Face OR fingerprint (weak or strong): used to sign in. No confirm tap after a face match. */
    private void biometricAny(String title, String subtitle, String negative, Runnable success, Runnable cancel) {
        if(cancellation!=null)cancellation.cancel(); cancellation=new CancellationSignal();
        BiometricPrompt.Builder builder=new BiometricPrompt.Builder(this).setTitle(title).setSubtitle(subtitle)
            .setConfirmationRequired(false).setNegativeButton(negative,getMainExecutor(),(d,w)->cancel.run());
        if(Build.VERSION.SDK_INT>=30)builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG|BiometricManager.Authenticators.BIOMETRIC_WEAK);
        builder.build().authenticate(cancellation,getMainExecutor(),new BiometricPrompt.AuthenticationCallback(){
            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r){ cancellation=null; if(!background&&!destroyed)success.run(); else cancel.run(); }
            @Override public void onAuthenticationError(int c,CharSequence m){cancellation=null;cancel.run();
                if(c!=BiometricPrompt.BIOMETRIC_ERROR_CANCELED&&c!=BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED)say(m.toString());}
        });
    }

    /** Turn on face / fingerprint sign-in: confirm it is the owner, save the login, then register the phone for
     *  release approvals (that key needs the fingerprint). */
    private void saveLogin(String e,String p,Runnable done) {
        biometricAny("Turn on face or fingerprint sign-in", "Confirm it's you", "Not now", () -> {
            try { storeLogin(e, p); enrollDevice(p, done); }
            catch (Exception ex) { say("Could not save your sign-in. You can keep using your password."); done.run(); }
        }, done);
    }
    private void unlock() {
        if(busy)return;
        if(!hasSavedLogin()){say("Sign in with your password to turn on face sign-in.",false);return;}
        biometricAny("Unlock GamepadOS Admin","Look at your phone or touch the fingerprint sensor","Use password",()->{
            try {
                Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE,vaultKey(),new GCMParameterSpec(128,un64(prefs.getString("iv2",""))));
                byte[] clear=cipher.doFinal(un64(prefs.getString("cipher2","")));JSONObject data=new JSONObject(new String(clear,StandardCharsets.UTF_8));Arrays.fill(clear,(byte)0);
                login(data.getString("email"),data.getString("password"),false);
            }catch(Exception e){forgetLogin();showLogin("Your saved sign-in could not be opened. Sign in with your password to turn it on again.",true,false);}
        },()->{ if(password!=null)password.requestFocus(); });
    }

    // ── Talking to the portal ──────────────────────────────────────────────────────────────────────────────────────
    private static final class Reply { JSONObject data; List<String> cookies=new ArrayList<>(); int code; }
    private Reply post(String path,JSONObject body,String cookie) throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(ORIGIN+path).openConnection();
        c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(30000);c.setRequestMethod("POST");c.setDoOutput(true);
        c.setRequestProperty("Content-Type","application/json");if(cookie!=null)c.setRequestProperty("Cookie",cookie);
        try {
            try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}
            Reply r=new Reply();r.code=c.getResponseCode();
            for(Map.Entry<String,List<String>> h:c.getHeaderFields().entrySet())if("Set-Cookie".equalsIgnoreCase(h.getKey()))r.cookies.addAll(h.getValue());
            InputStream stream=r.code>=400?c.getErrorStream():c.getInputStream();
            if(stream==null)throw new IOException("Empty response");
            String result;try(InputStream in=stream){result=new String(readBytes(in),StandardCharsets.UTF_8);}
            try{r.data=new JSONObject(result);}catch(Exception e){throw new IOException("The portal returned an unexpected response.");}
            return r;
        }finally{c.disconnect();}
    }
    private void login(String e,String p,boolean manual) {
        if(busy)return;if(e.isEmpty()||p.isEmpty()){say("Enter your email and password.");return;}
        busy=true;signIn.setEnabled(false);signIn.setText("Signing in…");say("",false);final int attempt=generation;
        io.execute(()->{
            try {
                Reply reply=post("/api/admin/login",new JSONObject().put("email",e).put("password",p),null);
                runOnUiThread(()->{
                    if(attempt!=generation||background||destroyed)return;
                    busy=false;signIn.setEnabled(true);signIn.setText("Sign in");
                    if(reply.code!=200||!reply.data.optBoolean("success")){say(reply.data.optString("error","Sign-in failed. Check your email and password."));return;}
                    if(reply.cookies.isEmpty()){say("The server did not return a session cookie.");return;}
                    for(String cookie:reply.cookies)CookieManager.getInstance().setCookie(ORIGIN,cookie);
                    CookieManager.getInstance().flush();password.setText("");
                    String old=prefs.getString("email","");if(!old.isEmpty()&&!old.equalsIgnoreCase(e))forget();
                    if(!manual){openPortal();return;}
                    // Typed the password with face sign-in already on: keep the saved copy in step (a changed password).
                    if(hasSavedLogin()){try{storeLogin(e,p);}catch(Exception ignored){}openPortal();return;}
                    if(!biometricAvailable()){openPortal();return;}
                    new AlertDialog.Builder(this).setTitle("Sign in with your face next time?")
                        .setMessage("Next time, just look at your phone or touch the fingerprint sensor. Your password is saved encrypted on this phone only.\n\nOwners also register this phone to approve releases with their fingerprint, without the release key.")
                        .setPositiveButton("Turn on",(d,w)->saveLogin(e,p,()->openPortal()))
                        .setNegativeButton("Not now",(d,w)->openPortal()).setOnCancelListener(d->openPortal()).show();
                });
            }catch(Exception ex){runOnUiThread(()->{if(attempt!=generation||background||destroyed)return;busy=false;signIn.setEnabled(true);signIn.setText("Sign in");say("Can't reach the portal. Check your internet connection and try again.");});}
        });
    }
    private void enrollDevice(String p,Runnable done) {
        try {
            KeyPairGenerator g=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore");
            KeyGenParameterSpec.Builder spec=new KeyGenParameterSpec.Builder(DEVICE,KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true);
            if(Build.VERSION.SDK_INT>=30)spec.setUserAuthenticationParameters(0,KeyProperties.AUTH_BIOMETRIC_STRONG);
            g.initialize(spec.build());KeyPair pair=g.generateKeyPair();
            String publicKey=b64(pair.getPublic().getEncoded()),cookie=CookieManager.getInstance().getCookie(ORIGIN),replaceDeviceId=prefs.getString("deviceId","");int attempt=generation;
            io.execute(()->{String message;
                try{Reply r=post("/api/admin/mobile/devices",new JSONObject().put("password",p).put("publicKey",publicKey).put("replaceDeviceId",replaceDeviceId).put("name",Build.MANUFACTURER+" "+Build.MODEL),cookie);
                    if(r.code==200&&r.data.optBoolean("success")){prefs.edit().putString("deviceId",r.data.getString("deviceId")).apply();message="Face sign-in is on. Releases are approved with your fingerprint.";}
                    else {prefs.edit().remove("deviceId").apply();message="Face sign-in is on. (Release approval by fingerprint is for the owner account.)";}
                }catch(Exception ex){message="Face sign-in is on. This phone could not be registered for release approvals; turn sign-in on again later.";}
                final String m=message;runOnUiThread(()->{if(attempt!=generation||background||destroyed)return;say(m,false);done.run();});
            });
        }catch(Exception e){say("Face sign-in is on. Release approvals need a fingerprint set up on this phone.",false);done.run();}
    }

    // ── The portal ─────────────────────────────────────────────────────────────────────────────────────────────────
    @SuppressWarnings("SetJavaScriptEnabled") private void openPortal() {
        if(background||destroyed)return; base();
        // Top bar: the G, "Admin", and the menu, in the same dark + white as the sign-in screen.
        LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);bar.setPadding(dp(16),0,dp(4),0);bar.setBackgroundColor(BG);
        ImageView mark=new ImageView(this);mark.setImageResource(R.drawable.ic_g_mark);mark.setContentDescription("GamepadOS");
        bar.addView(mark,new LinearLayout.LayoutParams(dp(22),dp(22)));
        TextView title=text("Admin",17,INK);title.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));title.setPadding(dp(12),0,0,0);
        title.setGravity(Gravity.CENTER_VERTICAL);bar.addView(title,new LinearLayout.LayoutParams(0,dp(56),1));
        TextView menu=text("⋮",24,INK);menu.setGravity(Gravity.CENTER);menu.setContentDescription("App actions");
        bar.addView(menu,new LinearLayout.LayoutParams(dp(48),dp(48)));
        menu.setOnClickListener(v->{PopupMenu popup=new PopupMenu(this,menu);popup.getMenu().add("Refresh portal");popup.getMenu().add("Lock app");popup.getMenu().add("Forget face sign-in on this phone");
            popup.setOnMenuItemClickListener(item->{String s=item.getTitle().toString();if(s.startsWith("Refresh")){if(web!=null)web.reload();}else{if(s.startsWith("Forget"))forget();lock(false);}return true;});popup.show();});
        root.addView(bar);
        View rule=new View(this);rule.setBackgroundColor(LINE);root.addView(rule,new LinearLayout.LayoutParams(-1,dp(1)));
        web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));
        web.setBackgroundColor(BG);WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMediaPlaybackRequiresUserGesture(true);settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setUserAgentString(settings.getUserAgentString()+" GamepadOSAdmin/1.3");CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){
                if(!r.isForMainFrame())return false;Uri u=r.getUrl();
                if(trusted(u.toString())){if(isLoginPath(u.getPath())){lock(true);return true;}return false;}
                if(r.hasGesture()&&("https".equals(u.getScheme())||"mailto".equals(u.getScheme())))external(u);return true;
            }
            @Override public void onPageFinished(WebView v,String url){
                if(web!=v||!trusted(url))return;
                if(isLoginPath(Uri.parse(url).getPath())){lock(true);return;}
                try{v.evaluateJavascript(readAsset("mobile.js"),null);}catch(Exception e){say("Mobile enhancements could not load.");}
            }
            @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){if(r.isForMainFrame()&&web==v)new AlertDialog.Builder(MainActivity.this).setTitle("Portal unavailable").setMessage("Check your internet connection. Your work is stored on the server.").setPositiveButton("Retry",(d,w)->v.reload()).setNegativeButton("Sign in",(d,w)->lock(false)).show();}
            @Override public void onReceivedSslError(WebView v,android.webkit.SslErrorHandler h,android.net.http.SslError e){h.cancel();say("Secure connection failed. Check the portal certificate.");}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsAlert(WebView v,String url,String message,JsResult r){if(!trusted(url)){r.cancel();return true;}new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK",(d,w)->r.confirm()).setOnCancelListener(d->r.cancel()).show();return true;}
            @Override public boolean onJsConfirm(WebView v,String url,String message,JsResult r){if(!trusted(url)){r.cancel();return true;}new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("Confirm",(d,w)->r.confirm()).setNegativeButton("Cancel",(d,w)->r.cancel()).setOnCancelListener(d->r.cancel()).show();return true;}
            @Override public boolean onJsPrompt(WebView v,String url,String message,String defaultValue,JsPromptResult r){
                if(trusted(url)&&message.startsWith("GPOS_APPROVE:")){approve(message.substring(13),r);return true;}r.cancel();return true;
            }
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams params){
                if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=cb;picker=true;
                try{startActivityForResult(params.createIntent(),101);}catch(Exception e){picker=false;fileCallback=null;cb.onReceiveValue(null);say("No file picker is available.");}return true;
            }
        });
        web.setDownloadListener((url,agent,disposition,mime,size)->{
            if(!trusted(url)){external(Uri.parse(url));return;}
            try{android.app.DownloadManager.Request request=new android.app.DownloadManager.Request(Uri.parse(url));String cookie=CookieManager.getInstance().getCookie(ORIGIN);
                if(cookie!=null)request.addRequestHeader("Cookie",cookie);request.addRequestHeader("User-Agent",agent);
                request.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,URLUtil.guessFileName(url,disposition,mime));
                ((android.app.DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);say("Download started.");
            }catch(Exception e){say("Unable to download this attachment.");}
        });
        web.loadUrl(ORIGIN+"/staff");
    }
    private static byte[] readBytes(InputStream in)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);return out.toByteArray();}
    private String readAsset(String name)throws IOException{try(InputStream in=getAssets().open(name)){return new String(readBytes(in),StandardCharsets.UTF_8);}}
    // The portal moved from /admin to /staff (2026-11-15); the old address forwards. Either sign-in page means the
    // session ended, so the app locks and shows its own face / fingerprint screen instead of the web form.
    private static boolean isLoginPath(String p){return p!=null&&(p.startsWith("/staff/login")||p.startsWith("/admin/login"));}
    private boolean trusted(String url){try{Uri u=Uri.parse(url);return "https".equals(u.getScheme())&&"supportportal.gamepad.space".equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&u.getUserInfo()==null;}catch(Exception e){return false;}}
    private void external(Uri uri){try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception e){say("No app can open this link.");}}
    private void approve(String payload,JsPromptResult result){
        if(pendingApproval!=null||background){result.cancel();return;}
        try{
            JSONObject request=new JSONObject(payload);String path=request.getString("path"),body=request.getString("body");
            if(!path.matches("/api/admin/releases/(register-activate|schedule|[^/?]+/activate)")||body.length()>100000){result.cancel();return;}
            String id=prefs.getString("deviceId",null);if(id==null){result.cancel();say("Release approvals need this phone registered. Lock the app, sign in with your password and turn on face sign-in.");return;}
            JSONObject data=new JSONObject(body);String summary="Action: "+path.substring("/api/admin/releases/".length())+"\n";
            for(String key:new String[]{"asset","filename","version","versionCode","at","notes"})if(data.has(key))summary+=key+": "+data.optString(key)+"\n";
            if(data.has("app"))summary+="App: "+data.opt("app")+"\n";if(data.has("pc"))summary+="PC: "+data.opt("pc")+"\n";
            pendingApproval=result;
            new AlertDialog.Builder(this).setTitle("Approve release").setMessage(summary).setNegativeButton("Cancel",(d,w)->cancelApproval(result))
                .setOnCancelListener(d->cancelApproval(result)).setPositiveButton("Use fingerprint",(d,w)->{
                    try{
                        String nonce=UUID.randomUUID().toString(),time=Long.toString(System.currentTimeMillis());
                        String hash=hex(MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8)));
                        String canonical="GPOS-RELEASE-V1\n"+id+"\n"+time+"\n"+nonce+"\nPOST\n"+path+"\n"+hash;
                        Signature signature=Signature.getInstance("SHA256withECDSA");signature.initSign((PrivateKey)keys().getKey(DEVICE,null));
                        biometric(new BiometricPrompt.CryptoObject(signature),"Approve this release","Touch the fingerprint sensor to publish",obj->{
                            try{obj.getSignature().update(canonical.getBytes(StandardCharsets.UTF_8));
                                String header=new JSONObject().put("deviceId",id).put("time",time).put("nonce",nonce).put("bodyHash",hash).put("signature",b64(obj.getSignature().sign())).toString();
                                if(pendingApproval==result){pendingApproval=null;result.confirm(header);}
                            }catch(Exception e){cancelApproval(result);say("Approval failed. Turn on face sign-in again to re-register this phone.");}
                        },()->cancelApproval(result));
                    }catch(Exception e){cancelApproval(result);say("This phone's approval key changed (a fingerprint was added or removed). Sign in with your password and turn on face sign-in again.");}
                }).show();
        }catch(Exception e){result.cancel();}
    }
    private void cancelApproval(JsPromptResult r){if(pendingApproval==r){pendingApproval=null;r.cancel();}}
    /** @param prompt open the face / fingerprint sheet straight away (coming back to the app, or the session ran out),
     *                not when the owner chose "Lock app" themselves. */
    private void lock(boolean prompt){generation++;if(cancellation!=null)cancellation.cancel();CookieManager.getInstance().removeAllCookies(null);showLogin("Locked to keep your portal safe.",false,prompt);}
    @Override protected void onStop(){super.onStop();if(!picker){background=true;generation++;if(cancellation!=null)cancellation.cancel();if(pendingApproval!=null)cancelApproval(pendingApproval);if(web!=null){web.setVisibility(View.INVISIBLE);web.onPause();}}}
    @Override protected void onStart(){super.onStart();if(background){background=false;lock(true);}}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==101){picker=false;if(fileCallback!=null){fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));fileCallback=null;}}}
    private void handleBack(){if(web!=null){final WebView current=web;web.evaluateJavascript("(function(){if(window.closeMobileMenu&&window.closeMobileMenu())return true;if(document.querySelector('.overlay.show')&&typeof closeModal==='function'){closeModal();return true;}if(document.body.classList.contains('detail-open')){if(typeof backToList==='function')backToList();else document.body.classList.remove('detail-open');return true;}return false;})()",handled->{if(!"true".equals(handled)&&web==current){if(web.canGoBack())web.goBack();else new AlertDialog.Builder(this).setMessage("Lock and close the portal?").setPositiveButton("Close",(d,w)->{lock(false);finish();}).setNegativeButton("Stay",null).show();}});}else finish();}
    // API 33+ uses the registered OnBackInvokedCallback; this override serves Android 10–12 only.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed(){handleBack();}
    @Override protected void onDestroy(){destroyed=true;if(cancellation!=null)cancellation.cancel();if(pendingApproval!=null)cancelApproval(pendingApproval);if(fileCallback!=null)fileCallback.onReceiveValue(null);disposeWeb();io.shutdownNow();super.onDestroy();}
}
