import 'dart:ui';
import 'package:flutter/material.dart';
import 'dart:async';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../providers/auth_provider.dart';
import '../providers/device_provider.dart';
import '../providers/server_provider.dart';
import '../models/models.dart';
import 'settings_screen.dart';
import 'energy_screen.dart';
import '../utils/ui_utils.dart';
import '../services/api_service.dart';

class HomeScreen extends StatefulWidget {
  @override
  _HomeScreenState createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  int _currentIndex = 0;
  final _apiService = ApiService();
  bool _autoOpenAddDevice = false;
  late ServerProvider _serverProvider;
  String? _lastServerUrl;
  Timer? _updateTimer;
  String _viewMode = 'grid';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Future.microtask(() async {
      final deviceProvider = Provider.of<DeviceProvider>(context, listen: false);
      await deviceProvider.fetchDevices();
      await deviceProvider.initSocket();
    });

    // Listen for server URL changes and reconnect socket
    _serverProvider = Provider.of<ServerProvider>(context, listen: false);
    _lastServerUrl = _serverProvider.activeServer;
    _serverProvider.addListener(_onServerChanged);

    // Setup periodic UI update timer for live runtimes and countdowns
    _updateTimer = Timer.periodic(Duration(seconds: 15), (timer) {
      if (mounted) {
        setState(() {});
      }
    });

    // Load view preference persistently (like localStorage)
    _loadViewPreference();
  }

  Future<void> _loadViewPreference() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (mounted) {
        setState(() {
          _viewMode = prefs.getString('deviceViewMode') ?? 'grid';
        });
      }
    } catch (e) {
      print('Failed to load view preference: $e');
    }
  }

  Future<void> _setViewMode(String mode) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('deviceViewMode', mode);
      if (mounted) {
        setState(() {
          _viewMode = mode;
        });
      }
    } catch (e) {
      print('Failed to save view preference: $e');
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    final deviceProvider = Provider.of<DeviceProvider>(context, listen: false);
    if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive) {
      print('[Lifecycle] App minimized/inactive, pausing socket to save server RAM/CPU');
      deviceProvider.pauseSocket();
    } else if (state == AppLifecycleState.resumed) {
      print('[Lifecycle] App resumed, performing zero-lag HTTP update and reconnecting socket...');
      // 1. Immediately call fetchDevices to update UI instantly via HTTP (zero-lag recovery)
      deviceProvider.fetchDevices(showLoading: false);
      // 2. Connect the socket to restore live feed
      deviceProvider.initSocket();
    }
  }

  void _onServerChanged() {
    if (_serverProvider.activeServer != _lastServerUrl) {
      _lastServerUrl = _serverProvider.activeServer;
      Provider.of<DeviceProvider>(context, listen: false).reconnectSocket();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _serverProvider.removeListener(_onServerChanged);
    _updateTimer?.cancel();
    super.dispose();
  }

  String _formatRuntime(String? lastOnTimeStr) {
    if (lastOnTimeStr == null || lastOnTimeStr.isEmpty) return '';
    try {
      final lastOnTime = DateTime.parse(lastOnTimeStr).toLocal();
      final now = DateTime.now();
      final difference = now.difference(lastOnTime);
      if (difference.isNegative) return '';
      
      final days = difference.inDays;
      final hrs = difference.inHours % 24;
      final mins = difference.inMinutes % 60;
      
      if (days > 0) {
        return '${days}d ${hrs}h';
      } else if (difference.inHours > 0) {
        return '${difference.inHours}h ${mins}m';
      } else {
        return '${mins}m';
      }
    } catch (e) {
      return '';
    }
  }

  String _formatTimer(String? timerExpiresAtStr) {
    if (timerExpiresAtStr == null || timerExpiresAtStr.isEmpty) return '';
    try {
      final expiresAt = DateTime.parse(timerExpiresAtStr).toLocal();
      final now = DateTime.now();
      final difference = expiresAt.difference(now);
      if (difference.isNegative) return '';
      
      final mins = (difference.inSeconds / 60.0).ceil();
      if (mins > 0) {
        return '${mins}m left';
      }
      return '';
    } catch (e) {
      return '';
    }
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
        final isDark = Theme.of(context).brightness == Brightness.dark;
        if (provider.isLoading && provider.devices.isEmpty) {
          return Center(child: CircularProgressIndicator(color: Colors.white));
        }
        
        List<Widget> allSwitches = [];
        for (var device in provider.devices) {
          for (var sw in device.switches) {
            allSwitches.add(_viewMode == 'grid' 
                ? _buildTile(device, sw) 
                : _buildListTileCard(device, sw));
          }
        }
        
        if (allSwitches.isEmpty) {
          return Center(
            child: SingleChildScrollView(
              padding: EdgeInsets.symmetric(horizontal: 32, vertical: 40),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(28),
                child: BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                  child: Container(
                    padding: EdgeInsets.all(28),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(isDark ? 0.08 : 0.12),
                      borderRadius: BorderRadius.circular(28),
                      border: Border.all(color: Colors.white.withOpacity(0.15), width: 1.5),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          padding: EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.08),
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white.withOpacity(0.2), width: 1.5),
                          ),
                          child: Icon(
                            Icons.devices_other_rounded,
                            color: Colors.white,
                            size: 48,
                          ),
                        ),
                        SizedBox(height: 20),
                        Text(
                          "No accessories found.",
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 22,
                            letterSpacing: -0.5,
                          ),
                        ),
                        SizedBox(height: 8),
                        Text(
                          "Claim your Diviot smart home device to begin managing switches, AC, and automation.",
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white70,
                            fontSize: 14,
                            fontWeight: FontWeight.w400,
                            height: 1.4,
                          ),
                        ),
                        SizedBox(height: 24),
                        GestureDetector(
                          onTap: () {
                            setState(() {
                              _autoOpenAddDevice = true;
                              _currentIndex = 2; // Switch to settings tab
                            });
                          },
                          child: Container(
                            height: 52,
                            width: double.infinity,
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [Colors.blue.shade600, Colors.cyan.shade600],
                                begin: Alignment.centerLeft,
                                end: Alignment.centerRight,
                              ),
                              borderRadius: BorderRadius.circular(18),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.cyan.withOpacity(0.25),
                                  blurRadius: 12,
                                  offset: Offset(0, 4),
                                )
                              ],
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.add_circle_outline_rounded, color: Colors.white, size: 20),
                                SizedBox(width: 8),
                                Text(
                                  "Add Accessory",
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
        }

        Widget layoutWidget = _viewMode == 'grid'
            ? GridView.count(
                crossAxisCount: 2,
                padding: EdgeInsets.fromLTRB(20, 20, 20, 120),
                crossAxisSpacing: 16,
                mainAxisSpacing: 16,
                childAspectRatio: 1.1,
                children: allSwitches,
              )
            : ListView(
                padding: EdgeInsets.fromLTRB(20, 20, 20, 120),
                children: allSwitches,
              );

        final sensorCandidates = provider.devices.where((d) => d.temperature > 0 || d.humidity > 0);
        final Device? sensorDevice = sensorCandidates.isNotEmpty 
            ? sensorCandidates.first 
            : (provider.devices.isNotEmpty ? provider.devices.first : null);

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildClimateSummary(sensorDevice),
            Expanded(child: layoutWidget),
          ],
        );
      },
    );
  }

  Widget _buildTile(Device device, DeviceSwitch sw) {
    bool isOn = sw.status && device.isOnline;
    bool isOnline = device.isOnline;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    // Apple Home style styling
    Color bgColor;
    if (!isOnline) {
      bgColor = isDark ? Colors.white.withOpacity(0.06) : Colors.black.withOpacity(0.06);
    } else {
      bgColor = isOn 
          ? Colors.white 
          : (isDark ? Colors.white.withOpacity(0.15) : Colors.black.withOpacity(0.15));
    }
        
    Color iconColor = isOnline ? _getColorForType(sw.type, isOn) : Colors.grey.shade500;
    Color textColor = isOnline 
        ? (isOn ? Colors.black87 : (isDark ? Colors.white : Colors.black87))
        : (isDark ? Colors.white38 : Colors.black38);
    Color subtitleColor = isOnline 
        ? (isOn ? Colors.black54 : (isDark ? Colors.white70 : Colors.black54))
        : (isDark ? Colors.white38 : Colors.black38);

    final runtimeText = _formatRuntime(sw.lastOnTime);
    final timerText = _formatTimer(sw.timerExpiresAt);
    
    return GestureDetector(
      onLongPress: isOnline ? () => _showDeviceSettingsModal(device, sw) : null,
      onTap: () async {
        if (!isOnline) {
          showToast(context, '${sw.name} is offline', isError: true);
          return;
        }
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
          border: isOnline ? null : Border.all(color: isDark ? Colors.white10 : Colors.black12, width: 1),
          boxShadow: (isOnline && isOn) ? [
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
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: (isOnline && isOn) ? iconColor.withOpacity(0.15) : Colors.transparent,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(_getIconForType(sw.type), color: iconColor, size: 28),
                ),
                if (isOnline && timerText.isNotEmpty)
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.orange.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.timer_outlined, color: Colors.orange, size: 12),
                        SizedBox(width: 4),
                        Text(
                          timerText,
                          style: TextStyle(
                            color: Colors.orange.shade700,
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(sw.name, 
                     style: TextStyle(color: textColor, fontWeight: FontWeight.bold, fontSize: 16),
                     maxLines: 1, overflow: TextOverflow.ellipsis),
                SizedBox(height: 2),
                Text(
                  isOnline 
                      ? (isOn 
                          ? (runtimeText.isNotEmpty ? 'On • $runtimeText' : 'On') 
                          : 'Off') 
                      : 'Offline', 
                  style: TextStyle(color: subtitleColor, fontWeight: FontWeight.w500, fontSize: 14),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildListTileCard(Device device, DeviceSwitch sw) {
    bool isOn = sw.status && device.isOnline;
    bool isOnline = device.isOnline;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    Color bgColor;
    if (!isOnline) {
      bgColor = isDark ? Colors.white.withOpacity(0.06) : Colors.black.withOpacity(0.06);
    } else {
      bgColor = isOn 
          ? Colors.white 
          : (isDark ? Colors.white.withOpacity(0.15) : Colors.black.withOpacity(0.15));
    }
        
    Color iconColor = isOnline ? _getColorForType(sw.type, isOn) : Colors.grey.shade500;
    Color textColor = isOnline 
        ? (isOn ? Colors.black87 : (isDark ? Colors.white : Colors.black87))
        : (isDark ? Colors.white38 : Colors.black38);
    Color subtitleColor = isOnline 
        ? (isOn ? Colors.black54 : (isDark ? Colors.white70 : Colors.black54))
        : (isDark ? Colors.white38 : Colors.black38);

    final runtimeText = _formatRuntime(sw.lastOnTime);
    final timerText = _formatTimer(sw.timerExpiresAt);
    
    return GestureDetector(
      onLongPress: isOnline ? () => _showDeviceSettingsModal(device, sw) : null,
      onTap: () async {
        if (!isOnline) {
          showToast(context, '${sw.name} is offline', isError: true);
          return;
        }
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
        margin: EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(20),
          border: isOnline ? null : Border.all(color: isDark ? Colors.white10 : Colors.black12, width: 1),
          boxShadow: (isOnline && isOn) ? [
            BoxShadow(
              color: iconColor.withOpacity(0.15),
              blurRadius: 10,
              offset: Offset(0, 4),
            )
          ] : [],
        ),
        padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Container(
              padding: EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: (isOnline && isOn) ? iconColor.withOpacity(0.15) : Colors.transparent,
                shape: BoxShape.circle,
              ),
              child: Icon(_getIconForType(sw.type), color: iconColor, size: 24),
            ),
            SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(sw.name, 
                       style: TextStyle(color: textColor, fontWeight: FontWeight.bold, fontSize: 16),
                       maxLines: 1, overflow: TextOverflow.ellipsis),
                  SizedBox(height: 2),
                  Text(
                    isOnline 
                        ? (isOn 
                            ? (runtimeText.isNotEmpty ? 'On • $runtimeText' : 'On') 
                            : 'Off') 
                        : 'Offline', 
                    style: TextStyle(color: subtitleColor, fontWeight: FontWeight.w500, fontSize: 14),
                  ),
                ],
              ),
            ),
            if (isOnline && timerText.isNotEmpty) ...[
              Container(
                padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.orange.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.timer_outlined, color: Colors.orange, size: 12),
                    SizedBox(width: 4),
                    Text(
                      timerText,
                      style: TextStyle(
                        color: Colors.orange.shade700,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(width: 12),
            ],
            if (isOnline)
              IgnorePointer(
                child: Switch(
                  value: isOn,
                  activeColor: iconColor,
                  onChanged: (_) {},
                ),
              ),
          ],
        ),
      ),
    );
  }


  void _showDeviceSettingsModal(Device device, DeviceSwitch sw) {
    final nameController = TextEditingController(text: sw.name);
    String selectedType = sw.type;
    int fanSpeed = sw.fanSpeed;
    bool isSaving = false;
    
    // Grid items
    final types = [
      {'id': 'light', 'icon': Icons.lightbulb_outline, 'label': 'Light'},
      {'id': 'fan', 'icon': Icons.cyclone, 'label': 'Fan'},
      {'id': 'ac', 'icon': Icons.ac_unit, 'label': 'AC'},
      {'id': 'outlet', 'icon': Icons.power, 'label': 'Outlet'},
      {'id': 'wifi', 'icon': Icons.wifi, 'label': 'WiFi'},
      {'id': 'water', 'icon': Icons.water_drop, 'label': 'Pump'},
      {'id': 'laundry', 'icon': Icons.local_laundry_service, 'label': 'Wash'},
      {'id': 'other', 'icon': Icons.category, 'label': 'Other'},
    ];

    showDialog(
      context: context,
      barrierColor: Colors.black87,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final isDark = Theme.of(context).brightness == Brightness.dark;

            return Dialog(
              backgroundColor: isDark ? Colors.grey.shade900 : Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
              insetPadding: EdgeInsets.all(16),
              child: SingleChildScrollView(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('Edit Appliance', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 22, color: isDark ? Colors.white : Colors.black87)),
                      SizedBox(height: 20),
                      
                      // Name
                      Text('Device Name', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: isDark ? Colors.white70 : Colors.black54)),
                      SizedBox(height: 8),
                      TextField(
                        controller: nameController,
                        maxLength: 20,
                        style: TextStyle(color: isDark ? Colors.white : Colors.black87),
                        decoration: InputDecoration(
                          filled: true,
                          fillColor: isDark ? Colors.black26 : Colors.black.withOpacity(0.05),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
                          contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          counterText: "",
                        ),
                      ),
                      
                      SizedBox(height: 20),
                      // Type
                      Text('Device Type', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: isDark ? Colors.white70 : Colors.black54)),
                      SizedBox(height: 8),
                      GridView.builder(
                        shrinkWrap: true,
                        physics: NeverScrollableScrollPhysics(),
                        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 4,
                          crossAxisSpacing: 8,
                          mainAxisSpacing: 8,
                          childAspectRatio: 1.0,
                        ),
                        itemCount: types.length,
                        itemBuilder: (ctx, i) {
                          final t = types[i];
                          final isSelected = selectedType == t['id'];
                          return GestureDetector(
                            onTap: () => setModalState(() => selectedType = t['id'] as String),
                            child: AnimatedContainer(
                              duration: Duration(milliseconds: 200),
                              decoration: BoxDecoration(
                                color: isSelected ? Colors.blue.withOpacity(0.2) : (isDark ? Colors.white12 : Colors.black.withOpacity(0.05)),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: isSelected ? Colors.blue : Colors.transparent, width: 2),
                              ),
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(t['icon'] as IconData, color: isSelected ? Colors.blue : (isDark ? Colors.white54 : Colors.black54), size: 24),
                                  SizedBox(height: 4),
                                  Text(
                                    t['label'] as String,
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                                      color: isSelected ? Colors.blue : (isDark ? Colors.white54 : Colors.black54),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                      
                      // Fan Speed (Conditional)
                      if (selectedType == 'fan') ...[
                        SizedBox(height: 24),
                        Text('Fan Speed', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: isDark ? Colors.white70 : Colors.black54)),
                        SizedBox(height: 8),
                        Container(
                          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          decoration: BoxDecoration(
                            color: isDark ? Colors.black26 : Colors.black.withOpacity(0.05),
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Column(
                            children: [
                              Slider(
                                value: fanSpeed.toDouble().clamp(1.0, 4.0),
                                min: 1,
                                max: 4,
                                divisions: 3,
                                activeColor: Colors.cyan,
                                onChanged: (val) => setModalState(() => fanSpeed = val.toInt()),
                              ),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text('Low', style: TextStyle(color: fanSpeed == 1 ? Colors.cyan : Colors.grey, fontWeight: fanSpeed == 1 ? FontWeight.bold : FontWeight.normal)),
                                  Text('Mid', style: TextStyle(color: fanSpeed == 2 ? Colors.cyan : Colors.grey, fontWeight: fanSpeed == 2 ? FontWeight.bold : FontWeight.normal)),
                                  Text('High', style: TextStyle(color: fanSpeed == 3 ? Colors.cyan : Colors.grey, fontWeight: fanSpeed == 3 ? FontWeight.bold : FontWeight.normal)),
                                  Text('Turbo', style: TextStyle(color: fanSpeed == 4 ? Colors.cyan : Colors.grey, fontWeight: fanSpeed == 4 ? FontWeight.bold : FontWeight.normal)),
                                ],
                              )
                            ],
                          ),
                        )
                      ],
                      
                      SizedBox(height: 24),
                      // Auto Turn Off
                      Text('Auto Turn Off (Timer)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: isDark ? Colors.white70 : Colors.black54)),
                      SizedBox(height: 8),
                      Container(
                        padding: EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: isDark ? Colors.black26 : Colors.black.withOpacity(0.05),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: _TimerSection(
                          device: device,
                          sw: sw,
                          apiService: _apiService,
                          isDark: isDark,
                        ),
                      ),
                      
                      SizedBox(height: 32),
                      // Save / Cancel Bottom Row
                      Row(
                        children: [
                          Expanded(
                            child: TextButton(
                              onPressed: () => Navigator.pop(ctx),
                              child: Text('Cancel', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                              style: TextButton.styleFrom(padding: EdgeInsets.symmetric(vertical: 16)),
                            ),
                          ),
                          SizedBox(width: 12),
                          Expanded(
                            flex: 2,
                            child: ElevatedButton(
                              onPressed: isSaving ? null : () async {
                                setModalState(() => isSaving = true);
                                try {
                                  await _apiService.editDevice(device.deviceId, sw.id, nameController.text.trim(), selectedType);
                                  if (selectedType == 'fan') {
                                    await _apiService.setFanSpeed(device.deviceId, sw.id, fanSpeed);
                                  }
                                  showToast(context, 'Device updated!');
                                  // Socket will push update; silent fallback fetch
                                  Navigator.pop(ctx);
                                } catch (e) {
                                  showToast(context, 'Failed to update device', isError: true);
                                  setModalState(() => isSaving = false);
                                }
                              },
                              child: isSaving ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : Text('Save Changes', style: TextStyle(fontWeight: FontWeight.bold)),
                              style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)), padding: EdgeInsets.symmetric(vertical: 16)),
                            ),
                          ),
                        ],
                      )
                    ],
                  ),
                ),
              ),
            );
          },
        );
      }
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
          title: Consumer<AuthProvider>(
            builder: (context, auth, child) {
              return Text(
                auth.homeTitle,
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 28, letterSpacing: -0.5),
              );
            },
          ),
          actions: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                GestureDetector(
                  onTap: () => _setViewMode('grid'),
                  child: Container(
                    padding: EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: _viewMode == 'grid' ? Colors.white.withOpacity(0.25) : Colors.transparent,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      Icons.grid_view_rounded,
                      color: _viewMode == 'grid' ? Colors.white : Colors.white60,
                      size: 20,
                    ),
                  ),
                ),
                SizedBox(width: 4),
                GestureDetector(
                  onTap: () => _setViewMode('list'),
                  child: Container(
                    padding: EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: _viewMode == 'list' ? Colors.white.withOpacity(0.25) : Colors.transparent,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      Icons.view_list_rounded,
                      color: _viewMode == 'list' ? Colors.white : Colors.white60,
                      size: 20,
                    ),
                  ),
                ),
              ],
            ),
            SizedBox(width: 8),
            Padding(
              padding: const EdgeInsets.only(right: 16.0),
              child: IconButton(
                icon: Container(
                  padding: EdgeInsets.all(8),
                  decoration: BoxDecoration(color: Colors.white.withOpacity(0.2), shape: BoxShape.circle),
                  child: Icon(Icons.refresh, color: Colors.white, size: 20),
                ),
                onPressed: () async {
                  showToast(context, 'Rechecking hardware status...', isError: false);
                  try {
                    await Provider.of<DeviceProvider>(context, listen: false).refreshDevices();
                    showToast(context, 'Home status updated!');
                  } catch (e) {
                    showToast(context, 'Hardware status check failed!', isError: true);
                  }
                },
              ),
            )
          ],
        ),
        body: _buildDeviceGrid(),
      ),
      EnergyScreen(),
      SettingsScreen(
        openAddDevice: _autoOpenAddDevice,
        onAddDeviceOpened: () {
          setState(() {
            _autoOpenAddDevice = false;
          });
        },
      ),
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

class _TimerSection extends StatefulWidget {
  final Device device;
  final DeviceSwitch sw;
  final ApiService apiService;
  final bool isDark;

  const _TimerSection({
    required this.device,
    required this.sw,
    required this.apiService,
    required this.isDark,
  });

  @override
  __TimerSectionState createState() => __TimerSectionState();
}

class __TimerSectionState extends State<_TimerSection> {
  final _hrsController = TextEditingController();
  final _minsController = TextEditingController();
  Timer? _countdownTimer;
  String _timeLeft = '';
  bool _hasTimer = false;

  @override
  void initState() {
    super.initState();
    _startCountdown();
  }

  void _startCountdown() {
    _updateTimeLeft();
    _countdownTimer = Timer.periodic(Duration(seconds: 1), (timer) {
      if (mounted) {
        _updateTimeLeft();
      }
    });
  }

  void _updateTimeLeft() {
    if (widget.sw.timerExpiresAt == null) {
      if (_hasTimer) {
        setState(() {
          _hasTimer = false;
          _timeLeft = '';
        });
      }
      return;
    }
    try {
      final expiry = DateTime.parse(widget.sw.timerExpiresAt!).toLocal();
      final now = DateTime.now();
      if (expiry.isAfter(now)) {
        final diff = expiry.difference(now);
        String formatted = '';
        if (diff.inHours > 0) {
          formatted = '${diff.inHours}h ${diff.inMinutes % 60}m ${diff.inSeconds % 60}s left';
        } else if (diff.inMinutes > 0) {
          formatted = '${diff.inMinutes}m ${diff.inSeconds % 60}s left';
        } else {
          formatted = '${diff.inSeconds}s left';
        }
        setState(() {
          _hasTimer = true;
          _timeLeft = formatted;
        });
      } else {
        if (_hasTimer) {
          setState(() {
            _hasTimer = false;
            _timeLeft = '';
          });
          Future.microtask(() {
            if (mounted) {
              Provider.of<DeviceProvider>(context, listen: false).fetchDevices();
            }
          });
        }
      }
    } catch (e) {
      if (_hasTimer) {
        setState(() {
          _hasTimer = false;
          _timeLeft = '';
        });
      }
    }
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _hrsController.dispose();
    _minsController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _hasTimer
        ? Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(Icons.timer, color: Colors.orange),
                  SizedBox(width: 8),
                  Text(_timeLeft, style: TextStyle(fontWeight: FontWeight.bold, color: Colors.orange, fontSize: 16)),
                ],
              ),
              IconButton(
                icon: Icon(Icons.cancel, color: Colors.red),
                onPressed: () async {
                  try {
                    await widget.apiService.cancelTimer(widget.device.deviceId, widget.sw.id);
                    showToast(context, 'Timer cancelled');
                    // Socket will push update automatically
                    Navigator.pop(context); // Close modal
                  } catch (e) {
                    showToast(context, 'Failed to cancel timer', isError: true);
                  }
                },
              )
            ],
          )
        : Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _hrsController,
                  keyboardType: TextInputType.number,
                  style: TextStyle(color: widget.isDark ? Colors.white : Colors.black87),
                  decoration: InputDecoration(
                    hintText: 'Hrs',
                    hintStyle: TextStyle(color: widget.isDark ? Colors.white38 : Colors.black38),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                    filled: true,
                    fillColor: widget.isDark ? Colors.white12 : Colors.black12,
                    contentPadding: EdgeInsets.symmetric(vertical: 12),
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
              Padding(padding: EdgeInsets.symmetric(horizontal: 8), child: Text(':', style: TextStyle(color: widget.isDark ? Colors.white : Colors.black87))),
              Expanded(
                child: TextField(
                  controller: _minsController,
                  keyboardType: TextInputType.number,
                  style: TextStyle(color: widget.isDark ? Colors.white : Colors.black87),
                  decoration: InputDecoration(
                    hintText: 'Mins',
                    hintStyle: TextStyle(color: widget.isDark ? Colors.white38 : Colors.black38),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                    filled: true,
                    fillColor: widget.isDark ? Colors.white12 : Colors.black12,
                    contentPadding: EdgeInsets.symmetric(vertical: 12),
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
              SizedBox(width: 12),
              ElevatedButton(
                onPressed: () async {
                  int h = int.tryParse(_hrsController.text) ?? 0;
                  int m = int.tryParse(_minsController.text) ?? 0;
                  int totalMins = (h * 60) + m;
                  if (totalMins <= 0) return;
                  try {
                    await widget.apiService.setTimer(widget.device.deviceId, widget.sw.id, totalMins);
                    showToast(context, 'Timer set for $totalMins minutes');
                    // Socket will push update automatically
                    Navigator.pop(context); // Close modal
                  } catch (e) {
                    showToast(context, 'Failed to set timer', isError: true);
                  }
                },
                child: Text('Set'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.orange,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                ),
              )
            ],
          );
  }
}
