import os

# Fix home_screen.dart
home_file = "lib/screens/home_screen.dart"
with open(home_file, "r", encoding="utf-8") as f:
    home_code = f.read()

home_code = home_code.replace(
    "padding: EdgeInsets.all(20),",
    "padding: EdgeInsets.fromLTRB(20, 20, 20, 120),"
)

with open(home_file, "w", encoding="utf-8") as f:
    f.write(home_code)


# Fix energy_screen.dart
energy_file = "lib/screens/energy_screen.dart"
with open(energy_file, "r", encoding="utf-8") as f:
    energy_code = f.read()

energy_code = energy_code.replace(
    "padding: EdgeInsets.all(16),",
    "padding: EdgeInsets.fromLTRB(16, 16, 16, 120),"
)

with open(energy_file, "w", encoding="utf-8") as f:
    f.write(energy_code)

print("fixed bottom padding")
