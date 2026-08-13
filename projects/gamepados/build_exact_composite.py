import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

def generate_exact_composite():
    ui_path = r"C:\Users\akhil\.gemini\antigravity\brain\2892e432-a196-4792-8661-2d570bd02648\.user_uploaded\media__1785059764337.png"
    bg_path = r"C:\Users\akhil\.gemini\antigravity\brain\2892e432-a196-4792-8661-2d570bd02648\.user_uploaded\media__1785059788139.jpg"
    out_path = r"D:\AKHIL\HP\projects\gamepados\Screenshots\gamepados_final_promo.jpg"

    ui = Image.open(ui_path).convert("RGBA")
    bg = Image.open(bg_path).convert("RGBA")

    # 1. Update the latency pill on bottom-left of UI image from "-- ms" to "< 2.5 ms"
    # Latency badge location is roughly bottom-left in ui_img
    draw_ui = ImageDraw.Draw(ui)
    
    # Cover old '-- ms' pill with clean dark pill
    pill_box = (10, ui.height - 40, 110, ui.height - 10)
    draw_ui.rounded_rectangle(pill_box, radius=15, fill=(12, 28, 20, 240), outline=(34, 197, 94, 255), width=1)
    # Draw green connection dot and '<2.5ms' text
    draw_ui.ellipse((20, ui.height - 29, 28, ui.height - 21), fill=(34, 197, 94, 255))
    try:
        font = ImageFont.truetype("arial.ttf", 14)
    except:
        font = ImageFont.load_default()
    draw_ui.text((34, ui.height - 31), "<2.5 ms", fill=(220, 252, 231, 255), font=font)

    # 2. Build realistic Samsung S25 Ultra device frame around UI
    screen_w, screen_h = ui.size
    border = 18
    phone_w = screen_w + (border * 2)
    phone_h = screen_h + (border * 2)

    phone = Image.new("RGBA", (phone_w, phone_h), (0, 0, 0, 0))
    p_draw = ImageDraw.Draw(phone)

    # Outer titanium phone frame
    r_phone = 45
    p_draw.rounded_rectangle((0, 0, phone_w, phone_h), radius=r_phone, fill=(28, 30, 36, 255), outline=(180, 185, 195, 255), width=3)

    # Inner bezel
    p_draw.rounded_rectangle((border - 2, border - 2, phone_w - border + 2, phone_h - border + 2), radius=r_phone - 8, fill=(8, 10, 14, 255))

    # Apply rounded corners to screen UI
    screen_mask = Image.new("L", (screen_w, screen_h), 0)
    sm_draw = ImageDraw.Draw(screen_mask)
    sm_draw.rounded_rectangle((0, 0, screen_w, screen_h), radius=r_phone - 12, fill=255)
    ui.putalpha(screen_mask)

    # Paste UI screen into phone
    phone.paste(ui, (border, border), ui)

    # Add camera punch-hole (center-left in landscape orientation or top center)
    p_draw.ellipse((border + 15, phone_h // 2 - 8, border + 31, phone_h // 2 + 8), fill=(5, 5, 5, 255), outline=(30, 30, 30, 255))

    # Add subtle glass screen reflection angled across phone
    glint_mask = Image.new("RGBA", (phone_w, phone_h), (255, 255, 255, 0))
    g_draw = ImageDraw.Draw(glint_mask)
    g_draw.polygon([(int(phone_w * 0.4), 0), (int(phone_w * 0.65), 0), (int(phone_w * 0.35), phone_h), (int(phone_w * 0.1), phone_h)], fill=(255, 255, 255, 22))
    phone.paste(glint_mask, (0, 0), glint_mask)

    # 3. Fit phone onto the background layout (bg is ~1024x576 or 1920x1080)
    bg_w, bg_h = bg.size
    
    # Scale phone to cover the Xbox controller area seamlessly (~52% of bg width)
    target_phone_w = int(bg_w * 0.48)
    aspect_p = phone_h / phone_w
    target_phone_h = int(target_phone_w * aspect_p)

    phone_resized = phone.resize((target_phone_w, target_phone_h), Image.Resampling.LANCZOS)

    # Rotate phone slightly (-14 degrees) for dynamic esports perspective
    angle = -14
    phone_rotated = phone_resized.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)

    # Create soft drop shadow behind phone
    shadow_mask = Image.new("L", phone_rotated.size, 0)
    if "A" in phone_rotated.mode:
        shadow_mask = phone_rotated.split()[3]
    shadow_blur = shadow_mask.filter(ImageFilter.GaussianBlur(radius=25))
    shadow = Image.new("RGBA", phone_rotated.size, (0, 0, 0, 220))
    shadow.putalpha(shadow_blur)

    # Place phone right over controller area (bottom-left quadrant)
    px = int(bg_w * 0.08)
    py = int(bg_h * 0.36)

    bg.paste(shadow, (px + 10, py + 20), shadow)
    bg.paste(phone_rotated, (px, py), phone_rotated)

    # 4. Update bottom-left text overlay from "XBOX CONTROLLER • <1MS LATENCY" to "GAMEPAD OS • <2.5MS LATENCY"
    bg_draw = ImageDraw.Draw(bg)
    
    # Cover old text "XBOX CONTROLLER • <1MS LATENCY" area cleanly with background black
    # Text is located in bottom-left around x=30, y=bg_h-90
    cover_box = (int(bg_w * 0.02), int(bg_h * 0.86), int(bg_w * 0.65), int(bg_h * 0.93))
    bg_draw.rectangle(cover_box, fill=(10, 10, 10, 255))

    # Write updated text "GAMEPAD OS • <2.5MS LATENCY"
    try:
        text_font = ImageFont.truetype("arialbd.ttf", int(bg_h * 0.038))
    except:
        text_font = ImageFont.load_default()
        
    bg_draw.text((int(bg_w * 0.03), int(bg_h * 0.875)), "GAMEPAD OS • <2.5MS LATENCY", fill=(212, 212, 212, 255), font=text_font)

    # Save final ultra crisp promotional image
    final_out = bg.convert("RGB")
    final_out.save(out_path, "JPEG", quality=98)
    print("Final exact composite generated at:", out_path)

if __name__ == "__main__":
    generate_exact_composite()
