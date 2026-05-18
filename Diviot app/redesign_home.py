import os

file_path = "lib/screens/home_screen.dart"
code = """import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/device_provider.dart';
import '../models/models.dart';
import 'login_screen.dart';
import 'settings_screen.dart';
import 'energy_screen.dart';
import '../utils/ui_utils.dart';

class HomeScreen extends StatefulWidget {
  @override
  _HomeScreenState createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _currentIndex = 0;

  @override
  void initState() {
    super.initState();
    Future.microtask(() =>
        Provider.of<DeviceProvider>(context, listen: false).fetchDevices());
  }

  IconData _getIconForType(String type) {
    switch (type.toLowerCase()) {
      case 'light': return Icons.lightbulb_outline;
      case 'fan': return Icons.cyclone;
      case 'ac': return Icons.ac_unit;
      case 'outlet': return Icons.power;
      case 'wifi': return Icons.wifi;
      case 'water': return Icons.water_drop;
      case 'laundry': return Icons.local_laundry_service;
      default: return Icons.bolt;
    }
  }
  
  Color _getColorForType(String type, bool isOn) {
    if (!isOn) return Colors.grey.shade400;
    switch (type.toLowerCase()) {
      case 'light': return Colors.amber;
      case 'fan': return Colors.cyan;
      case 'ac': return Colors.blue;
      case 'outlet': return Colors.green;
      default: return Colors.orange;
    }
  }

  Widget _buildClimateSummary(Device? sensorDevice) {
    if (sensorDevice == null || (sensorDevice.temperature == 0 && sensorDevice.humidity == 0)) return SizedBox.shrink();
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      child: Row(
        children: [
          _buildClimateChip(Icons.thermostat, '${sensorDevice.temperature.toStringAsFixed(1)}°C'),
          SizedBox(width: 8),
          _buildClimateChip(Icons.water_drop, '${sensorDevice.humidity.toStringAsFixed(1)}%'),
        ],
      ),
    );
  }
  
  Widget _buildClimateChip(IconData icon, String value) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.2),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        children: [
          Icon(icon, color: Colors.white, size: 16),
          SizedBox(width: 4),
          Text(value, style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13)),
        ],
      ),
    );
  }

  Widget _buildDeviceGrid() {
    return Consumer<DeviceProvider>(
      builder: (context, provider, child) {
        if (provider.isLoading && provider.devices.isEmpty) {
          return Center(child: CircularProgressIndicator(color: Colors.white));
        }
        
        List<Widget> allSwitches = [];
        for (var device in provider.devices) {
          for (var sw in device.switches) {
            allSwitches.add(_buildTile(device, sw));
          }
        }
        
        if (allSwitches.isEmpty) {
          return Center(child: Text("No accessories found.", style: TextStyle(color: Colors.white)));
        }

        Widget grid = GridView.count(
          crossAxisCount: 2,
          padding: EdgeInsets.all(20),
          crossAxisSpacing: 16,
          mainAxisSpacing: 16,
          childAspectRatio: 1.1,
          children: allSwitches,
        );

        Device? sensorDevice;
        try {
          sensorDevice = provider.devices.firstWhere((d) => d.temperature > 0 || d.humidity > 0);
        } catch (e) {
          if (provider.devices.isNotEmpty) {
            sensorDevice = provider.devices.first;
          }
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildClimateSummary(sensorDevice),
            Expanded(child: grid),
          ],
        );
      },
    );
  }

  Widget _buildTile(Device device, DeviceSwitch sw) {
    bool isOn = sw.status;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    // Apple Home style styling
    Color bgColor = isOn 
        ? Colors.white 
        : (isDark ? Colors.white.withOpacity(0.15) : Colors.black.withOpacity(0.15));
        
    Color iconColor = _getColorForType(sw.type, isOn);
    Color textColor = isOn ? Colors.black87 : Colors.white;
    Color subtitleColor = isOn ? Colors.black54 : Colors.white70;
    
    return GestureDetector(
      onTap: () async {
        try {
          await Provider.of<DeviceProvider>(context, listen: false)
              .toggleDevice(device.deviceId, sw.id, !isOn);
        } catch (e) {
          showToast(context, 'Failed to toggle device!', isError: true);
        }
      },
      child: AnimatedContainer(
        duration: Duration(milliseconds: 250),
        curve: Curves.easeOutCubic,
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(24),
          boxShadow: isOn ? [
            BoxShadow(
              color: iconColor.withOpacity(0.3),
              blurRadius: 15,
              offset: Offset(0, 4),
            )
          ] : [],
        ),
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Container(
              padding: EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: isOn ? iconColor.withOpacity(0.15) : Colors.transparent,
                shape: BoxShape.circle,
              ),
              child: Icon(_getIconForType(sw.type), color: iconColor, size: 28),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(sw.name, 
                     style: TextStyle(color: textColor, fontWeight: FontWeight.bold, fontSize: 15),
                     maxLines: 1, overflow: TextOverflow.ellipsis),
                SizedBox(height: 2),
                Text(isOn ? 'On' : 'Off', 
                     style: TextStyle(color: subtitleColor, fontWeight: FontWeight.w500, fontSize: 13)),
              ],
            )
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final pages = [
      Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          elevation: 0,
          toolbarHeight: 80,
          title: Text('My Home', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 32, letterSpacing: -0.5)),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: 16.0),
              child: IconButton(
                icon: Container(
                  padding: EdgeInsets.all(8),
                  decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), shape: BoxShape.circle),
                  child: Icon(Icons.refresh, color: Colors.white, size: 20),
                ),
                onPressed: () async {
                  await Provider.of<DeviceProvider>(context, listen: false).fetchDevices();
                  showToast(context, 'Refreshing Home...');
                },
              ),
            )
          ],
        ),
        body: _buildDeviceGrid(),
      ),
      EnergyScreen(),
      SettingsScreen(),
    ];

    return Container(
      decoration: BoxDecoration(
        image: DecorationImage(
          image: AssetImage(isDark ? 'assets/images/dark.jpg' : 'assets/images/light.jpg'),
          fit: BoxFit.cover,
        ),
      ),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20.0, sigmaY: 20.0), // Heavy blur for Apple Home aesthetic
        child: Scaffold(
          backgroundColor: Colors.black.withOpacity(0.1),
          body: pages[_currentIndex],
          extendBody: true, // Let the content flow under the navbar
          bottomNavigationBar: ClipRRect(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 30, sigmaY: 30),
              child: Container(
                color: isDark ? Colors.black.withOpacity(0.4) : Colors.white.withOpacity(0.2),
                child: BottomNavigationBar(
                  backgroundColor: Colors.transparent,
                  elevation: 0,
                  selectedItemColor: Colors.white,
                  unselectedItemColor: Colors.white.withOpacity(0.5),
                  currentIndex: _currentIndex,
                  showSelectedLabels: true,
                  showUnselectedLabels: true,
                  selectedFontSize: 12,
                  unselectedFontSize: 12,
                  type: BottomNavigationBarType.fixed,
                  onTap: (index) => setState(() => _currentIndex = index),
                  items: [
                    BottomNavigationBarItem(icon: Icon(Icons.home_filled), label: 'Home'),
                    BottomNavigationBarItem(icon: Icon(Icons.bolt), label: 'Energy'),
                    BottomNavigationBarItem(icon: Icon(Icons.settings), label: 'Settings'),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
"""
with open(file_path, "w", encoding="utf-8") as f:
    f.write(code)

print("Redesigned Home Screen")
