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
      barrierColor: Colors.black87,
      builder: (ctx) => AlertDialog(
        backgroundColor: Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade900 : Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Text(title, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
            if (subtitle.isNotEmpty) ...[
              SizedBox(height: 8),
              Text(subtitle, textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: Colors.grey)),
            ]
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(height: 12),
            ...content,
          ],
        ),
        actions: [
          TextButton(
            child: Text('Cancel', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
            onPressed: () => Navigator.pop(ctx),
          ),
          actionButton,
        ],
        actionsAlignment: MainAxisAlignment.spaceEvenly,
      ),
    );
  }

  void _showLogoutModal(AuthProvider auth) {
    showDialog(
      context: context,
      barrierColor: Colors.black87,
      builder: (ctx) => AlertDialog(
        backgroundColor: Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade900 : Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
        title: Text('Logout Options', textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.bold)),
        content: Text('Would you like to log out of only this device or all devices currently logged in?', textAlign: TextAlign.center),
        actions: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ElevatedButton(
                onPressed: () async {
                  Navigator.pop(ctx);
                  await auth.logout();
                  Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => LoginScreen()));
                },
                child: Text('Log Out Only This Device', style: TextStyle(fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.amber.shade700, 
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  padding: EdgeInsets.symmetric(vertical: 14)
                ),
              ),
              SizedBox(height: 12),
              ElevatedButton(
                onPressed: () async {
                  Navigator.pop(ctx);
                  await _apiService.logoutAll();
                  Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => LoginScreen()));
                },
                child: Text('Log Out From All Devices', style: TextStyle(fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.redAccent, 
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  padding: EdgeInsets.symmetric(vertical: 14)
                ),
              ),
              TextButton(
                child: Text('Cancel', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                onPressed: () => Navigator.pop(ctx),
              ),
            ]
          )
        ],
      ),
    );
  }

  // --- Skipped modal contents for brevity but kept functional logic identical ---
  void _showChangePasswordModal() {
    _espCodeController.clear();
    final isDark = Theme.of(context).brightness == Brightness.dark;
    _showModal(
      'Security Check',
      'Please enter the unique code printed on your ESP32 device to prove ownership.',
      [
        TextField(controller: _espCodeController, decoration: InputDecoration(hintText: 'Enter ESP32 Code', filled: true, fillColor: isDark ? Colors.grey.shade800 : Colors.grey.shade100, border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none))),
      ],
      ElevatedButton(
        onPressed: () async {
          try {
            await _apiService.verifyCode(_espCodeController.text);
            Navigator.pop(context);
            _newPassController.clear();
            _showModal('New Password', '', [
              TextField(controller: _newPassController, obscureText: true, decoration: InputDecoration(hintText: 'New Password', filled: true, fillColor: isDark ? Colors.grey.shade800 : Colors.grey.shade100, border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none))),
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
            }, child: Text('Update'), style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)))));
          } catch(e) {
            showToast(context, e.toString().replaceAll('Exception: ', ''), isError: true);
          }
        },
        child: Text('Verify'),
        style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
      ),
    );
  }

  void _showAddDeviceModal() {
    _deviceIdController.clear();
    _secretCodeController.clear();
    final isDark = Theme.of(context).brightness == Brightness.dark;
    _showModal(
      'Add Device',
      'Enter the details found on the device sticker.',
      [
        TextField(controller: _deviceIdController, decoration: InputDecoration(hintText: 'Device ID (e.g. esp32_C0...)', filled: true, fillColor: isDark ? Colors.grey.shade800 : Colors.grey.shade100, border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none))),
        SizedBox(height: 12),
        TextField(controller: _secretCodeController, decoration: InputDecoration(hintText: 'Secret Code (e.g. 123456)', filled: true, fillColor: isDark ? Colors.grey.shade800 : Colors.grey.shade100, border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none))),
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
        style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
      ),
    );
  }

  void _showWifiModal() {
    _verifyPassController.clear();
    final isDark = Theme.of(context).brightness == Brightness.dark;
    _showModal(
      'Verify Identity',
      'Enter your login password to access Wi-Fi settings.',
      [
        TextField(controller: _verifyPassController, obscureText: true, decoration: InputDecoration(hintText: 'Your Password', filled: true, fillColor: isDark ? Colors.grey.shade800 : Colors.grey.shade100, border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none))),
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
                      filled: true, fillColor: isDark ? Colors.grey.shade800 : Colors.grey.shade100,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
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
              TextField(controller: _wifiSsidController, decoration: InputDecoration(hintText: 'New Wi-Fi Name', filled: true, fillColor: isDark ? Colors.grey.shade800 : Colors.grey.shade100, border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none))),
              SizedBox(height: 12),
              TextField(controller: _wifiPassController, obscureText: true, decoration: InputDecoration(hintText: 'New Wi-Fi Password', filled: true, fillColor: isDark ? Colors.grey.shade800 : Colors.grey.shade100, border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none))),
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
            }, child: Text('Update Device'), style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)))));
          } catch(e) {
            showToast(context, e.toString().replaceAll('Exception: ', ''), isError: true);
          }
        },
        child: Text('Verify'),
        style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
      ),
    );
  }

  void _showRemoveDeviceModal(String deviceId) {
    _removePassController.clear();
    final isDark = Theme.of(context).brightness == Brightness.dark;
    _showModal(
      'Remove Device',
      'Enter your login password to confirm removing $deviceId.',
      [
        TextField(controller: _removePassController, obscureText: true, decoration: InputDecoration(hintText: 'Your Password', filled: true, fillColor: isDark ? Colors.grey.shade800 : Colors.grey.shade100, border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none))),
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
        style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
      ),
    );
  }

  Widget _buildGroupTitle(String title) {
    return Padding(
      padding: EdgeInsets.only(left: 16, bottom: 8, top: 32),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w800, letterSpacing: 1.2),
      ),
    );
  }

  Widget _buildCardContainer({required List<Widget> children}) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark ? Colors.white.withOpacity(0.12) : Colors.white.withOpacity(0.85),
        borderRadius: BorderRadius.circular(28),
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
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return ListTile(
      contentPadding: EdgeInsets.symmetric(horizontal: 20, vertical: 4),
      leading: Container(
        padding: EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: isDark ? iconColor.withOpacity(0.2) : iconColor.withOpacity(0.15),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: iconColor, size: 22),
      ),
      title: Text(title, style: TextStyle(fontWeight: FontWeight.w600, color: isDark ? Colors.white : Colors.black87, fontSize: 16)),
      subtitle: subtitle != null ? Text(subtitle, style: TextStyle(color: isDark ? Colors.white60 : Colors.black54, fontSize: 13)) : null,
      trailing: trailing ?? (onTap != null ? Icon(Icons.arrow_forward_ios, color: isDark ? Colors.white30 : Colors.grey.shade400, size: 16) : null),
      onTap: onTap,
    );
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    final deviceProvider = Provider.of<DeviceProvider>(context);
    final serverProvider = Provider.of<ServerProvider>(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text('Settings', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 32, letterSpacing: -0.5)),
        toolbarHeight: 80,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16.0),
            child: GestureDetector(
              onTapDown: (_) {},
              onTapUp: (_) => _showLogoutModal(authProvider),
              child: AnimatedContainer(
                duration: Duration(milliseconds: 100),
                padding: EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: isDark ? Colors.white.withOpacity(0.2) : Colors.white.withOpacity(0.8),
                  shape: BoxShape.circle,
                ),
                child: Icon(Icons.power_settings_new, color: Colors.redAccent, size: 22),
              ),
            ),
          )
        ],
      ),
      body: Stack(
        children: [
          ListView(
            padding: EdgeInsets.fromLTRB(16, serverProvider.isReverting ? 40 : 0, 16, 120),
            children: [
              _buildGroupTitle('Account'),
              _buildCardContainer(
                children: [
                  _buildListTile(
                    icon: Icons.person_rounded,
                    iconColor: Colors.blue,
                    title: authProvider.email ?? 'Loading...',
                    subtitle: 'User Account',
                  ),
                  Divider(height: 1, color: isDark ? Colors.white12 : Colors.black12, indent: 64),
                  _buildListTile(
                    icon: Icons.lock_rounded,
                    iconColor: Colors.amber,
                    title: 'Change Password',
                    onTap: _showChangePasswordModal,
                  ),
                  Divider(height: 1, color: isDark ? Colors.white12 : Colors.black12, indent: 64),
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _titleController,
                            style: TextStyle(color: isDark ? Colors.white : Colors.black87, fontWeight: FontWeight.w600),
                            decoration: InputDecoration(
                              hintText: 'Home Title',
                              hintStyle: TextStyle(color: isDark ? Colors.white54 : Colors.black45),
                              filled: true,
                              fillColor: isDark ? Colors.black26 : Colors.black.withOpacity(0.05),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(16),
                                borderSide: BorderSide.none,
                              ),
                              contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 0),
                            ),
                          ),
                        ),
                        SizedBox(width: 12),
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
                          child: Text('Save', style: TextStyle(fontWeight: FontWeight.bold)),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.blue, 
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                            padding: EdgeInsets.symmetric(horizontal: 20, vertical: 14)
                          ),
                        )
                      ],
                    ),
                  ),
                ],
              ),

              _buildGroupTitle('System Preferences'),
              _buildCardContainer(
                children: [
                  _buildListTile(
                    icon: Icons.cloud_download_rounded,
                    iconColor: Colors.green,
                    title: 'Automatic Updates',
                    subtitle: _autoUpdate ? 'Silently updating in background' : 'Manual notifications enabled',
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
                    Divider(height: 1, color: isDark ? Colors.white12 : Colors.black12, indent: 64),
                    _buildListTile(
                      icon: Icons.home_work_rounded,
                      iconColor: Colors.indigo,
                      title: 'Google Home Access',
                      subtitle: 'Allow voice commands',
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
                        activeColor: Colors.indigo,
                      ),
                    ),
                  ],
                ],
              ),

              _buildGroupTitle('My Devices'),
              _buildCardContainer(
                children: [
                  ...deviceProvider.devices.map((device) => Column(
                    children: [
                      ListTile(
                        contentPadding: EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                        leading: Container(
                          padding: EdgeInsets.all(10),
                          decoration: BoxDecoration(color: Colors.grey.withOpacity(0.2), shape: BoxShape.circle),
                          child: Icon(Icons.memory_rounded, color: isDark ? Colors.white : Colors.black87, size: 24),
                        ),
                        title: Text(device.deviceId, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: isDark ? Colors.white : Colors.black87)),
                        subtitle: Row(
                          children: [
                            Container(
                              width: 8, height: 8,
                              decoration: BoxDecoration(color: device.isOnline ? Colors.green : Colors.red, shape: BoxShape.circle)
                            ),
                            SizedBox(width: 6),
                            Text(device.isOnline ? 'Online' : 'Offline', style: TextStyle(fontSize: 13, color: isDark ? Colors.white60 : Colors.black54)),
                          ],
                        ),
                        trailing: IconButton(
                          icon: Icon(Icons.delete_outline_rounded, color: Colors.redAccent),
                          onPressed: () => _showRemoveDeviceModal(device.deviceId),
                        ),
                      ),
                      Divider(height: 1, color: isDark ? Colors.white12 : Colors.black12, indent: 64),
                    ],
                  )).toList(),
                  _buildListTile(
                    icon: Icons.add_circle_rounded,
                    iconColor: Colors.teal,
                    title: 'Add New Device',
                    onTap: _showAddDeviceModal,
                  ),
                  Divider(height: 1, color: isDark ? Colors.white12 : Colors.black12, indent: 64),
                  _buildListTile(
                    icon: Icons.wifi_rounded,
                    iconColor: Colors.deepOrange,
                    title: 'Update Wi-Fi Credentials',
                    onTap: _showWifiModal,
                  ),
                ],
              ),

              _buildGroupTitle('Server Configuration'),
              _buildCardContainer(
                children: [
                  _buildListTile(
                    icon: Icons.dns_rounded,
                    iconColor: serverProvider.isHealthy ? Colors.green : Colors.red,
                    title: 'Active Server',
                    subtitle: serverProvider.activeServer.replaceAll('/api', ''),
                    trailing: Container(
                      padding: EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: serverProvider.isHealthy ? Colors.green.withOpacity(0.15) : Colors.red.withOpacity(0.15), 
                        borderRadius: BorderRadius.circular(12)
                      ),
                      child: Text(
                        serverProvider.isHealthy ? 'Connected' : 'Offline', 
                        style: TextStyle(color: serverProvider.isHealthy ? Colors.green : Colors.red, fontWeight: FontWeight.bold, fontSize: 12)
                      ),
                    ),
                  ),
                  Divider(height: 1, color: isDark ? Colors.white12 : Colors.black12, indent: 64),
                  Padding(
                    padding: EdgeInsets.all(20),
                    child: Column(
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: ElevatedButton(
                                onPressed: () => serverProvider.setServerMode('auto'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: serverProvider.mode == 'auto' ? Colors.blue : (isDark ? Colors.white12 : Colors.black12),
                                  foregroundColor: serverProvider.mode == 'auto' ? Colors.white : (isDark ? Colors.white : Colors.black87),
                                  elevation: 0,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                  padding: EdgeInsets.symmetric(vertical: 12)
                                ),
                                child: Text('Automatic', style: TextStyle(fontWeight: FontWeight.bold)),
                              ),
                            ),
                            SizedBox(width: 12),
                            Expanded(
                              child: ElevatedButton(
                                onPressed: () => serverProvider.setServerMode('manual'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: serverProvider.mode == 'manual' ? Colors.blue : (isDark ? Colors.white12 : Colors.black12),
                                  foregroundColor: serverProvider.mode == 'manual' ? Colors.white : (isDark ? Colors.white : Colors.black87),
                                  elevation: 0,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                  padding: EdgeInsets.symmetric(vertical: 12)
                                ),
                                child: Text('Manual', style: TextStyle(fontWeight: FontWeight.bold)),
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
                            return Container(
                              margin: EdgeInsets.only(top: 8),
                              decoration: BoxDecoration(
                                color: isSelected ? Colors.blue.withOpacity(0.1) : Colors.transparent,
                                borderRadius: BorderRadius.circular(12)
                              ),
                              child: ListTile(
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                title: Text(url.replaceAll('/api', ''), style: TextStyle(fontSize: 14, fontWeight: isSelected ? FontWeight.bold : FontWeight.normal, color: isDark ? Colors.white : Colors.black87)),
                                subtitle: Text('Server ${idx + 1}', style: TextStyle(fontSize: 12, color: isDark ? Colors.white54 : Colors.black54)),
                                trailing: isSelected ? Icon(Icons.check_circle_rounded, color: Colors.blue) : null,
                                onTap: () {
                                  serverProvider.setManualServer(url);
                                  showToast(context, 'Switched to Server ${idx + 1}');
                                },
                              ),
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
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: [Colors.amber.shade700, Colors.orange.shade800]),
                  boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 10, offset: Offset(0, 4))]
                ),
                padding: EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                child: SafeArea(
                  bottom: false,
                  child: Text(
                    'Server unreachable. Auto-switching in ${serverProvider.revertCountdown}s...',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                    textAlign: TextAlign.center,
                  ),
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
print("done settings")
