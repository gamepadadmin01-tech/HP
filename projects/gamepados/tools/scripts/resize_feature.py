from PIL import Image

input_path = r"C:\Users\akhil\.gemini\antigravity\brain\9af58557-79a9-49b7-bdf6-f53c1d58a714\gamepados_ultra_realistic_1783510721239.png"
output_path = r"F:\hlooo\gamepados_feature_1024x500.png"
target_width = 1024
target_height = 500

try:
    img = Image.open(input_path)
    img_ratio = img.width / img.height
    target_ratio = target_width / target_height

    if img_ratio > target_ratio:
        # Image is wider than target ratio
        new_width = int(target_ratio * img.height)
        offset = (img.width - new_width) // 2
        img = img.crop((offset, 0, offset + new_width, img.height))
    elif img_ratio < target_ratio:
        # Image is taller than target ratio
        new_height = int(img.width / target_ratio)
        offset = (img.height - new_height) // 2
        img = img.crop((0, offset, img.width, offset + new_height))

    img = img.resize((target_width, target_height), Image.Resampling.LANCZOS)
    
    # Save as PNG
    img.save(output_path, "PNG")
    print(f"Successfully created {output_path} with size {img.size}")
except Exception as e:
    print(f"Error: {e}")
