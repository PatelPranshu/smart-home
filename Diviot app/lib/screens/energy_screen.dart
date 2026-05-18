import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/device_provider.dart';
import '../services/api_service.dart';

class EnergyScreen extends StatefulWidget {
  @override
  _EnergyScreenState createState() => _EnergyScreenState();
}

class _EnergyScreenState extends State<EnergyScreen> {
  final ApiService _apiService = ApiService();
  List<dynamic> _history = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _fetchHistory();
  }

  void _fetchHistory() async {
    try {
      final data = await _apiService.getHistory();
      if (mounted) {
        setState(() {
          _history = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  IconData _getIconForSwitch(BuildContext context, String? switchName) {
    if (switchName == null) return Icons.bolt;
    final provider = Provider.of<DeviceProvider>(context, listen: false);
    for (var device in provider.devices) {
      for (var sw in device.switches) {
        if (sw.name.toLowerCase() == switchName.toLowerCase()) {
          switch (sw.type.toLowerCase()) {
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
      }
    }
    // Fallback based on name keywords if not found in active devices
    final nameLower = switchName.toLowerCase();
    if (nameLower.contains('light') || nameLower.contains('bulb') || nameLower.contains('lamp')) {
      return Icons.lightbulb_outline;
    } else if (nameLower.contains('fan')) {
      return Icons.cyclone;
    } else if (nameLower.contains('ac') || nameLower.contains('cooler')) {
      return Icons.ac_unit;
    } else if (nameLower.contains('plug') || nameLower.contains('outlet') || nameLower.contains('socket')) {
      return Icons.power;
    } else if (nameLower.contains('wifi') || nameLower.contains('router')) {
      return Icons.wifi;
    } else if (nameLower.contains('pump') || nameLower.contains('water') || nameLower.contains('motor')) {
      return Icons.water_drop;
    } else if (nameLower.contains('laundry') || nameLower.contains('washer') || nameLower.contains('wash')) {
      return Icons.local_laundry_service;
    }
    return Icons.bolt;
  }

  Color _getColorForSwitch(BuildContext context, String? switchName, bool isOn) {
    if (!isOn) return Colors.grey.shade500;
    if (switchName == null) return Colors.orange;
    final provider = Provider.of<DeviceProvider>(context, listen: false);
    for (var device in provider.devices) {
      for (var sw in device.switches) {
        if (sw.name.toLowerCase() == switchName.toLowerCase()) {
          switch (sw.type.toLowerCase()) {
            case 'light': return Colors.amber;
            case 'fan': return Colors.cyan;
            case 'ac': return Colors.blue;
            case 'outlet': return Colors.green;
            default: return Colors.orange;
          }
        }
      }
    }
    // Fallback based on name keywords
    final nameLower = switchName.toLowerCase();
    if (nameLower.contains('light') || nameLower.contains('bulb') || nameLower.contains('lamp')) {
      return Colors.amber;
    } else if (nameLower.contains('fan')) {
      return Colors.cyan;
    } else if (nameLower.contains('ac') || nameLower.contains('cooler')) {
      return Colors.blue;
    } else if (nameLower.contains('plug') || nameLower.contains('outlet') || nameLower.contains('socket')) {
      return Colors.green;
    }
    return Colors.orange;
  }

  String _formatTime12h(DateTime dt) {
    int hour = dt.hour;
    int minute = dt.minute;
    String period = 'AM';
    
    if (hour >= 12) {
      period = 'PM';
      if (hour > 12) {
        hour -= 12;
      }
    } else if (hour == 0) {
      hour = 12;
    }
    
    String minStr = minute < 10 ? '0$minute' : '$minute';
    return '$hour:$minStr $period';
  }

  String _formatDate(DateTime dt) {
    final months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    String month = months[dt.month - 1];
    return '${dt.day} $month';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text('History & Energy', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 28, letterSpacing: -0.5)),
        toolbarHeight: 80,
      ),
      body: _isLoading 
        ? Center(child: CircularProgressIndicator(color: Colors.white))
        : _history.isEmpty 
          ? Center(child: Text('No activity found.', style: TextStyle(color: Colors.white70, fontSize: 16)))
          : ListView.builder(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 120),
              itemCount: _history.length,
              itemBuilder: (context, index) {
                final item = _history[index];
                final action = item['action'] ?? 'Unknown Action';
                final isON = action.toString().contains('ON');
                final isDark = Theme.of(context).brightness == Brightness.dark;
                
                final itemColor = _getColorForSwitch(context, item['switchName'], isON);
                
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
                        color: isON ? itemColor.withOpacity(0.15) : Colors.red.withOpacity(0.15),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        _getIconForSwitch(context, item['switchName']),
                        color: isON ? itemColor : Colors.red,
                        size: 24,
                      ),
                    ),
                    title: Text(item['switchName'] ?? 'Unknown Device', style: TextStyle(fontWeight: FontWeight.bold, color: isDark ? Colors.white : Colors.black87)),
                    subtitle: Text(action, style: TextStyle(color: isDark ? Colors.white70 : Colors.black54)),
                    trailing: item['timestamp'] != null 
                      ? Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              _formatTime12h(DateTime.parse(item['timestamp']).toLocal()),
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13,
                                color: isDark ? Colors.white70 : Colors.black87,
                              ),
                            ),
                            SizedBox(height: 2),
                            Text(
                              _formatDate(DateTime.parse(item['timestamp']).toLocal()),
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                                color: isDark ? Colors.white38 : Colors.black45,
                              ),
                            ),
                          ],
                        )
                      : SizedBox.shrink(),
                  ),
                );
              },
            )
    );
  }
}
