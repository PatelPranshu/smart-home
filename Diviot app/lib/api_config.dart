class ApiConfig {
  static const List<String> servers = [
    'https://smart-home-04m4.onrender.com/api',
    'https://smart-home-emergency02.onrender.com/api',
    'http://10.0.2.2:3000/api',
  ];
  
  // Use the production server as default
  static String currentServer = servers[0];
}
