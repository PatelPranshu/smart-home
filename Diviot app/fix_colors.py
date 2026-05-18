import os
import re

files = [
    "lib/screens/home_screen.dart",
    "lib/screens/settings_screen.dart",
    "lib/screens/energy_screen.dart"
]

def fix_content(content):
    # Fix Card colors
    content = content.replace(
        "Colors.white.withOpacity(0.9)", 
        "(Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade900.withOpacity(0.85) : Colors.white.withOpacity(0.9))"
    )
    content = content.replace(
        "Colors.white.withOpacity(0.95)", 
        "(Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade900.withOpacity(0.9) : Colors.white.withOpacity(0.95))"
    )
    
    # Fix explicitly hardcoded text colors that conflict
    content = content.replace(
        "color: Colors.black87", 
        "color: Theme.of(context).brightness == Brightness.dark ? Colors.white : Colors.black87"
    )
    content = content.replace(
        "color: Colors.black", 
        "color: Theme.of(context).brightness == Brightness.dark ? Colors.white : Colors.black"
    )
    content = content.replace(
        "color: Colors.grey.shade800",
        "color: Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade300 : Colors.grey.shade800"
    )
    content = content.replace(
        "color: Colors.grey.shade700",
        "color: Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade400 : Colors.grey.shade700"
    )
    content = content.replace(
        "color: Colors.grey[800]",
        "color: Theme.of(context).brightness == Brightness.dark ? Colors.grey[300] : Colors.grey[800]"
    )
    content = content.replace(
        "color: Colors.grey[700]",
        "color: Theme.of(context).brightness == Brightness.dark ? Colors.grey[400] : Colors.grey[700]"
    )
    content = content.replace(
        "color: Colors.grey[600]",
        "color: Theme.of(context).brightness == Brightness.dark ? Colors.grey[400] : Colors.grey[600]"
    )

    # Specific fixes for textfields and borders
    content = content.replace(
        "fillColor: Colors.grey.shade100",
        "fillColor: Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade800 : Colors.grey.shade100"
    )
    content = content.replace(
        "backgroundColor: Colors.white",
        "backgroundColor: Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade800 : Colors.white"
    )

    return content

for file_path in files:
    if not os.path.exists(file_path):
        continue
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    new_content = fix_content(content)
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

print("Colors fixed for dark mode compatibility.")
