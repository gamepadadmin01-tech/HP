import os
import glob
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

def build_stacked_promo(screenshot_dir=r"D:\AKHIL\HP\projects\gamepados\Screenshots", output_path=r"D:\AKHIL\HP\projects\gamepados\Screenshots\5_stacked_promo.png"):
    # Find available screenshot files 1.png, 2.png, etc.
    png_files = sorted(glob.glob(os.path.join(screenshot_dir, "[0-9]*.png")))
    if not png_files:
        print("No screenshots found.")
        return
    
    # Load up to 3-4 screenshots
    imgs = [Image.open(f).convert("RGBA") for f in png_files[:4]]
    
    # Create canvas (e.g. 1920x1080 landscape or 2400x1350)
    canvas_w, canvas_h = 2400, 1350
    
    # Premium subtle gradient background (dark slate blue to charcoal, NO neon)
    bg = Image.new("RGBA", (canvas_w, canvas_h), (16, 22, 34, 255))
    draw = ImageDraw.Draw(bg)
    
    # Add subtle background lighting gradient
    for y in range(canvas_h):
        r = int(16 + (y / canvas_h) * 12)
        g = int(22 + (y / canvas_h) * 14)
        b = int(34 + (y / canvas_h) * 18)
        draw.line([(0, y), (canvas_w, y)], fill=(r, g, b, 255))
        
    # Scale screenshots down for layout fit
    target_h = int(canvas_h * 0.75)
    scaled_imgs = []
    for img in imgs:
        aspect = img.width / img.height
        w = int(target_h * aspect)
        scaled_imgs.append(img.resize((w, target_h), Image.Resampling.LANCZOS))
    
    # Angles and offsets for crossing/stacked effect
    placements = [
        {"angle": -14, "pos": (int(canvas_w * 0.15), int(canvas_h * 0.12))},
        {"angle": 12,  "pos": (int(canvas_w * 0.40), int(canvas_h * 0.10))},
        {"angle": -8,  "pos": (int(canvas_w * 0.65), int(canvas_h * 0.15))},
    ]
    
    for idx, s_img in enumerate(scaled_imgs[:3]):
        p = placements[idx]
        angle = p["angle"]
        x, y = p["pos"]
        
        # Rotate image with expansion for clean edges
        rotated = s_img.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
        
        # Create smooth drop shadow
        shadow_mask = Image.new("L", rotated.size, 0)
        # Extract alpha from rotated image as shadow shape
        if "A" in rotated.mode:
            shadow_mask = rotated.split()[3]
        
        shadow_blur = shadow_mask.filter(ImageFilter.GaussianBlur(radius=30))
        shadow = Image.new("RGBA", rotated.size, (0, 0, 0, 180))
        shadow.putalpha(shadow_blur)
        
        # Paste shadow offset
        bg.paste(shadow, (x + 15, y + 25), shadow)
        # Paste rotated screenshot
        bg.paste(rotated, (x, y), rotated)
        
    bg = bg.convert("RGB")
    bg.save(output_path, "PNG", optimize=True)
    print(f"Stacked promotional layout generated successfully at {output_path}")

if __name__ == "__main__":
    build_stacked_promo()
