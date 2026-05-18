import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/auth_provider.dart';
import 'providers/device_provider.dart';
import 'providers/server_provider.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';

final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

void main() {
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => DeviceProvider()),
        ChangeNotifierProvider(create: (_) => ServerProvider()),
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
      navigatorKey: navigatorKey,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.light,
        primarySwatch: Colors.blue,
        scaffoldBackgroundColor: Colors.grey[50],
        appBarTheme: AppBarTheme(
          elevation: 0,
          backgroundColor: Colors.grey[50],
          foregroundColor: Colors.black,
          centerTitle: false,
        ),
      ),
      darkTheme: ThemeData(
        brightness: Brightness.dark,
        primarySwatch: Colors.blue,
        scaffoldBackgroundColor: Colors.black87,
        appBarTheme: AppBarTheme(
          elevation: 0,
          backgroundColor: Colors.black87,
          foregroundColor: Colors.white,
          centerTitle: false,
        ),
      ),
      themeMode: ThemeMode.system,
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
  bool _socketDisconnected = false;

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

    if (!isAuthenticated && !_socketDisconnected) {
      _socketDisconnected = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        Provider.of<DeviceProvider>(context, listen: false).disconnectSocket();
      });
    } else if (isAuthenticated) {
      _socketDisconnected = false;
    }

    return isAuthenticated ? HomeScreen() : LoginScreen();
  }
}
