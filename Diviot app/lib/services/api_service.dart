import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../main.dart';
import '../screens/login_screen.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'dart:io' show Platform;
import '../api_config.dart';

class ApiService {
  final storage = const FlutterSecureStorage();

  Future<String?> _getDeviceName() async {
    try {
      final DeviceInfoPlugin deviceInfo = DeviceInfoPlugin();
      if (Platform.isAndroid) {
        final AndroidDeviceInfo androidInfo = await deviceInfo.androidInfo;
        return '${androidInfo.manufacturer} ${androidInfo.model}';
      } else if (Platform.isIOS) {
        final IosDeviceInfo iosInfo = await deviceInfo.iosInfo;
        return iosInfo.utsname.machine;
      }
    } catch (e) {
      print('Error getting device info: $e');
    }
    return null;
  }

  Future<http.Response> _intercept(Future<http.Response> Function() requestBuilder) async {
    http.Response response = await requestBuilder();
    if (response.statusCode == 401) {
      final refreshed = await _refreshToken();
      if (refreshed) {
        response = await requestBuilder();
      }
      if (response.statusCode == 401) {
        await _forceLogout();
        throw Exception('Unauthorized. Please log in again.');
      }
    }
    return response;
  }

  Future<bool> _refreshToken() async {
    final rToken = await storage.read(key: 'refreshToken');
    if (rToken == null) return false;
    try {
      final res = await http.post(
        Uri.parse('${ApiConfig.currentServer}/refresh-token'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': rToken}),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        await storage.write(key: 'token', value: data['token']);
        if (data['refreshToken'] != null) {
          await storage.write(key: 'refreshToken', value: data['refreshToken']);
        }
        return true;
      }
    } catch (e) {}
    return false;
  }

  Future<void> _forceLogout() async {
    await logout();
    if (navigatorKey.currentContext != null) {
      Navigator.of(navigatorKey.currentContext!).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => LoginScreen()),
        (Route<dynamic> route) => false,
      );
    }
  }

  Future<String?> getToken() async {
    return await storage.read(key: 'token');
  }

  Future<Map<String, String>> _getHeaders() async {
    final token = await getToken();
    final rToken = await storage.read(key: 'refreshToken');
    return {
      'Content-Type': 'application/json',
      if (token != null) 'x-access-token': token,
      if (rToken != null) 'x-refresh-token': rToken,
    };
  }

  Future<dynamic> login(String email, String password) async {
    final deviceName = await _getDeviceName();
    final headers = {'Content-Type': 'application/json'};
    if (deviceName != null) headers['x-device-name'] = deviceName;

    final response = await http.post(
      Uri.parse('${ApiConfig.currentServer}/login'),
      headers: headers,
      body: jsonEncode({
        'email': email,
        'password': password,
        'isMobile': true,
      }),
    );
    
    final data = jsonDecode(response.body);
    if (response.statusCode == 200 && data['token'] != null) {
      await storage.write(key: 'token', value: data['token']);
      if (data['refreshToken'] != null) {
        await storage.write(key: 'refreshToken', value: data['refreshToken']);
      }
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

  Future<void> logoutAll({String? password}) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/logout-all'),
      headers: await _getHeaders(),
      body: password != null ? jsonEncode({'password': password}) : null,
    ));
    if (response.statusCode != 200) throw Exception('Failed to log out all devices');
  }

  Future<List<dynamic>> getDevices() async {
    final headers = await _getHeaders();
    final response = await _intercept(() async => http.get(
      Uri.parse('${ApiConfig.currentServer}/devices'),
      headers: headers,
    ));
    
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Failed to load devices');
    }
  }

  Future<void> refreshDevices() async {
    final headers = await _getHeaders();
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/devices/refresh'),
      headers: headers,
    ));
    if (response.statusCode != 200) {
      throw Exception('Failed to request device status refresh');
    }
  }

  Future<void> toggleDevice(String deviceId, int switchId, bool state) async {
    final headers = await _getHeaders();
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/control'),
      headers: headers,
      body: jsonEncode({
        'deviceId': deviceId,
        'switchId': switchId,
        'state': state,
      }),
    ));
    
    if (response.statusCode != 200) {
      throw Exception('Failed to toggle device');
    }
  }
  
  Future<List<dynamic>> getHistory() async {
    final headers = await _getHeaders();
    final response = await _intercept(() async => http.get(
      Uri.parse('${ApiConfig.currentServer}/history'),
      headers: headers,
    ));
    
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Failed to load history');
    }
  }

  Future<void> editDevice(String deviceId, int switchId, String newName, String newType) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/edit'),
      headers: await _getHeaders(),
      body: jsonEncode({'deviceId': deviceId, 'switchId': switchId, 'newName': newName, 'newType': newType}),
    ));
    if (response.statusCode != 200) throw Exception('Failed to edit device');
  }

  Future<void> setTimer(String deviceId, int switchId, int minutes) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/timer'),
      headers: await _getHeaders(),
      body: jsonEncode({'deviceId': deviceId, 'switchId': switchId, 'minutes': minutes}),
    ));
    if (response.statusCode != 200) throw Exception('Failed to set timer');
  }

  Future<void> cancelTimer(String deviceId, int switchId) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/timer/cancel'),
      headers: await _getHeaders(),
      body: jsonEncode({'deviceId': deviceId, 'switchId': switchId}),
    ));
    if (response.statusCode != 200) throw Exception('Failed to cancel timer');
  }

  Future<void> setFanSpeed(String deviceId, int switchId, int speed) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/fan-speed'),
      headers: await _getHeaders(),
      body: jsonEncode({'deviceId': deviceId, 'switchId': switchId, 'speed': speed}),
    ));
    if (response.statusCode != 200) throw Exception('Failed to set fan speed');
  }

  Future<void> updateUser(Map<String, dynamic> data) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/user-update'),
      headers: await _getHeaders(),
      body: jsonEncode(data),
    ));
    if (response.statusCode != 200) throw Exception('Failed to update user profile');
  }

  Future<Map<String, dynamic>> getUserProfile() async {
    final response = await _intercept(() async => http.get(
      Uri.parse('${ApiConfig.currentServer}/user/profile'),
      headers: await _getHeaders(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Failed to fetch user profile');
    }
  }

  Future<Map<String, dynamic>> getGoogleStatus() async {
    final response = await _intercept(() async => http.get(
      Uri.parse('${ApiConfig.currentServer}/user/google-status'),
      headers: await _getHeaders(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Failed to fetch Google status');
    }
  }

  Future<void> setGoogleStatus(bool enabled) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/user/google-status'),
      headers: await _getHeaders(),
      body: jsonEncode({'enabled': enabled}),
    ));
    if (response.statusCode != 200) throw Exception('Failed to update Google Home status');
  }

  Future<Map<String, dynamic>> getUpdatePreference() async {
    final response = await _intercept(() async => http.get(
      Uri.parse('${ApiConfig.currentServer}/user/update-preference'),
      headers: await _getHeaders(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Failed to fetch update preference');
    }
  }

  Future<void> setUpdatePreference(String preference) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/user/update-preference'),
      headers: await _getHeaders(),
      body: jsonEncode({'preference': preference}),
    ));
    if (response.statusCode != 200) throw Exception('Failed to update preference');
  }

  Future<void> claimDevice(String deviceId, String secretCode) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/claim-device'),
      headers: await _getHeaders(),
      body: jsonEncode({'deviceId': deviceId, 'secretCode': secretCode}),
    ));
    if (response.statusCode != 200) throw Exception('Failed to claim device');
  }

  Future<void> removeDevice(String deviceId) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/remove-device'),
      headers: await _getHeaders(),
      body: jsonEncode({'deviceId': deviceId}),
    ));
    if (response.statusCode != 200) throw Exception('Failed to remove device');
  }

  Future<void> verifyPassword(String password) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/verify-password'),
      headers: await _getHeaders(),
      body: jsonEncode({'password': password}),
    ));
    if (response.statusCode != 200) throw Exception('Verification failed');
  }

  Future<void> verifyCode(String code) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/verify-code'),
      headers: await _getHeaders(),
      body: jsonEncode({'code': code}),
    ));
    if (response.statusCode != 200) throw Exception('Invalid Kit Code');
  }

  Future<void> setWifiConfig(String deviceId, String ssid, String pass) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/wifi-config'),
      headers: await _getHeaders(),
      body: jsonEncode({'deviceId': deviceId, 'ssid': ssid, 'pass': pass}),
    ));
    if (response.statusCode != 200) throw Exception('Failed to set Wi-Fi config');
  }

  Future<List<dynamic>> getSessions() async {
    final response = await _intercept(() async => http.get(
      Uri.parse('${ApiConfig.currentServer}/sessions'),
      headers: await _getHeaders(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Failed to load sessions');
    }
  }

  Future<void> logoutSession(String id, {String? password}) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/sessions/$id/logout'),
      headers: await _getHeaders(),
      body: password != null ? jsonEncode({'password': password}) : null,
    ));
    if (response.statusCode != 200) {
      final data = jsonDecode(response.body);
      throw Exception(data['error'] ?? 'Failed to logout device');
    }
  }

  Future<void> setPrimarySession(String id, {String? password}) async {
    final response = await _intercept(() async => http.post(
      Uri.parse('${ApiConfig.currentServer}/sessions/$id/set-primary'),
      headers: await _getHeaders(),
      body: password != null ? jsonEncode({'password': password}) : null,
    ));
    if (response.statusCode != 200) {
      final data = jsonDecode(response.body);
      throw Exception(data['error'] ?? 'Failed to set primary device');
    }
  }
}
