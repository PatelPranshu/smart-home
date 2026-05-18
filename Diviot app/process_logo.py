import os
from PIL import Image, ImageOps

def process_logo():
    logo_path = 'assets/images/logo.png'
    if not os.path.exists(logo_path):
        print(f"Error: {logo_path} does not exist!")
        return

    print("Opening logo.png...")
    img = Image.open(logo_path).convert('RGBA')
    width, height = img.size
    print(f"Original dimensions: {width}x{height}")

    # 1. Generate Foreground with safe padding (for Android Adaptive Foreground)
    # The adaptive safe zone is the center 60-70% of a 512x512 canvas.
    canvas_size = 512
    fg_canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    
    # Calculate scale to make logo occupy 60% of the canvas
    scale = (canvas_size * 0.60) / max(width, height)
    new_w = int(width * scale)
    new_h = int(height * scale)
    
    resized_logo = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Center the resized logo on the transparent canvas
    x = (canvas_size - new_w) // 2
    y = (canvas_size - new_h) // 2
    fg_canvas.paste(resized_logo, (x, y), resized_logo)
    fg_canvas.save('assets/images/logo_foreground.png', 'PNG')
    print("Saved logo_foreground.png successfully with 40% transparent padding safety margins!")

    # 2. Generate Monochrome Mask for Android 13+ Themed Icons
    # The themed icon requires an alpha channel image where the colored shapes are solid black/white
    # and the rest is fully transparent.
    mono_canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    
    # Get pixel data of the foreground canvas
    pixels = fg_canvas.load()
    mono_pixels = mono_canvas.load()
    
    for py in range(canvas_size):
        for px in range(canvas_size):
            r, g, b, a = pixels[px, py]
            if a > 30: # If the pixel is not transparent
                # Convert the logo shape into solid black with original transparency values
                mono_pixels[px, py] = (0, 0, 0, a)
                
    mono_canvas.save('assets/images/logo_monochrome.png', 'PNG')
    print("Saved logo_monochrome.png mask for dynamic Android theme-matching!")

    # 3. Generate iOS Solid launcher icon
    # iOS does not allow transparent icons, so we place the padded logo on a solid premium dark background
    ios_canvas = Image.new('RGBA', (canvas_size, canvas_size), (10, 13, 20, 255)) # Matching smart home dark color #0A0D14
    ios_canvas.paste(resized_logo, (x, y), resized_logo)
    ios_canvas.save('assets/images/logo_ios.png', 'PNG')
    print("Saved logo_ios.png for premium iOS presentation!")

    # 4. Copy monochrome mask to Android resource folders
    res_path = 'android/app/src/main/res'
    drawables = [
        'drawable',
        'drawable-hdpi',
        'drawable-mdpi',
        'drawable-xhdpi',
        'drawable-xxhdpi',
        'drawable-xxxhdpi'
    ]
    
    import shutil
    for folder in drawables:
        folder_path = os.path.join(res_path, folder)
        if os.path.exists(folder_path):
            dest_file = os.path.join(folder_path, 'ic_launcher_monochrome.png')
            shutil.copyfile('assets/images/logo_monochrome.png', dest_file)
            print(f"Copied monochrome mask to: {dest_file}")
            
    # 5. Inject monochrome tag into launcher_icon.xml
    xml_path = os.path.join(res_path, 'mipmap-anydpi-v26/launcher_icon.xml')
    if os.path.exists(xml_path):
        with open(xml_path, 'r') as f:
            xml_content = f.read()
            
        if '<monochrome' not in xml_content:
            # We insert the monochrome drawable before the closing adaptive-icon tag
            monochrome_tag = '  <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>\n'
            updated_content = xml_content.replace('</adaptive-icon>', monochrome_tag + '</adaptive-icon>')
            
            with open(xml_path, 'w') as f:
                f.write(updated_content)
            print("Successfully injected <monochrome> themed icons tag into launcher_icon.xml!")

if __name__ == '__main__':
    process_logo()
