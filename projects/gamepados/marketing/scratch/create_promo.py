from PIL import Image, ImageFilter, ImageDraw, ImageEnhance
import glob
import math

def create_promo():
    # Settings
    promo_size = (1024, 500)
    icon_path = 'F:/hlooo/apps/android-client/app/src/main/res/drawable/app_icon.png'
    landscape_pics = glob.glob('F:/hlooo/amazon tab pics/*1920*.jpeg') # wait, 1920 is in size, filenames just have timestamps.
    # We know the last two are landscape from earlier check
    pic_bg = 'F:/hlooo/amazon tab pics/Screenshot_2026-06-25-17-13-40-778.jpeg'
    pic_fg = 'F:/hlooo/amazon tab pics/Screenshot_2026-06-25-17-14-48-259.jpeg'

    # 1. Create Base with blurred background
    bg = Image.open(pic_bg).convert('RGBA')
    # crop bg to aspect ratio of 1024/500 = 2.048
    w, h = bg.size
    target_w = int(h * (1024/500.0))
    left = (w - target_w)//2
    bg = bg.crop((left, 0, left+target_w, h))
    bg = bg.resize(promo_size, Image.Resampling.LANCZOS)
    bg = bg.filter(ImageFilter.GaussianBlur(15))
    # Darken background
    enhancer = ImageEnhance.Brightness(bg)
    bg = enhancer.enhance(0.4)

    # 2. Add Logo on the left
    icon = Image.open(icon_path).convert('RGBA')
    icon = icon.resize((300, 300), Image.Resampling.LANCZOS)
    bg.paste(icon, (100, 100), icon)

    # 3. Add foreground screenshot on the right
    fg = Image.open(pic_fg).convert('RGBA')
    fg.thumbnail((500, 500), Image.Resampling.LANCZOS)
    fw, fh = fg.size
    # Draw a white border around it
    border = 6
    border_img = Image.new('RGBA', (fw + border*2, fh + border*2), (255, 255, 255, 255))
    border_img.paste(fg, (border, border))
    
    # Add a drop shadow to the border_img
    shadow = Image.new('RGBA', (fw + border*2 + 20, fh + border*2 + 20), (0,0,0,0))
    draw = ImageDraw.Draw(shadow)
    draw.rectangle([10, 10, fw+border*2+10, fh+border*2+10], fill=(0,0,0,150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))
    shadow.paste(border_img, (0, 0), border_img)

    # Paste onto right side
    paste_x = 480
    paste_y = (500 - shadow.height) // 2
    bg.paste(shadow, (paste_x, paste_y), shadow)

    # Save the result
    bg.convert('RGB').save('F:/hlooo/promotional_image.jpg', 'JPEG', quality=95)
    print('Promo created!')

create_promo()
