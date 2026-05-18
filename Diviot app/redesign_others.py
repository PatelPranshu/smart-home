import os

# --- ENERGY SCREEN ---
energy_file = "lib/screens/energy_screen.dart"
with open(energy_file, "r", encoding="utf-8") as f:
    energy_code = f.read()

energy_code = energy_code.replace(
    "title: Text('History & Energy', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 24)),",
    "title: Text('History & Energy', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 32, letterSpacing: -0.5)),\n        toolbarHeight: 80,"
)

old_card = """                return Card(
                  margin: EdgeInsets.only(bottom: 12),
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: isON ? Colors.green.withOpacity(0.2) : Colors.red.withOpacity(0.2),
                      child: Icon(
                        isON ? Icons.toggle_on : Icons.toggle_off,
                        color: isON ? Colors.green : Colors.red,
                      ),
                    ),
                    title: Text(item['switchName'] ?? 'Unknown Device'),
                    subtitle: Text(action),
                    trailing: Text(
                      item['timestamp'] != null 
                        ? DateTime.parse(item['timestamp']).toLocal().toString().substring(11, 16)
                        : '',
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                  ),
                );"""

new_card = """                final isDark = Theme.of(context).brightness == Brightness.dark;
                return Container(
                  margin: EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                    color: isDark ? Colors.white.withOpacity(0.1) : Colors.white.withOpacity(0.7),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: ListTile(
                    contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    leading: Container(
                      padding: EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: isON ? Colors.green.withOpacity(0.15) : Colors.red.withOpacity(0.15),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        isON ? Icons.power : Icons.power_off,
                        color: isON ? Colors.green : Colors.red,
                        size: 24,
                      ),
                    ),
                    title: Text(item['switchName'] ?? 'Unknown Device', style: TextStyle(fontWeight: FontWeight.bold, color: isDark ? Colors.white : Colors.black87)),
                    subtitle: Text(action, style: TextStyle(color: isDark ? Colors.white70 : Colors.black54)),
                    trailing: Text(
                      item['timestamp'] != null 
                        ? DateTime.parse(item['timestamp']).toLocal().toString().substring(11, 16)
                        : '',
                      style: TextStyle(fontWeight: FontWeight.bold, color: isDark ? Colors.white54 : Colors.black45),
                    ),
                  ),
                );"""

energy_code = energy_code.replace(old_card, new_card)

with open(energy_file, "w", encoding="utf-8") as f:
    f.write(energy_code)


# --- SETTINGS SCREEN ---
settings_file = "lib/screens/settings_screen.dart"
with open(settings_file, "r", encoding="utf-8") as f:
    settings_code = f.read()

settings_code = settings_code.replace(
    "title: Text('Settings', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 28)),",
    "title: Text('Settings', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 32, letterSpacing: -0.5)),\n        toolbarHeight: 80,"
)

settings_code = settings_code.replace(
    "color: (Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade900.withOpacity(0.85) : Colors.white.withOpacity(0.9)),",
    "color: (Theme.of(context).brightness == Brightness.dark ? Colors.white.withOpacity(0.1) : Colors.white.withOpacity(0.7)),"
)
settings_code = settings_code.replace(
    "color: Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade900.withOpacity(0.9) : Colors.white.withOpacity(0.95)",
    "color: Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade900 : Colors.white"
)

# Replace dividers to be softer
settings_code = settings_code.replace("Divider(height: 1, color: Colors.grey.shade200)", "Divider(height: 1, color: Colors.grey.withOpacity(0.2))")

with open(settings_file, "w", encoding="utf-8") as f:
    f.write(settings_code)

print("Redesigned Energy and Settings screens")
