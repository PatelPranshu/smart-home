import os

energy_file = "lib/screens/energy_screen.dart"
with open(energy_file, "r", encoding="utf-8") as f:
    energy_code = f.read()

energy_code = energy_code.replace(
    "setState(() {\n        _history = data;\n        _isLoading = false;\n      });",
    "if (mounted) {\n        setState(() {\n          _history = data;\n          _isLoading = false;\n        });\n      }"
)
energy_code = energy_code.replace(
    "setState(() => _isLoading = false);",
    "if (mounted) setState(() => _isLoading = false);"
)

with open(energy_file, "w", encoding="utf-8") as f:
    f.write(energy_code)
print("fixed mounted state bug")
