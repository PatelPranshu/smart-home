class ApiConfig {
  static const List<String> servers = [
    'https://smart-home-04m4.onrender.com/api',
    'https://smart-home-emergency02.onrender.com/api',
  ];
  
  static String currentServer = servers[0]; // Use index 0 which is the primary Render server
}
