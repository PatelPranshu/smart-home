import 'dart:async';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../api_config.dart';

class ServerProvider with ChangeNotifier {
  static const List<String> SERVERS = [
    'http://10.0.2.2:3000/api',
    'https://smart-home-04m4.onrender.com/api',
    'https://smart-home-emergency02.onrender.com/api',
  ];

  String _mode = 'auto';
  String _activeServer = SERVERS[0];
  bool _isHealthy = false;
  
  Timer? _healthCheckTimer;
  Timer? _manualRevertTimer;
  int _revertCountdown = 0;

  String get mode => _mode;
  String get activeServer => _activeServer;
  bool get isHealthy => _isHealthy;
  int get revertCountdown => _revertCountdown;
  bool get isReverting => _manualRevertTimer != null && _manualRevertTimer!.isActive;

  ServerProvider() {
    _init();
  }

  Future<void> _init() async {
    final prefs = await SharedPreferences.getInstance();
    _mode = prefs.getString('serverMode') ?? 'auto';
    final savedBackend = prefs.getString('activeBackend');

    if (_mode == 'auto' || savedBackend == null) {
      _activeServer = SERVERS[0];
      await prefs.remove('activeBackend');
    } else {
      _activeServer = savedBackend;
    }
    
    ApiConfig.currentServer = _activeServer;
    notifyListeners();

    _startHealthChecks();
    if (_mode == 'auto') {
      _findActiveServer();
    }
  }

  void _startHealthChecks() {
    _healthCheckTimer?.cancel();
    _healthCheckTimer = Timer.periodic(Duration(seconds: 10), (timer) {
      _checkCurrentHealth();
    });
    _checkCurrentHealth();
  }

  Future<void> _checkCurrentHealth() async {
    final healthy = await checkServerHealth(_activeServer);
    if (_isHealthy != healthy) {
      _isHealthy = healthy;
      notifyListeners();
    }

    if (!healthy && _mode == 'auto') {
      _findActiveServer();
    } else if (!healthy && _mode == 'manual' && _manualRevertTimer == null) {
      _startManualRevertCountdown();
    } else if (healthy && _manualRevertTimer != null) {
      _cancelManualRevert();
    }
  }

  Future<bool> checkServerHealth(String url) async {
    try {
      final res = await http.get(Uri.parse('$url/health')).timeout(Duration(seconds: 5));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<void> _findActiveServer() async {
    if (_mode == 'manual') return;

    for (final server in SERVERS) {
      if (await checkServerHealth(server)) {
        if (_activeServer != server) {
          _activeServer = server;
          ApiConfig.currentServer = _activeServer;
          _isHealthy = true;
          notifyListeners();
        }
        return;
      }
    }
  }

  Future<void> setServerMode(String newMode) async {
    _mode = newMode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('serverMode', _mode);
    
    _cancelManualRevert();

    if (_mode == 'auto') {
      _activeServer = SERVERS[0];
      ApiConfig.currentServer = _activeServer;
      await prefs.remove('activeBackend');
      _findActiveServer();
    }
    notifyListeners();
  }

  Future<void> setManualServer(String url) async {
    _activeServer = url;
    ApiConfig.currentServer = _activeServer;
    
    _mode = 'manual';
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('serverMode', 'manual');
    await prefs.setString('activeBackend', url);
    
    _cancelManualRevert();
    notifyListeners();
    _checkCurrentHealth();
  }

  void _startManualRevertCountdown() {
    _revertCountdown = 20;
    notifyListeners();
    _manualRevertTimer = Timer.periodic(Duration(seconds: 1), (timer) {
      _revertCountdown--;
      if (_revertCountdown <= 0) {
        _cancelManualRevert();
        setServerMode('auto');
      }
      notifyListeners();
    });
  }

  void _cancelManualRevert() {
    _manualRevertTimer?.cancel();
    _manualRevertTimer = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _healthCheckTimer?.cancel();
    _manualRevertTimer?.cancel();
    super.dispose();
  }
}
