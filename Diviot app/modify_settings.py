import os
import re

file_path = "lib/screens/settings_screen.dart"

with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

# Add ApiService
code = code.replace(
    "class _SettingsScreenState extends State<SettingsScreen> {",
    """class _SettingsScreenState extends State<SettingsScreen> {
  final _apiService = ApiService();
  final _titleController = TextEditingController();
  final _espCodeController = TextEditingController();
  final _newPassController = TextEditingController();
  final _deviceIdController = TextEditingController();
  final _secretCodeController = TextEditingController();
  final _verifyPassController = TextEditingController();
  final _wifiSsidController = TextEditingController();
  final _wifiPassController = TextEditingController();
  
  @override
  void initState() {
    super.initState();
    _loadSettings();
  }
  
  Future<void> _loadSettings() async {
    try {
      final googleData = await _apiService.getGoogleStatus();
      final prefData = await _apiService.getUpdatePreference();
      if (mounted) {
        setState(() {
          _googleHome = googleData['enabled'] ?? false;
          _autoUpdate = (prefData['preference'] == 'auto');
        });
      }
    } catch (e) {}
  }
  
  @override
  void dispose() {
    _titleController.dispose();
    _espCodeController.dispose();
    _newPassController.dispose();
    _deviceIdController.dispose();
    _secretCodeController.dispose();
    _verifyPassController.dispose();
    _wifiSsidController.dispose();
    _wifiPassController.dispose();
    super.dispose();
  }
"""
)

# Replace _showChangePasswordModal
code = code.replace(
"""  void _showChangePasswordModal() {
    _showModal(
      'Security Check',
      'Please enter the unique code printed on your ESP32 device to prove ownership.',
      [
        TextField(decoration: InputDecoration(hintText: 'Enter ESP32 Code', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
      ],
      ElevatedButton(
        onPressed: () {
          Navigator.pop(context);
          _showModal('New Password', '', [
            TextField(obscureText: true, decoration: InputDecoration(hintText: 'New Password', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
          ], ElevatedButton(onPressed: () { 
            Navigator.pop(context);
            showToast(context, 'Password updated successfully!');
          }, child: Text('Update'), style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white)));
        },
        child: Text('Verify'),
        style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white),
      ),
    );
  }""",
"""  void _showChangePasswordModal() {
    _espCodeController.clear();
    _showModal(
      'Security Check',
      'Please enter the unique code printed on your ESP32 device to prove ownership.',
      [
        TextField(controller: _espCodeController, decoration: InputDecoration(hintText: 'Enter ESP32 Code', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
      ],
      ElevatedButton(
        onPressed: () async {
          try {
            await _apiService.verifyCode(_espCodeController.text);
            Navigator.pop(context);
            _newPassController.clear();
            _showModal('New Password', '', [
              TextField(controller: _newPassController, obscureText: true, decoration: InputDecoration(hintText: 'New Password', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
            ], ElevatedButton(onPressed: () async { 
              try {
                await _apiService.updateUser({'password': _newPassController.text});
                Navigator.pop(context);
                showToast(context, 'Password updated successfully!');
                await Provider.of<AuthProvider>(context, listen: false).logout();
                Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => LoginScreen()));
              } catch(e) {
                showToast(context, e.toString().replaceAll('Exception: ', ''), isError: true);
              }
            }, child: Text('Update'), style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white)));
          } catch(e) {
            showToast(context, e.toString().replaceAll('Exception: ', ''), isError: true);
          }
        },
        child: Text('Verify'),
        style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white),
      ),
    );
  }"""
)

# Replace _showAddDeviceModal
code = code.replace(
"""  void _showAddDeviceModal() {
    _showModal(
      'Add Device',
      'Enter the details found on the device sticker.',
      [
        Text('Device ID', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
        SizedBox(height: 4),
        TextField(decoration: InputDecoration(hintText: 'e.g. esp32_C0...', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
        SizedBox(height: 12),
        Text('Secret Code', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
        SizedBox(height: 4),
        TextField(decoration: InputDecoration(hintText: 'e.g. 123456', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
      ],
      ElevatedButton(
        onPressed: () {
          Navigator.pop(context);
          showToast(context, 'Device added successfully!');
        },
        child: Text('Add Device'),
        style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white),
      ),
    );
  }""",
"""  void _showAddDeviceModal() {
    _deviceIdController.clear();
    _secretCodeController.clear();
    _showModal(
      'Add Device',
      'Enter the details found on the device sticker.',
      [
        Text('Device ID', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
        SizedBox(height: 4),
        TextField(controller: _deviceIdController, decoration: InputDecoration(hintText: 'e.g. esp32_C0...', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
        SizedBox(height: 12),
        Text('Secret Code', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
        SizedBox(height: 4),
        TextField(controller: _secretCodeController, decoration: InputDecoration(hintText: 'e.g. 123456', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
      ],
      ElevatedButton(
        onPressed: () async {
          try {
            await _apiService.claimDevice(_deviceIdController.text, _secretCodeController.text);
            Navigator.pop(context);
            showToast(context, 'Device added successfully!');
            Provider.of<DeviceProvider>(context, listen: false).fetchDevices();
          } catch(e) {
            showToast(context, e.toString().replaceAll('Exception: ', ''), isError: true);
          }
        },
        child: Text('Add Device'),
        style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white),
      ),
    );
  }"""
)

# Replace _showWifiModal
code = code.replace(
"""  void _showWifiModal() {
    _showModal(
      'Verify Identity',
      'Enter your login password to access Wi-Fi settings.',
      [
        TextField(obscureText: true, decoration: InputDecoration(hintText: 'Your Password', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
      ],
      ElevatedButton(
        onPressed: () {
          Navigator.pop(context);
          _showModal('Update Wi-Fi', '', [
            TextField(decoration: InputDecoration(hintText: 'New Wi-Fi Name', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
            SizedBox(height: 12),
            TextField(obscureText: true, decoration: InputDecoration(hintText: 'New Wi-Fi Password', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
          ], ElevatedButton(onPressed: () {
            Navigator.pop(context);
            showToast(context, 'Wi-Fi settings sent to device!');
          }, child: Text('Update Device'), style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white)));
        },
        child: Text('Verify'),
        style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white),
      ),
    );
  }""",
"""  void _showWifiModal() {
    _verifyPassController.clear();
    _showModal(
      'Verify Identity',
      'Enter your login password to access Wi-Fi settings.',
      [
        TextField(controller: _verifyPassController, obscureText: true, decoration: InputDecoration(hintText: 'Your Password', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
      ],
      ElevatedButton(
        onPressed: () async {
          try {
            await _apiService.verifyPassword(_verifyPassController.text);
            Navigator.pop(context);
            _wifiSsidController.clear();
            _wifiPassController.clear();
            _showModal('Update Wi-Fi', 'Note: Device ID must match existing.', [
              TextField(controller: _deviceIdController, decoration: InputDecoration(hintText: 'Device ID', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
              SizedBox(height: 12),
              TextField(controller: _wifiSsidController, decoration: InputDecoration(hintText: 'New Wi-Fi Name', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
              SizedBox(height: 12),
              TextField(controller: _wifiPassController, obscureText: true, decoration: InputDecoration(hintText: 'New Wi-Fi Password', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
            ], ElevatedButton(onPressed: () async {
              try {
                await _apiService.setWifiConfig(_deviceIdController.text, _wifiSsidController.text, _wifiPassController.text);
                Navigator.pop(context);
                showToast(context, 'Wi-Fi settings sent to device!');
              } catch(e) {
                showToast(context, e.toString().replaceAll('Exception: ', ''), isError: true);
              }
            }, child: Text('Update Device'), style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white)));
          } catch(e) {
            showToast(context, e.toString().replaceAll('Exception: ', ''), isError: true);
          }
        },
        child: Text('Verify'),
        style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white),
      ),
    );
  }"""
)


# Modify Update Title Handler
code = code.replace(
"""                      child: TextField(
                        decoration: InputDecoration(
                          hintText: 'My Home',
                          filled: true,
                          fillColor: Colors.grey.shade100,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: BorderSide.none,
                          ),
                          contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 0),
                        ),
                      ),
                    ),
                    SizedBox(width: 8),
                    ElevatedButton(
                      onPressed: () {
                        showToast(context, 'Dashboard title saved!');
                      },""",
"""                      child: TextField(
                        controller: _titleController,
                        decoration: InputDecoration(
                          hintText: 'My Home',
                          filled: true,
                          fillColor: Colors.grey.shade100,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: BorderSide.none,
                          ),
                          contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 0),
                        ),
                      ),
                    ),
                    SizedBox(width: 8),
                    ElevatedButton(
                      onPressed: () async {
                        try {
                          await _apiService.updateUser({'homeTitle': _titleController.text});
                          showToast(context, 'Dashboard title saved!');
                        } catch(e) {
                          showToast(context, 'Failed to save title', isError: true);
                        }
                      },"""
)

# Modifying switches
code = code.replace(
"""                  onChanged: (val) => setState(() => _autoUpdate = val),""",
"""                  onChanged: (val) async {
                    try {
                      await _apiService.setUpdatePreference(val ? 'auto' : 'manual');
                      setState(() => _autoUpdate = val);
                      showToast(context, val ? 'Auto updates enabled' : 'Auto updates disabled');
                    } catch(e) {
                      showToast(context, 'Failed to update preference', isError: true);
                    }
                  },"""
)

code = code.replace(
"""                  onChanged: (val) => setState(() => _googleHome = val),""",
"""                  onChanged: (val) async {
                    try {
                      await _apiService.setGoogleStatus(val);
                      setState(() => _googleHome = val);
                      showToast(context, val ? 'Google Home enabled' : 'Google Home disabled');
                    } catch(e) {
                      showToast(context, 'Failed to update Google Home status', isError: true);
                    }
                  },"""
)

code = code.replace(
"""import '../utils/ui_utils.dart';""",
"""import '../utils/ui_utils.dart';
import '../services/api_service.dart';
import '../providers/device_provider.dart';"""
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Updated Settings Screen with API hooks.")
