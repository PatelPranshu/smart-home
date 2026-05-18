import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import '../services/api_service.dart';
import '../models/models.dart';
import '../api_config.dart';

class DeviceProvider with ChangeNotifier {
  final ApiService _apiService = ApiService();
  List<Device> _devices = [];
  bool _isLoading = false;
  IO.Socket? _socket;
  String? _connectedUrl; // Track which server URL socket is connected to
  
  List<Device> get devices => _devices;
  bool get isLoading => _isLoading;

  /// Fetches devices via HTTP. Used for initial load and manual refresh only.
  /// Socket.io handles all subsequent real-time updates automatically.
  Future<void> fetchDevices({bool showLoading = true}) async {
    if (showLoading) {
      _isLoading = true;
      notifyListeners();
    }
    try {
      final data = await _apiService.getDevices();
      _devices = data.map((json) => Device.fromJson(json)).toList();
    } catch (e) {
      print('Error fetching devices: $e');
    }
    if (showLoading) {
      _isLoading = false;
    }
    notifyListeners();
  }

  /// Connects to the Socket.io server for real-time device updates.
  /// Safe to call multiple times — will skip if already connected to the same server.
  Future<void> initSocket() async {
    final baseUrl = ApiConfig.currentServer.replaceAll('/api', '');

    // Already connected to the correct server — skip
    if (_socket != null && _socket!.connected && _connectedUrl == baseUrl) return;

    final token = await _apiService.getToken();
    if (token == null) return;

    // Clean up any existing connection first
    _cleanupSocket();

    print('[Socket] Connecting to: $baseUrl');
    _connectedUrl = baseUrl;

    _socket = IO.io(
      baseUrl,
      IO.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .enableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(2000)
          .setReconnectionDelayMax(10000)
          .build(),
    );

    _socket!.onConnect((_) {
      print('[Socket] Connected to server');
      _socket!.emit('request_devices');
    });

    _socket!.onDisconnect((reason) {
      print('[Socket] Disconnected: $reason');
    });

    _socket!.onConnectError((err) {
      print('[Socket] Connection error: $err');
    });

    _socket!.on('devices_updated', (data) {
      print('[Socket] Received devices_updated');
      try {
        if (data is List) {
          _devices = data
              .map((json) => Device.fromJson(json as Map<String, dynamic>))
              .toList();
          _isLoading = false;
          notifyListeners();
        }
      } catch (e) {
        print('[Socket] Error parsing devices_updated: $e');
      }
    });
  }

  /// Reconnects the socket to a new server URL.
  /// Called when ServerProvider switches backends.
  Future<void> reconnectSocket() async {
    _cleanupSocket();
    await initSocket();
  }

  /// Cleanly disconnects and destroys the socket connection.
  void disconnectSocket() {
    _cleanupSocket();
    _devices = [];
    print('[Socket] Disconnected and cleaned up');
  }

  /// Temporarily pauses the socket connection to save server resources when the app is minimized.
  void pauseSocket() {
    _cleanupSocket();
    print('[Socket] Paused socket connection (saved server RAM/CPU)');
  }

  void _cleanupSocket() {
    if (_socket != null) {
      _socket!.clearListeners();
      _socket!.disconnect();
      _socket!.destroy();
      _socket = null;
      _connectedUrl = null;
    }
  }

  /// Sends a hardware refresh request via HTTP, waits for MQTT round-trip,
  /// then fetches updated data. Used only for the manual refresh button.
  Future<void> refreshDevices() async {
    _isLoading = true;
    notifyListeners();
    try {
      await _apiService.refreshDevices();
      // Wait for MQTT round-trip to complete and DB to update
      await Future.delayed(Duration(milliseconds: 500));
      final data = await _apiService.getDevices();
      _devices = data.map((json) => Device.fromJson(json)).toList();
    } catch (e) {
      print('Error refreshing devices: $e');
    }
    _isLoading = false;
    notifyListeners();
  }

  /// Toggles a device switch with optimistic UI update.
  /// The server emits `devices_updated` after processing, which will
  /// confirm the state or revert it if there's an error.
  Future<void> toggleDevice(String deviceId, int switchId, bool state) async {
    try {
      // Optimistic update for instant UI feedback
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
      // No need to fetchDevices() — the server will emit devices_updated via socket
    } catch (e) {
      print('Error toggling device: $e');
      // Revert on error by fetching the actual state
      fetchDevices(showLoading: false);
      rethrow;
    }
  }
}
