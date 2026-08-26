import sys
import os
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

def process_screenshot_for_uptodown(image_path, add_canvas=True):
    if not os.path.exists(image_path):
        print(f"File not found: {image_path}")
        return
    
    img = Image.open(image_path).convert("RGBA")
    w, h = img.size
    
    # 1. Apply iPhone rounded corner mask
    short_dim = min(w, h)
    iphone_radius = int(short_dim * 0.082)
    
    scale = 2
    w_s, h_s = w * scale, h * scale
    r_s = iphone_radius * scale
    
    mask = Image.new("L", (w_s, h_s), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, w_s, h_s), radius=r_s, fill=255)
    mask = mask.resize((w, h), Image.Resampling.LANCZOS)
    
    img.putalpha(mask)
    
    if add_canvas:
        # Create standard aspect ratio canvas (e.g. 1080x2400 or padded 9:16) with subtle backdrop shadow
        # This prevents Uptodown from destroying transparent corners when auto-converting to JPEG!
        pad = int(w * 0.06)
        canvas_w = w + (pad * 2)
        canvas_h = h + (pad * 2)
        
        # Soft dark background or solid background
        canvas = Image.new("RGBA", (canvas_w, canvas_h), (18, 24, 38, 255))
        
        # Add subtle drop shadow under screenshot
        shadow_mask = Image.new("L", (w, h), 0)
        shadow_draw = ImageDraw.Draw(shadow_mask)
        shadow_draw.rounded_rectangle((0, 0, w, h), radius=iphone_radius, fill=160)
        shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(radius=25))
        
        shadow = Image.new("RGBA", (w, h), (0, 0, 0, 255))
        shadow.putalpha(shadow_mask)
        
        canvas.paste(shadow, (pad, pad + 10), shadow)
        canvas.paste(img, (pad, pad), img)
        
        final_img = canvas.convert("RGB")
    else:
        final_img = img

    # 2. Sharpen slightly so text stays crystal clear after Uptodown CDN re-compression
    enhancer = ImageEnhance.Sharpness(final_img)
    final_img = enhancer.enhance(1.4)  # 40% sharp boost for crisp text
    
    # Save optimized PNG
    final_img.save(image_path, "PNG", optimize=True)
    print(f"Uptodown-optimized sharp screenshot saved to {image_path}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        process_screenshot_for_uptodown(sys.argv[1])
