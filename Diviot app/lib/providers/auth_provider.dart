import 'package:flutter/material.dart';
import '../services/api_service.dart';

class AuthProvider with ChangeNotifier {
  final ApiService _apiService = ApiService();
  bool _isAuthenticated = false;
  String? _email;
  String _homeTitle = 'My Home';
  
  bool get isAuthenticated => _isAuthenticated;
  String? get email => _email;
  String get homeTitle => _homeTitle;

  Future<void> checkAuth() async {
    final token = await _apiService.getToken();
    _isAuthenticated = token != null;
    if (_isAuthenticated) {
      _email = await _apiService.storage.read(key: 'email');
      // Fetch user profile in background without blocking initial home screen transition
      fetchUserProfile();
    }
    notifyListeners();
  }

  Future<void> fetchUserProfile() async {
    try {
      final profile = await _apiService.getUserProfile();
      _homeTitle = profile['homeTitle'] ?? 'My Home';
      notifyListeners();
    } catch (e) {
      print('Error fetching user profile: $e');
    }
  }

  Future<void> login(String email, String password) async {
    await _apiService.login(email, password);
    _isAuthenticated = true;
    _email = email;
    await fetchUserProfile();
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
