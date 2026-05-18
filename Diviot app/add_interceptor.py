import os

file_path = "lib/services/api_service.dart"

with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

if "import 'package:flutter/material.dart';" not in code:
    code = code.replace("import 'package:http/http.dart' as http;", "import 'package:flutter/material.dart';\nimport 'package:http/http.dart' as http;\nimport '../main.dart';\nimport '../screens/login_screen.dart';")

if "Future<http.Response> _intercept" not in code:
    interceptor_method = """
  Future<http.Response> _intercept(Future<http.Response> request) async {
    final response = await request;
    if (response.statusCode == 401) {
      await logout();
      if (navigatorKey.currentContext != null) {
        Navigator.of(navigatorKey.currentContext!).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => LoginScreen()),
          (Route<dynamic> route) => false,
        );
      }
      throw Exception('Unauthorized. Please log in again.');
    }
    return response;
  }
"""
    code = code.replace("Future<String?> getToken() async {", interceptor_method + "\n  Future<String?> getToken() async {")

    # Replace http.post and http.get with _intercept(http.post) etc.
    code = code.replace("await http.post(", "await _intercept(http.post(")
    code = code.replace("await http.get(", "await _intercept(http.get(")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
