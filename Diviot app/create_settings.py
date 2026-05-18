import os

file_path = "lib/screens/settings_screen.dart"
code = """import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/device_provider.dart';
import '../providers/server_provider.dart';
import 'login_screen.dart';
import '../utils/ui_utils.dart';
import '../services/api_service.dart';

class SettingsScreen extends StatefulWidget {
  @override
  _SettingsScreenState createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _apiService = ApiService();
  final _titleController = TextEditingController();
  final _espCodeController = TextEditingController();
  final _newPassController = TextEditingController();
  final _deviceIdController = TextEditingController();
  final _secretCodeController = TextEditingController();
  final _verifyPassController = TextEditingController();
  final _wifiSsidController = TextEditingController();
  final _wifiPassController = TextEditingController();
  final _removePassController = TextEditingController();
  
  bool _autoUpdate = true;
  bool _googleHome = false;
  bool _isGoogleLinked = false;
  
  Timer? _pollingTimer;
  String? _selectedWifiDevice;

  @override
  void initState() {
    super.initState();
    _loadSettings();
    _pollingTimer = Timer.periodic(Duration(seconds: 3), (timer) {
      Provider.of<DeviceProvider>(context, listen: false).fetchDevices();
    });
  }
  
  Future<void> _loadSettings() async {
    try {
      final googleData = await _apiService.getGoogleStatus();
      final prefData = await _apiService.getUpdatePreference();
      // Fetch user profile for home title (mocking or real if exists)
      // Note: We don't have getProfile in ApiService yet, assuming it works or fallback
      if (mounted) {
        setState(() {
          _isGoogleLinked = googleData['isLinked'] ?? false;
          _googleHome = googleData['enabled'] ?? false;
          _autoUpdate = (prefData['preference'] == 'auto');
        });
      }
    } catch (e) {}
  }
  
  @override
  void dispose() {
    _pollingTimer?.cancel();
    _titleController.dispose();
    _espCodeController.dispose();
    _newPassController.dispose();
    _deviceIdController.dispose();
    _secretCodeController.dispose();
    _verifyPassController.dispose();
    _wifiSsidController.dispose();
    _wifiPassController.dispose();
    _removePassController.dispose();
    super.dispose();
  }

  void _showModal(String title, String subtitle, List<Widget> content, Widget actionButton) {
    showDialog(
      context: context,
      barrierColor: Colors.black54,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white.withOpacity(0.95),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: TextStyle(fontWeight: FontWeight.bold)),
            if (subtitle.isNotEmpty) ...[
              SizedBox(height: 8),
              Text(subtitle, style: TextStyle(fontSize: 14, color: Colors.grey.shade700)),
            ]
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Divider(color: Colors.grey.shade300),
            SizedBox(height: 12),
            ...content,
          ],
        ),
        actions: [
          TextButton(
            child: Text('Cancel', style: TextStyle(color: Colors.grey)),
            onPressed: () => Navigator.pop(ctx),
          ),
          actionButton,
        ],
      ),
    );
  }

  void _showLogoutModal(AuthProvider auth) {
    showDialog(
      context: context,
      barrierColor: Colors.black54,
      builder: (ctx) => AlertDialog(
        backgroundColor: Colors.white.withOpacity(0.95),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: Text('Logout Options', style: TextStyle(fontWeight: FontWeight.bold)),
        content: Text('Would you like to log out of only this device or all devices currently logged in?'),
        actions: [
          TextButton(
            child: Text('Cancel', style: TextStyle(color: Colors.grey)),
            onPressed: () => Navigator.pop(ctx),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              await auth.logout();
              Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => LoginScreen()));
            },
            child: Text('Log Out Only This Device'),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.amber, foregroundColor: Colors.white),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              await _apiService.logoutAll();
              Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => LoginScreen()));
            },
            child: Text('Log Out From All Devices'),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white),
          ),
        ],
      ),
    );
  }

  void _showChangePasswordModal() {
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
  }

  void _showAddDeviceModal() {
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
  }

  void _showWifiModal() {
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
            
            final devices = Provider.of<DeviceProvider>(context, listen: false).devices;
            if (devices.isEmpty) {
              showToast(context, 'No devices found to configure', isError: true);
              return;
            }
            _selectedWifiDevice = devices.first.deviceId;

            _showModal('Update Wi-Fi', 'Select device and enter new credentials.', [
              StatefulBuilder(
                builder: (context, setModalState) {
                  return DropdownButtonFormField<String>(
                    value: _selectedWifiDevice,
                    decoration: InputDecoration(
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                      contentPadding: EdgeInsets.symmetric(horizontal: 16),
                    ),
                    items: devices.map((d) => DropdownMenuItem(value: d.deviceId, child: Text(d.deviceId))).toList(),
                    onChanged: (val) {
                      if (val != null) setModalState(() => _selectedWifiDevice = val);
                    },
                  );
                },
              ),
              SizedBox(height: 12),
              TextField(controller: _wifiSsidController, decoration: InputDecoration(hintText: 'New Wi-Fi Name', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
              SizedBox(height: 12),
              TextField(controller: _wifiPassController, obscureText: true, decoration: InputDecoration(hintText: 'New Wi-Fi Password', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
            ], ElevatedButton(onPressed: () async {
              if (_wifiPassController.text.length < 8) {
                showToast(context, 'Password too short', isError: true);
                return;
              }
              showToast(context, 'Sending configuration... Device will restart shortly.');
              try {
                await _apiService.setWifiConfig(_selectedWifiDevice!, _wifiSsidController.text, _wifiPassController.text);
                Future.delayed(Duration(seconds: 1), () {
                  Navigator.pop(context);
                  showToast(context, 'Wi-Fi settings sent to device!');
                });
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
  }

  void _showRemoveDeviceModal(String deviceId) {
    _removePassController.clear();
    _showModal(
      'Remove Device',
      'Enter your login password to confirm removing $deviceId.',
      [
        TextField(controller: _removePassController, obscureText: true, decoration: InputDecoration(hintText: 'Your Password', border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)))),
      ],
      ElevatedButton(
        onPressed: () async {
          try {
            await _apiService.verifyPassword(_removePassController.text);
            await _apiService.removeDevice(deviceId);
            Navigator.pop(context);
            showToast(context, 'Device removed successfully!');
            Provider.of<DeviceProvider>(context, listen: false).fetchDevices();
          } catch(e) {
            showToast(context, e.toString().replaceAll('Exception: ', ''), isError: true);
          }
        },
        child: Text('Remove'),
        style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white),
      ),
    );
  }

  Widget _buildGroupTitle(String title) {
    return Padding(
      padding: EdgeInsets.only(left: 12, bottom: 8, top: 24),
      child: Text(
        title,
        style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
      ),
    );
  }

  Widget _buildCardContainer({required List<Widget> children}) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.95),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: Offset(0, 4),
          )
        ]
      ),
      child: Column(
        children: children,
      ),
    );
  }

  Widget _buildListTile({
    required IconData icon,
    required Color iconColor,
    required String title,
    String? subtitle,
    Widget? trailing,
    VoidCallback? onTap,
  }) {
    return ListTile(
      leading: Container(
        padding: EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: iconColor.withOpacity(0.15),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(icon, color: iconColor, size: 24),
      ),
      title: Text(title, style: TextStyle(fontWeight: FontWeight.bold, color: Colors.black87, fontSize: 15)),
      subtitle: subtitle != null ? Text(subtitle, style: TextStyle(color: Colors.grey.shade700, fontSize: 12)) : null,
      trailing: trailing ?? (onTap != null ? Icon(Icons.chevron_right, color: Colors.grey) : null),
      onTap: onTap,
    );
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final deviceProvider = Provider.of<DeviceProvider>(context);
    final serverProvider = Provider.of<ServerProvider>(context);
    
    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text('Settings', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 28)),
        actions: [
          GestureDetector(
            onTapDown: (_) {},
            onTapUp: (_) => _showLogoutModal(authProvider),
            child: AnimatedContainer(
              duration: Duration(milliseconds: 100),
              margin: EdgeInsets.only(right: 16),
              padding: EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 4)]
              ),
              child: Icon(Icons.power_settings_new, color: Colors.redAccent, size: 20),
            ),
          )
        ],
      ),
      body: Stack(
        children: [
          ListView(
            padding: EdgeInsets.fromLTRB(16, serverProvider.isReverting ? 40 : 0, 16, 100),
            children: [
              _buildGroupTitle('Account'),
              _buildCardContainer(
                children: [
                  _buildListTile(
                    icon: Icons.person,
                    iconColor: Colors.blue,
                    title: authProvider.email ?? 'Loading...',
                    subtitle: 'User',
                  ),
                  Divider(height: 1, color: Colors.grey.shade200),
                  _buildListTile(
                    icon: Icons.lock,
                    iconColor: Colors.grey,
                    title: 'Change Account Password',
                    onTap: _showChangePasswordModal,
                  ),
                  Divider(height: 1, color: Colors.grey.shade200),
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
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
                            if (_titleController.text.isEmpty) {
                              showToast(context, 'Title cannot be empty', isError: true);
                              return;
                            }
                            try {
                              await _apiService.updateUser({'homeTitle': _titleController.text});
                              showToast(context, 'Dashboard title saved!');
                            } catch(e) {
                              showToast(context, 'Failed to save title', isError: true);
                            }
                          },
                          child: Text('Save'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.blue, 
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            padding: EdgeInsets.symmetric(horizontal: 20, vertical: 12)
                          ),
                        )
                      ],
                    ),
                  ),
                ],
              ),

              _buildGroupTitle('System'),
              _buildCardContainer(
                children: [
                  _buildListTile(
                    icon: Icons.cloud_download,
                    iconColor: Colors.green,
                    title: 'Automatic Updates',
                    subtitle: _autoUpdate ? 'Background silent updates' : 'You will be notified when updates are available',
                    trailing: Switch(
                      value: _autoUpdate,
                      onChanged: (val) async {
                        try {
                          await _apiService.setUpdatePreference(val ? 'auto' : 'manual');
                          setState(() => _autoUpdate = val);
                          showToast(context, val ? 'Auto updates enabled' : 'Auto updates disabled');
                        } catch(e) {
                          showToast(context, 'Failed to update preference', isError: true);
                        }
                      },
                      activeColor: Colors.green,
                    ),
                  ),
                  if (_isGoogleLinked) ...[
                    Divider(height: 1, color: Colors.grey.shade200),
                    _buildListTile(
                      icon: Icons.home_work,
                      iconColor: Colors.blue,
                      title: 'Google Home Access',
                      trailing: Switch(
                        value: _googleHome,
                        onChanged: (val) async {
                          try {
                            await _apiService.setGoogleStatus(val);
                            setState(() => _googleHome = val);
                            showToast(context, val ? 'Google Home Enabled' : 'Google Home Disabled');
                          } catch(e) {
                            showToast(context, 'Failed to update Google Home status', isError: true);
                          }
                        },
                        activeColor: Colors.blue,
                      ),
                    ),
                  ],
                ],
              ),

              _buildGroupTitle('Device Management'),
              _buildCardContainer(
                children: [
                  ...deviceProvider.devices.map((device) => Column(
                    children: [
                      ListTile(
                        leading: Container(
                          padding: EdgeInsets.all(10),
                          decoration: BoxDecoration(color: Colors.grey.withOpacity(0.15), borderRadius: BorderRadius.circular(12)),
                          child: Icon(Icons.memory, color: Colors.grey.shade800, size: 24),
                        ),
                        title: Text(device.deviceId, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                        subtitle: Row(
                          children: [
                            Icon(Icons.circle, color: device.isOnline ? Colors.green : Colors.red, size: 8),
                            SizedBox(width: 4),
                            Text(device.isOnline ? 'Online' : 'Offline', style: TextStyle(fontSize: 12)),
                          ],
                        ),
                        trailing: IconButton(
                          icon: Icon(Icons.delete_outline, color: Colors.red),
                          onPressed: () => _showRemoveDeviceModal(device.deviceId),
                        ),
                      ),
                      Divider(height: 1, color: Colors.grey.shade200),
                    ],
                  )).toList(),
                  _buildListTile(
                    icon: Icons.add,
                    iconColor: Colors.green,
                    title: 'Add New Device',
                    onTap: _showAddDeviceModal,
                  ),
                  Divider(height: 1, color: Colors.grey.shade200),
                  _buildListTile(
                    icon: Icons.wifi,
                    iconColor: Colors.blue,
                    title: 'Change Wi-Fi Credentials',
                    onTap: _showWifiModal,
                  ),
                ],
              ),

              _buildGroupTitle('Server Configuration'),
              _buildCardContainer(
                children: [
                  _buildListTile(
                    icon: Icons.dns,
                    iconColor: Colors.green,
                    title: 'Active Server',
                    subtitle: serverProvider.activeServer.replaceAll('/api', ''),
                    trailing: Container(
                      padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: serverProvider.isHealthy ? Colors.green.withOpacity(0.1) : Colors.red.withOpacity(0.1), 
                        borderRadius: BorderRadius.circular(8)
                      ),
                      child: Text(
                        serverProvider.isHealthy ? 'Connected' : 'Offline', 
                        style: TextStyle(color: serverProvider.isHealthy ? Colors.green : Colors.red, fontWeight: FontWeight.bold, fontSize: 12)
                      ),
                    ),
                  ),
                  Divider(height: 1, color: Colors.grey.shade200),
                  Padding(
                    padding: EdgeInsets.all(16),
                    child: Column(
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: ElevatedButton(
                                onPressed: () => serverProvider.setServerMode('auto'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: serverProvider.mode == 'auto' ? Colors.blue : Colors.grey.shade200,
                                  foregroundColor: serverProvider.mode == 'auto' ? Colors.white : Colors.black87,
                                ),
                                child: Text('Automatic'),
                              ),
                            ),
                            SizedBox(width: 12),
                            Expanded(
                              child: ElevatedButton(
                                onPressed: () => serverProvider.setServerMode('manual'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: serverProvider.mode == 'manual' ? Colors.blue : Colors.grey.shade200,
                                  foregroundColor: serverProvider.mode == 'manual' ? Colors.white : Colors.black87,
                                ),
                                child: Text('Manual'),
                              ),
                            ),
                          ],
                        ),
                        if (serverProvider.mode == 'manual') ...[
                          SizedBox(height: 16),
                          ...ServerProvider.SERVERS.asMap().entries.map((entry) {
                            final idx = entry.key;
                            final url = entry.value;
                            final isSelected = serverProvider.activeServer == url;
                            return ListTile(
                              contentPadding: EdgeInsets.zero,
                              title: Text(url.replaceAll('/api', ''), style: TextStyle(fontSize: 14)),
                              subtitle: Text('Server ${idx + 1}', style: TextStyle(fontSize: 12)),
                              trailing: isSelected ? Icon(Icons.check, color: Colors.blue) : null,
                              onTap: () {
                                serverProvider.setManualServer(url);
                                showToast(context, 'Switched to Server ${idx + 1}');
                              },
                            );
                          }).toList(),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
          
          if (serverProvider.isReverting)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: Container(
                color: Colors.amber.shade700,
                padding: EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                child: Text(
                  'Server unreachable. Auto-switching in ${serverProvider.revertCountdown}s...',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
"""
with open(file_path, "w", encoding="utf-8") as f:
    f.write(code)
