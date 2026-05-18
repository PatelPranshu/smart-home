import re

file_path = "lib/services/api_service.dart"

with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

# Fix the double await issue: `await _intercept(await http.post` -> `await _intercept(http.post`
code = code.replace("await _intercept(await http.post(", "await _intercept(http.post(")
code = code.replace("await _intercept(await http.get(", "await _intercept(http.get(")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
