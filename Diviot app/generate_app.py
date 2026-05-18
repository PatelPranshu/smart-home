import os

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content.strip() + '\n')

base_dir = 'lib'

api_config = """
class ApiConfig {
  static const List<String> servers = [
    'https://smart-home-04m4.onrender.com/api',
    'https://smart-home-emergency02.onrender.com/api',
  ];
  
  static String currentServer = servers[0];
}
"""

models = """
class DeviceSwitch {
  final String id;
  final String name;
  final String type;
  final bool status;
  final int channel;

  DeviceSwitch({
    required this.id,
    required this.name,
    required this.type,
    required this.status,
    required this.channel,
  });

  factory DeviceSwitch.fromJson(Map<String, dynamic> json) {
    return DeviceSwitch(
      id: json['id'] ?? '',
      name: json['name'] ?? 'Unknown',
      type: json['type'] ?? 'light',
      status: json['status'] == true,
      channel: json['channel'] ?? 1,
    );
  }
}

class Device {
  final String deviceId;
  final String ipAddress;
  final bool isOnline;
  final List<DeviceSwitch> switches;
  final double temperature;
  final double humidity;

  Device({
    required this.deviceId,
    required this.ipAddress,
    required this.isOnline,
    required this.switches,
    required this.temperature,
    required this.humidity,
  });

  factory Device.fromJson(Map<String, dynamic> json) {
    var switchesList = json['switches'] as List? ?? [];
    List<DeviceSwitch> switches = switchesList.map((s) => DeviceSwitch.fromJson(s)).toList();

    return Device(
      deviceId: json['deviceId'] ?? '',
      ipAddress: json['ipAddress'] ?? '',
      isOnline: json['isOnline'] == true,
      switches: switches,
      temperature: (json['temperature'] ?? 0).toDouble(),
      humidity: (json['humidity'] ?? 0).toDouble(),
    );
  }
}
"""

api_service = """
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../api_config.dart';

class ApiService {
  final storage = const FlutterSecureStorage();

  Future<String?> getToken() async {
    return await storage.read(key: 'token');
  }

  Future<Map<String, String>> _getHeaders() async {
    final token = await getToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'x-access-token': token,
    };
  }

  Future<dynamic> login(String email, String password) async {
    final response = await http.post(
      Uri.parse('${ApiConfig.currentServer}/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    
    final data = jsonDecode(response.body);
    if (response.statusCode == 200 && data['token'] != null) {
      await storage.write(key: 'token', value: data['token']);
      await storage.write(key: 'email', value: email);
      return data;
    } else {
      throw Exception(data['error'] ?? 'Login failed');
    }
  }
  
  Future<dynamic> register(String email, String password) async {
    final response = await http.post(
      Uri.parse('${ApiConfig.currentServer}/register'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    
    final data = jsonDecode(response.body);
    if (response.statusCode == 200 && data['status'] == 'ok') {
      return data;
    } else {
      throw Exception(data['error'] ?? 'Registration failed');
    }
  }

  Future<void> logout() async {
    await storage.delete(key: 'token');
  }

  Future<List<dynamic>> getDevices() async {
    final headers = await _getHeaders();
    final response = await http.get(
      Uri.parse('${ApiConfig.currentServer}/devices'),
      headers: headers,
    );
    
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Failed to load devices');
    }
  }

  Future<void> toggleDevice(String deviceId, String switchId, bool state) async {
    final headers = await _getHeaders();
    final response = await http.post(
      Uri.parse('${ApiConfig.currentServer}/control'),
      headers: headers,
      body: jsonEncode({
        'deviceId': deviceId,
        'switchId': switchId,
        'state': state,
      }),
    );
    
    if (response.statusCode != 200) {
      throw Exception('Failed to toggle device');
    }
  }
  
  Future<List<dynamic>> getHistory() async {
    final headers = await _getHeaders();
    final response = await http.get(
      Uri.parse('${ApiConfig.currentServer}/history'),
      headers: headers,
    );
    
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Failed to load history');
    }
  }
}
"""

auth_provider = """
import 'package:flutter/material.dart';
import '../services/api_service.dart';

class AuthProvider with ChangeNotifier {
  final ApiService _apiService = ApiService();
  bool _isAuthenticated = false;
  String? _email;
  
  bool get isAuthenticated => _isAuthenticated;
  String? get email => _email;

  Future<void> checkAuth() async {
    final token = await _apiService.getToken();
    _isAuthenticated = token != null;
    if (_isAuthenticated) {
      _email = await _apiService.storage.read(key: 'email');
    }
    notifyListeners();
  }

  Future<void> login(String email, String password) async {
    await _apiService.login(email, password);
    _isAuthenticated = true;
    _email = email;
    notifyListeners();
  }
  
  Future<void> register(String email, String password) async {
    await _apiService.register(email, password);
  }

  Future<void> logout() async {
    await _apiService.logout();
    _isAuthenticated = false;
    _email = null;
    notifyListeners();
  }
}
"""

device_provider = """
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../models/models.dart';

class DeviceProvider with ChangeNotifier {
  final ApiService _apiService = ApiService();
  List<Device> _devices = [];
  bool _isLoading = false;
  
  List<Device> get devices => _devices;
  bool get isLoading => _isLoading;

  Future<void> fetchDevices() async {
    _isLoading = true;
    notifyListeners();
    try {
      final data = await _apiService.getDevices();
      _devices = data.map((json) => Device.fromJson(json)).toList();
    } catch (e) {
      print('Error fetching devices: $e');
    }
    _isLoading = false;
    notifyListeners();
  }

  Future<void> toggleDevice(String deviceId, String switchId, bool state) async {
    try {
      // Optimistic update
      for (var device in _devices) {
        if (device.deviceId == deviceId) {
          for (var i = 0; i < device.switches.length; i++) {
            if (device.switches[i].id == switchId) {
               device.switches[i] = DeviceSwitch(
                 id: device.switches[i].id,
                 name: device.switches[i].name,
                 type: device.switches[i].type,
                 status: state,
                 channel: device.switches[i].channel,
               );
            }
          }
        }
      }
      notifyListeners();
      
      await _apiService.toggleDevice(deviceId, switchId, state);
    } catch (e) {
      print('Error toggling device: $e');
      // Revert on error (could fetch again)
      fetchDevices();
    }
  }
}
"""

login_screen = """
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  @override
  _LoginScreenState createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLogin = true;
  bool _isLoading = false;

  void _submit() async {
    setState(() => _isLoading = true);
    try {
      if (_isLogin) {
        await Provider.of<AuthProvider>(context, listen: false)
            .login(_emailController.text, _passwordController.text);
        Navigator.pushReplacement(
            context, MaterialPageRoute(builder: (_) => HomeScreen()));
      } else {
        await Provider.of<AuthProvider>(context, listen: false)
            .register(_emailController.text, _passwordController.text);
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Registration successful. Please login.')));
        setState(() => _isLogin = true);
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())));
    }
    setState(() => _isLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.shield, size: 80, color: Colors.blue),
              SizedBox(height: 20),
              Text('Diviot Smart Home', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
              SizedBox(height: 40),
              TextField(
                controller: _emailController,
                decoration: InputDecoration(
                  labelText: 'Email',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  prefixIcon: Icon(Icons.email),
                ),
                keyboardType: TextInputType.emailAddress,
              ),
              SizedBox(height: 16),
              TextField(
                controller: _passwordController,
                decoration: InputDecoration(
                  labelText: 'Password',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  prefixIcon: Icon(Icons.lock),
                ),
                obscureText: true,
              ),
              SizedBox(height: 24),
              _isLoading
                  ? CircularProgressIndicator()
                  : ElevatedButton(
                      onPressed: _submit,
                      style: ElevatedButton.styleFrom(
                        minimumSize: Size(double.infinity, 50),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: Text(_isLogin ? 'Log In' : 'Sign Up', style: TextStyle(fontSize: 18)),
                    ),
              SizedBox(height: 16),
              TextButton(
                onPressed: () => setState(() => _isLogin = !_isLogin),
                child: Text(_isLogin ? 'Need an account? Sign up' : 'Have an account? Log in'),
              )
            ],
          ),
        ),
      ),
    );
  }
}
"""

home_screen = """
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import '../providers/auth_provider.dart';
import '../providers/device_provider.dart';
import '../models/models.dart';
import 'login_screen.dart';
import 'settings_screen.dart';
import 'energy_screen.dart';

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
      case 'light': return FontAwesomeIcons.lightbulb;
      case 'fan': return FontAwesomeIcons.fan;
      case 'ac': return FontAwesomeIcons.snowflake;
      case 'outlet': return FontAwesomeIcons.plug;
      case 'wifi': return FontAwesomeIcons.wifi;
      case 'water': return FontAwesomeIcons.faucetDrip;
      case 'laundry': return FontAwesomeIcons.shirt;
      default: return FontAwesomeIcons.bolt;
    }
  }

  Widget _buildDeviceGrid() {
    return Consumer<DeviceProvider>(
      builder: (context, provider, child) {
        if (provider.isLoading && provider.devices.isEmpty) {
          return Center(child: CircularProgressIndicator());
        }
        
        List<Widget> allSwitches = [];
        for (var device in provider.devices) {
          for (var sw in device.switches) {
            allSwitches.add(_buildSwitchCard(device, sw));
          }
        }
        
        if (allSwitches.isEmpty) {
          return Center(child: Text("No devices found."));
        }

        return GridView.count(
          crossAxisCount: 2,
          padding: EdgeInsets.all(16),
          crossAxisSpacing: 16,
          mainAxisSpacing: 16,
          childAspectRatio: 1.1,
          children: allSwitches,
        );
      },
    );
  }

  Widget _buildSwitchCard(Device device, DeviceSwitch sw) {
    bool isOn = sw.status;
    return GestureDetector(
      onTap: () {
        Provider.of<DeviceProvider>(context, listen: false)
            .toggleDevice(device.deviceId, sw.id, !isOn);
      },
      child: AnimatedContainer(
        duration: Duration(milliseconds: 300),
        decoration: BoxDecoration(
          color: isOn ? Colors.blue.withOpacity(0.1) : Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isOn ? Colors.blue.withOpacity(0.5) : Colors.grey.withOpacity(0.2),
            width: 1,
          ),
          boxShadow: [
            BoxShadow(
              color: isOn ? Colors.blue.withOpacity(0.2) : Colors.black.withOpacity(0.05),
              blurRadius: 10,
              offset: Offset(0, 4),
            )
          ]
        ),
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Icon(_getIconForType(sw.type), 
                     color: isOn ? Colors.blue : Colors.grey[600], 
                     size: 28),
                Switch(
                  value: isOn,
                  onChanged: (val) {
                    Provider.of<DeviceProvider>(context, listen: false)
                        .toggleDevice(device.deviceId, sw.id, val);
                  },
                  activeColor: Colors.blue,
                ),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(sw.name, 
                     style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                     maxLines: 1, overflow: TextOverflow.ellipsis),
                SizedBox(height: 4),
                Text(isOn ? 'ON' : 'OFF', 
                     style: TextStyle(color: isOn ? Colors.blue : Colors.grey, 
                                      fontWeight: FontWeight.w600, fontSize: 12)),
              ],
            )
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      Scaffold(
        appBar: AppBar(
          title: Text('My Home'),
          actions: [
            IconButton(
              icon: Icon(Icons.refresh),
              onPressed: () => Provider.of<DeviceProvider>(context, listen: false).fetchDevices(),
            )
          ],
        ),
        body: _buildDeviceGrid(),
      ),
      EnergyScreen(),
      SettingsScreen(),
    ];

    return Scaffold(
      body: pages[_currentIndex],
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        items: [
          BottomNavigationBarItem(icon: Icon(Icons.home), label: 'Home'),
          BottomNavigationBarItem(icon: Icon(Icons.bolt), label: 'Energy'),
          BottomNavigationBarItem(icon: Icon(Icons.settings), label: 'Settings'),
        ],
      ),
    );
  }
}
"""

settings_screen = """
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import 'login_screen.dart';

class SettingsScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);
    
    return Scaffold(
      appBar: AppBar(title: Text('Settings')),
      body: ListView(
        padding: EdgeInsets.all(16),
        children: [
          ListTile(
            leading: CircleAvatar(child: Icon(Icons.person)),
            title: Text(authProvider.email ?? 'User'),
            subtitle: Text('Logged In'),
          ),
          Divider(),
          ListTile(
            leading: Icon(Icons.logout, color: Colors.red),
            title: Text('Logout', style: TextStyle(color: Colors.red)),
            onTap: () async {
              await authProvider.logout();
              Navigator.pushReplacement(
                  context, MaterialPageRoute(builder: (_) => LoginScreen()));
            },
          ),
        ],
      ),
    );
  }
}
"""

energy_screen = """
import 'package:flutter/material.dart';
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
      setState(() {
        _history = data;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('History & Energy')),
      body: _isLoading 
        ? Center(child: CircularProgressIndicator())
        : _history.isEmpty 
          ? Center(child: Text('No activity found.'))
          : ListView.builder(
              padding: EdgeInsets.all(16),
              itemCount: _history.length,
              itemBuilder: (context, index) {
                final item = _history[index];
                final action = item['action'] ?? 'Unknown Action';
                final isON = action.toString().contains('ON');
                
                return Card(
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
                );
              },
            )
    );
  }
}
"""

main_file = """
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import 'providers/auth_provider.dart';
import 'providers/device_provider.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';

void main() {
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => DeviceProvider()),
      ],
      child: MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Diviot App',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        primarySwatch: Colors.blue,
        textTheme: GoogleFonts.interTextTheme(),
        scaffoldBackgroundColor: Colors.grey[50],
        appBarTheme: AppBarTheme(
          elevation: 0,
          backgroundColor: Colors.grey[50],
          foregroundColor: Colors.black,
          centerTitle: false,
        ),
      ),
      home: AuthChecker(),
    );
  }
}

class AuthChecker extends StatefulWidget {
  @override
  _AuthCheckerState createState() => _AuthCheckerState();
}

class _AuthCheckerState extends State<AuthChecker> {
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _checkAuth();
  }

  void _checkAuth() async {
    await Provider.of<AuthProvider>(context, listen: false).checkAuth();
    setState(() => _isLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return Scaffold(body: Center(child: CircularProgressIndicator()));
    
    final isAuthenticated = Provider.of<AuthProvider>(context).isAuthenticated;
    return isAuthenticated ? HomeScreen() : LoginScreen();
  }
}
"""

write_file(f"{base_dir}/api_config.dart", api_config)
write_file(f"{base_dir}/models/models.dart", models)
write_file(f"{base_dir}/services/api_service.dart", api_service)
write_file(f"{base_dir}/providers/auth_provider.dart", auth_provider)
write_file(f"{base_dir}/providers/device_provider.dart", device_provider)
write_file(f"{base_dir}/screens/login_screen.dart", login_screen)
write_file(f"{base_dir}/screens/home_screen.dart", home_screen)
write_file(f"{base_dir}/screens/settings_screen.dart", settings_screen)
write_file(f"{base_dir}/screens/energy_screen.dart", energy_screen)
write_file(f"{base_dir}/main.dart", main_file)

print("Flutter app generated successfully!")
