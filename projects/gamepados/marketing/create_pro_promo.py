from PIL import Image, ImageFilter, ImageDraw, ImageFont, ImageEnhance
import math
import os

bg_path = r'C:\Users\akhil\.gemini\antigravity\brain\2ec3140c-dc65-46b6-add6-564fc870b83a\gamepados_bg_1782388922705.png'
icon_path = 'F:/hlooo/apps/android-client/app/src/main/res/drawable/app_icon.png'
screenshot_path = 'F:/hlooo/amazon tab pics/Screenshot_2026-06-25-17-14-48-259.jpeg'
out_path = 'F:/hlooo/promotional_image_pro.jpg'

def get_font(name, size):
    paths = [f'C:/Windows/Fonts/{name}.ttf', f'C:/Windows/Fonts/{name}.ttc', 'C:/Windows/Fonts/arialbd.ttf']
    for p in paths:
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def create_promo():
    bg = Image.open(bg_path).convert('RGBA')
    w, h = bg.size
    target_w = int(h * (1024/500.0))
    if target_w <= w:
        left = (w - target_w)//2
        bg = bg.crop((left, 0, left+target_w, h))
    bg = bg.resize((1024, 500), Image.Resampling.LANCZOS)
    enhancer = ImageEnhance.Brightness(bg)
    bg = enhancer.enhance(0.6)

    sc = Image.open(screenshot_path).convert('RGBA')
    sc_w, sc_h = sc.size
    new_sc_w = 460
    new_sc_h = int(sc_h * (new_sc_w / sc_w))
    sc = sc.resize((new_sc_w, new_sc_h), Image.Resampling.LANCZOS)
    
    mask = Image.new('L', sc.size, 0)
    draw_mask = ImageDraw.Draw(mask)
    draw_mask.rounded_rectangle([0, 0, new_sc_w, new_sc_h], radius=15, fill=255)
    sc.putalpha(mask)

    bezel_thickness = 10
    bez_w, bez_h = new_sc_w + bezel_thickness*2, new_sc_h + bezel_thickness*2
    device = Image.new('RGBA', (bez_w, bez_h), (0,0,0,0))
    draw_dev = ImageDraw.Draw(device)
    draw_dev.rounded_rectangle([0, 0, bez_w, bez_h], radius=20, fill=(30, 30, 30, 255), outline=(100, 100, 100, 255), width=2)
    device.paste(sc, (bezel_thickness, bezel_thickness), sc)

    device = device.rotate(6, resample=Image.Resampling.BICUBIC, expand=True)

    shadow = Image.new('RGBA', device.size, (0,0,0,0))
    shadow_draw = ImageDraw.Draw(shadow)
    alpha = device.split()[3]
    shadow_draw.bitmap((0, 0), alpha, fill=(0,0,0,180))
    shadow = shadow.filter(ImageFilter.GaussianBlur(15))

    dev_x = 520
    dev_y = (500 - device.height) // 2
    bg.paste(shadow, (dev_x + 10, dev_y + 10), shadow)
    bg.paste(device, (dev_x, dev_y), device)

    icon = Image.open(icon_path).convert('RGBA')
    icon = icon.resize((120, 120), Image.Resampling.LANCZOS)
    bg.paste(icon, (50, 40), icon)

    draw = ImageDraw.Draw(bg)
    font_title = get_font('segoeuib', 58)
    font_slogan = get_font('segoeuib', 24)
    font_body = get_font('segoeui', 22)

    draw.text((190, 65), 'GamepadOS', font=font_title, fill=(255, 255, 255, 255))
    draw.text((50, 190), 'YOUR PHONE. YOUR CONTROLLER.', font=font_slogan, fill=(0, 212, 255, 255))
    
    features = ['✓  Ultra-Low Latency Wi-Fi & USB', '✓  Customizable Gamepad Layouts', '✓  Companion PC Server Included', '✓  Smart Battery Optimization']
    y_offset = 250
    for feat in features:
        draw.text((50, y_offset), feat, font=font_body, fill=(220, 220, 220, 255))
        y_offset += 40

    bg.convert('RGB').save(out_path, 'JPEG', quality=95)
    print('Pro promo created at:', out_path)

create_promo()
