import os
import subprocess
import base64
from PIL import Image

# Directories
PROJECTS_DIR = r"D:\Akhil\HP\projects\gamepados\marketing\store-graphics\play-products"
ARTIFACTS_DIR = r"C:\Users\akhil\.gemini\antigravity\brain\3e3e150b-c41f-47c7-8d0e-1188d15e30dc"
FONT_PATH = r"D:\Akhil\HP\projects\gamepados\apps\controller-ui\src\assets\space-semibold.woff2"

os.makedirs(PROJECTS_DIR, exist_ok=True)
os.makedirs(ARTIFACTS_DIR, exist_ok=True)

with open(FONT_PATH, "rb") as f:
    font_b64 = base64.b64encode(f.read()).decode("utf-8")

GLYPH_PATH1 = "M4 4h7v4H8v8h8v-3h-4V9h8v11H4V4Z"
GLYPH_PATH2 = "M15 4h5v3h-5z"

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
temp_html = os.path.join(os.environ["TEMP"], "render_icon.html")
temp_png = os.path.join(os.environ["TEMP"], "render_out.png")

def render_and_save(html_content, base_name):
    with open(temp_html, "w", encoding="utf-8") as f:
        f.write(html_content)
    
    if os.path.exists(temp_png):
        os.remove(temp_png)
        
    cmd = [
        chrome_path,
        "--headless=new",
        f"--screenshot={temp_png}",
        "--window-size=1024,1024",
        f"file:///{temp_html.replace(os.sep, '/')}"
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    im = Image.open(temp_png).convert("RGBA")
    
    # Save 1024x1024
    out_1024_proj = os.path.join(PROJECTS_DIR, f"{base_name}_1024.png")
    out_1024_art = os.path.join(ARTIFACTS_DIR, f"{base_name}_1024.png")
    im.save(out_1024_proj, "PNG")
    im.save(out_1024_art, "PNG")
    
    # Save 512x512
    im_512 = im.resize((512, 512), Image.Resampling.LANCZOS)
    out_512_proj = os.path.join(PROJECTS_DIR, f"{base_name}_512.png")
    out_512_art = os.path.join(ARTIFACTS_DIR, f"{base_name}_512.png")
    im_512.save(out_512_proj, "PNG")
    im_512.save(out_512_art, "PNG")
    
    size_kb = os.path.getsize(out_1024_proj) / 1024
    print(f"Generated {base_name}: 1024x1024 ({size_kb:.1f} KB), 512x512")

# ==========================================
# DESIGN 1: LIFETIME PASS (Golden Ember Edition)
# Matches screenshot: Name = "lifetime", Benefits = "No ads. No interruptions."
# ==========================================
html_design1 = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@font-face {{
  font-family: 'Space';
  src: url(data:font/woff2;base64,{font_b64}) format('woff2');
  font-weight: 600;
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{
  width: 1024px;
  height: 1024px;
  overflow: hidden;
  background: #09090b;
  font-family: 'Space', -apple-system, sans-serif;
}}
.container {{
  width: 1024px;
  height: 1024px;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: radial-gradient(110% 110% at 50% 35%, #281002 0%, #110804 45%, #08080a 85%);
}}

.ambient-glow {{
  position: absolute;
  top: 180px;
  width: 650px;
  height: 650px;
  background: radial-gradient(circle, rgba(255, 85, 0, 0.32) 0%, rgba(255, 120, 0, 0.12) 40%, rgba(255, 85, 0, 0) 70%);
  border-radius: 50%;
  pointer-events: none;
}}

.badge-frame {{
  width: 780px;
  height: 780px;
  border-radius: 200px;
  background: linear-gradient(165deg, rgba(38, 22, 16, 0.95) 0%, rgba(18, 14, 15, 0.98) 55%, rgba(10, 10, 12, 1) 100%);
  border: 3px solid transparent;
  background-clip: padding-box;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-shadow: 
    0 40px 100px -20px rgba(0, 0, 0, 0.9),
    0 0 60px rgba(255, 85, 0, 0.22),
    inset 0 2px 4px rgba(255, 180, 120, 0.25),
    inset 0 -2px 4px rgba(0, 0, 0, 0.6);
}}

.badge-frame::before {{
  content: '';
  position: absolute;
  top: -3px; bottom: -3px; left: -3px; right: -3px;
  background: linear-gradient(145deg, #ff9933 0%, #ff5500 35%, #4a1d08 70%, #ffaa00 100%);
  border-radius: 203px;
  z-index: -1;
}}

.tier-tag {{
  position: absolute;
  top: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 26px;
  border-radius: 40px;
  background: rgba(255, 85, 0, 0.12);
  border: 1.5px solid rgba(255, 120, 0, 0.4);
  color: #ffaa44;
  font-size: 20px;
  letter-spacing: 5px;
  font-weight: 700;
  text-shadow: 0 0 16px rgba(255, 170, 0, 0.6);
}}

.glyph-wrapper {{
  margin-top: 15px;
  margin-bottom: 25px;
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 15px 30px rgba(255, 85, 0, 0.5));
}}

.brand-glyph {{
  width: 320px;
  height: 320px;
}}

.pill-badge {{
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ff6600 0%, #ff4400 50%, #d43500 100%);
  padding: 16px 52px;
  border-radius: 60px;
  box-shadow: 
    0 12px 35px rgba(255, 68, 0, 0.45),
    inset 0 2px 2px rgba(255, 255, 255, 0.4),
    inset 0 -2px 3px rgba(0, 0, 0, 0.3);
  border: 2px solid #ffa066;
}}

.pill-title {{
  font-size: 40px;
  font-weight: 700;
  letter-spacing: 7px;
  color: #ffffff;
  text-transform: uppercase;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  line-height: 1.1;
}}

.pill-sub {{
  font-size: 15px;
  letter-spacing: 4px;
  color: rgba(255, 255, 255, 0.88);
  text-transform: uppercase;
  font-weight: 600;
  margin-top: 2px;
}}

.corner-accent {{
  position: absolute;
  width: 40px;
  height: 40px;
  border-color: rgba(255, 85, 0, 0.3);
  border-style: solid;
}}
.c-tl {{ top: 40px; left: 40px; border-width: 3px 0 0 3px; border-top-left-radius: 12px; }}
.c-tr {{ top: 40px; right: 40px; border-width: 3px 3px 0 0; border-top-right-radius: 12px; }}
.c-bl {{ bottom: 40px; left: 40px; border-width: 0 0 3px 3px; border-bottom-left-radius: 12px; }}
.c-br {{ bottom: 40px; right: 40px; border-width: 0 3px 3px 0; border-bottom-right-radius: 12px; }}
</style>
</head>
<body>
<div class="container">
  <div class="ambient-glow"></div>
  <div class="corner-accent c-tl"></div>
  <div class="corner-accent c-tr"></div>
  <div class="corner-accent c-bl"></div>
  <div class="corner-accent c-br"></div>

  <div class="badge-frame">
    <div class="tier-tag">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="#ffaa44">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
      </svg>
      <span>VIP PASS</span>
    </div>

    <div class="glyph-wrapper">
      <svg class="brand-glyph" viewBox="0 0 24 24">
        <defs>
          <linearGradient id="glyphGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ff7722" />
            <stop offset="60%" stop-color="#ff5500" />
            <stop offset="100%" stop-color="#e03800" />
          </linearGradient>
        </defs>
        <path d="{GLYPH_PATH1}" fill="url(#glyphGrad1)"/>
        <path d="{GLYPH_PATH2}" fill="url(#glyphGrad1)"/>
      </svg>
    </div>

    <div class="pill-badge">
      <div class="pill-title">LIFETIME</div>
      <div class="pill-sub">NO ADS &middot; UNLIMITED</div>
    </div>
  </div>
</div>
</body>
</html>
"""

# ==========================================
# DESIGN 2: LIFETIME INFINITY (Minimalist Luxury)
# Clean, bold, sleek infinity symbol + prominent GamepadOS logo
# ==========================================
html_design2 = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@font-face {{
  font-family: 'Space';
  src: url(data:font/woff2;base64,{font_b64}) format('woff2');
  font-weight: 600;
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{
  width: 1024px;
  height: 1024px;
  overflow: hidden;
  background: #09090b;
  font-family: 'Space', -apple-system, sans-serif;
}}
.container {{
  width: 1024px;
  height: 1024px;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 50% 45%, #240d02 0%, #0c0806 50%, #060608 100%);
}}

.radial-beam {{
  position: absolute;
  width: 800px;
  height: 800px;
  background: radial-gradient(circle, rgba(255, 85, 0, 0.28) 0%, rgba(255, 85, 0, 0.05) 50%, transparent 70%);
  border-radius: 50%;
}}

.outer-ring {{
  position: absolute;
  width: 820px;
  height: 820px;
  border-radius: 50%;
  border: 1px dashed rgba(255, 85, 0, 0.25);
  box-shadow: 0 0 50px rgba(255, 85, 0, 0.1);
}}

.inner-badge {{
  width: 720px;
  height: 720px;
  border-radius: 190px;
  background: linear-gradient(180deg, #181518 0%, #0f0d10 60%, #09080a 100%);
  border: 2px solid rgba(255, 85, 0, 0.4);
  box-shadow: 
    0 30px 80px rgba(0,0,0,0.85),
    0 0 80px rgba(255, 85, 0, 0.18),
    inset 0 1px 3px rgba(255, 255, 255, 0.2);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}}

.infinity-icon {{
  font-size: 72px;
  color: #ff9933;
  margin-top: 10px;
  margin-bottom: -15px;
  text-shadow: 0 0 25px rgba(255, 120, 0, 0.8);
  font-family: sans-serif;
  line-height: 1;
}}

.brand-glyph {{
  width: 320px;
  height: 320px;
  filter: drop-shadow(0 15px 35px rgba(255, 85, 0, 0.55));
}}

.title-wrap {{
  margin-top: 25px;
  text-align: center;
}}

.main-title {{
  font-size: 50px;
  font-weight: 700;
  letter-spacing: 12px;
  color: #ffffff;
  text-transform: uppercase;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
}}

.sub-title {{
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 6px;
  color: #ff8833;
  text-transform: uppercase;
  margin-top: 6px;
}}
</style>
</head>
<body>
<div class="container">
  <div class="radial-beam"></div>
  <div class="outer-ring"></div>

  <div class="inner-badge">
    <div class="infinity-icon">&infin;</div>

    <svg class="brand-glyph" viewBox="0 0 24 24">
      <defs>
        <linearGradient id="glyphGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ff7700" />
          <stop offset="100%" stop-color="#ff4400" />
        </linearGradient>
      </defs>
      <path d="{GLYPH_PATH1}" fill="url(#glyphGrad2)"/>
      <path d="{GLYPH_PATH2}" fill="url(#glyphGrad2)"/>
    </svg>

    <div class="title-wrap">
      <div class="main-title">LIFETIME</div>
      <div class="sub-title">UNLIMITED ACCESS</div>
    </div>
  </div>
</div>
</body>
</html>
"""

# ==========================================
# DESIGN 3: PURE BRAND LOGO (Zero-Text Policy Compliant)
# Perfect if Google Play asks for pure branding without typography
# ==========================================
html_design3 = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{
  width: 1024px;
  height: 1024px;
  overflow: hidden;
  background: #09090b;
}}
.container {{
  width: 1024px;
  height: 1024px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(110% 110% at 50% 40%, #291004 0%, #100703 40%, #060608 80%);
}}

.glow {{
  position: absolute;
  width: 750px;
  height: 750px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 85, 0, 0.4) 0%, rgba(255, 85, 0, 0.1) 45%, transparent 70%);
}}

.squircle {{
  width: 760px;
  height: 760px;
  border-radius: 200px;
  background: linear-gradient(150deg, #ff5500 0%, #ff4000 40%, #d42b00 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  box-shadow: 
    0 40px 100px -15px rgba(0, 0, 0, 0.9),
    0 0 90px rgba(255, 85, 0, 0.5),
    inset 0 3px 6px rgba(255, 255, 255, 0.4),
    inset 0 -3px 8px rgba(0, 0, 0, 0.4);
}}

.squircle-inner {{
  width: 680px;
  height: 680px;
  border-radius: 165px;
  background: radial-gradient(circle at 35% 35%, #221e25 0%, #0d0c0e 65%, #08080a 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 
    inset 0 4px 12px rgba(0, 0, 0, 0.7),
    0 2px 4px rgba(255, 160, 100, 0.3);
  position: relative;
}}

.brand-glyph {{
  width: 440px;
  height: 440px;
  filter: drop-shadow(0 20px 45px rgba(255, 85, 0, 0.65));
}}
</style>
</head>
<body>
<div class="container">
  <div class="glow"></div>
  <div class="squircle">
    <div class="squircle-inner">
      <svg class="brand-glyph" viewBox="0 0 24 24">
        <defs>
          <linearGradient id="glyphGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ff7722" />
            <stop offset="60%" stop-color="#ff5500" />
            <stop offset="100%" stop-color="#ea3900" />
          </linearGradient>
        </defs>
        <path d="{GLYPH_PATH1}" fill="url(#glyphGrad3)"/>
        <path d="{GLYPH_PATH2}" fill="url(#glyphGrad3)"/>
      </svg>
    </div>
  </div>
</div>
</body>
</html>
"""

# ==========================================
# DESIGN 4: QUARTERLY / PRO SUBSCRIPTION
# For gpos_quarterly or Pro subscription
# ==========================================
html_design4 = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@font-face {{
  font-family: 'Space';
  src: url(data:font/woff2;base64,{font_b64}) format('woff2');
  font-weight: 600;
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{
  width: 1024px;
  height: 1024px;
  overflow: hidden;
  background: #09090b;
  font-family: 'Space', -apple-system, sans-serif;
}}
.container {{
  width: 1024px;
  height: 1024px;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: radial-gradient(110% 110% at 50% 35%, #251004 0%, #100806 45%, #08080a 85%);
}}

.ambient-glow {{
  position: absolute;
  top: 180px;
  width: 650px;
  height: 650px;
  background: radial-gradient(circle, rgba(255, 85, 0, 0.3) 0%, rgba(255, 85, 0, 0.08) 45%, transparent 70%);
  border-radius: 50%;
}}

.badge-frame {{
  width: 780px;
  height: 780px;
  border-radius: 200px;
  background: linear-gradient(165deg, rgba(32, 24, 22, 0.95) 0%, rgba(16, 14, 16, 0.98) 55%, rgba(10, 10, 12, 1) 100%);
  border: 3px solid rgba(255, 85, 0, 0.5);
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-shadow: 
    0 40px 100px -20px rgba(0, 0, 0, 0.9),
    0 0 60px rgba(255, 85, 0, 0.2),
    inset 0 2px 4px rgba(255, 180, 120, 0.25);
}}

.tier-tag {{
  position: absolute;
  top: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 26px;
  border-radius: 40px;
  background: rgba(255, 85, 0, 0.12);
  border: 1.5px solid rgba(255, 85, 0, 0.4);
  color: #ff7722;
  font-size: 20px;
  letter-spacing: 5px;
  font-weight: 700;
}}

.glyph-wrapper {{
  margin-top: 15px;
  margin-bottom: 25px;
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 15px 30px rgba(255, 85, 0, 0.5));
}}

.brand-glyph {{
  width: 320px;
  height: 320px;
}}

.pill-badge {{
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ff5500 0%, #e03b00 100%);
  padding: 16px 54px;
  border-radius: 60px;
  box-shadow: 
    0 12px 35px rgba(255, 68, 0, 0.45),
    inset 0 2px 2px rgba(255, 255, 255, 0.35);
  border: 2px solid #ff8844;
}}

.pill-title {{
  font-size: 38px;
  font-weight: 700;
  letter-spacing: 7px;
  color: #ffffff;
  text-transform: uppercase;
  line-height: 1.1;
}}

.pill-sub {{
  font-size: 15px;
  letter-spacing: 4px;
  color: rgba(255, 255, 255, 0.88);
  text-transform: uppercase;
  font-weight: 600;
  margin-top: 2px;
}}
</style>
</head>
<body>
<div class="container">
  <div class="ambient-glow"></div>

  <div class="badge-frame">
    <div class="tier-tag">
      <span>SUBSCRIPTION</span>
    </div>

    <div class="glyph-wrapper">
      <svg class="brand-glyph" viewBox="0 0 24 24">
        <defs>
          <linearGradient id="glyphGrad4" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ff7722" />
            <stop offset="60%" stop-color="#ff5500" />
            <stop offset="100%" stop-color="#d42b00" />
          </linearGradient>
        </defs>
        <path d="{GLYPH_PATH1}" fill="url(#glyphGrad4)"/>
        <path d="{GLYPH_PATH2}" fill="url(#glyphGrad4)"/>
      </svg>
    </div>

    <div class="pill-badge">
      <div class="pill-title">QUARTERLY</div>
      <div class="pill-sub">NO ADS &middot; UNLIMITED PLAY</div>
    </div>
  </div>
</div>
</body>
</html>
"""

print("Rendering Design 1: Lifetime Pass (Ember Badge)...")
render_and_save(html_design1, "gamepados_lifetime_badge")

print("Rendering Design 2: Lifetime Infinity (Minimalist Luxury)...")
render_and_save(html_design2, "gamepados_lifetime_minimal")

print("Rendering Design 3: Pure Official Brand Mark (Zero-Text)...")
render_and_save(html_design3, "gamepados_product_brand_pure")

print("Rendering Design 4: Quarterly Pass (Subscription)...")
render_and_save(html_design4, "gamepados_quarterly_pass")

print("\nAll icons generated successfully!")
