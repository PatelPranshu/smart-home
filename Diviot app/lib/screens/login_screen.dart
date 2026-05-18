import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import 'home_screen.dart';
import '../utils/ui_utils.dart';

class LoginScreen extends StatefulWidget {
  @override
  _LoginScreenState createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  
  bool _isLogin = true;
  bool _isLoading = false;
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  void _submit() async {
    if (!_formKey.currentState!.validate()) return;
    
    if (!_isLogin && _passwordController.text != _confirmPasswordController.text) {
      showToast(context, 'Passwords do not match', isError: true);
      return;
    }

    setState(() => _isLoading = true);
    FocusScope.of(context).unfocus(); // Dismiss keyboard
    
    try {
      if (_isLogin) {
        await Provider.of<AuthProvider>(context, listen: false)
            .login(_emailController.text.trim(), _passwordController.text);
        
        showToast(context, 'Welcome back!');
        Navigator.pushReplacement(
            context, MaterialPageRoute(builder: (_) => HomeScreen()));
      } else {
        await Provider.of<AuthProvider>(context, listen: false)
            .register(_emailController.text.trim(), _passwordController.text);
        
        showToast(context, 'Account created successfully! Please log in.');
        setState(() => _isLogin = true);
        _passwordController.clear();
        _confirmPasswordController.clear();
      }
    } catch (e) {
      showToast(context, e.toString().replaceAll('Exception: ', ''), isError: true);
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Container(
        decoration: BoxDecoration(
          image: DecorationImage(
            image: AssetImage(isDark ? 'assets/images/dark.jpg' : 'assets/images/light.jpg'),
            fit: BoxFit.cover,
          ),
        ),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 20.0, sigmaY: 20.0),
          child: Container(
            color: Colors.black.withOpacity(isDark ? 0.3 : 0.15),
            child: SafeArea(
              child: Center(
                child: SingleChildScrollView(
                  padding: EdgeInsets.symmetric(horizontal: 28.0, vertical: 20.0),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        // Dynamic Logo Badge with Neon Glow
                        Container(
                          padding: EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.08),
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white.withOpacity(0.2), width: 1.5),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.blue.withOpacity(0.25),
                                blurRadius: 25,
                                spreadRadius: 2,
                              )
                            ],
                          ),
                          child: ClipOval(
                            child: Image.asset(
                              'assets/images/logo.png',
                              width: 80,
                              height: 80,
                              fit: BoxFit.cover,
                            ),
                          ),
                        ),
                        SizedBox(height: 16),
                        
                        // App Brand Title & Subtitle
                        Text(
                          'DIVIOT',
                          style: TextStyle(
                            fontSize: 34, 
                            fontWeight: FontWeight.w900, 
                            color: Colors.white,
                            letterSpacing: 4.0,
                          ),
                        ),
                        SizedBox(height: 4),
                        Text(
                          'Smart Living, Redefined.',
                          style: TextStyle(
                            fontSize: 14, 
                            fontWeight: FontWeight.w400, 
                            color: Colors.white70,
                            letterSpacing: 0.5,
                          ),
                        ),
                        SizedBox(height: 36),
                        
                        // Glassmorphic Input Container
                        ClipRRect(
                          borderRadius: BorderRadius.circular(32),
                          child: BackdropFilter(
                            filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                            child: Container(
                              padding: EdgeInsets.all(24),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(isDark ? 0.08 : 0.12),
                                borderRadius: BorderRadius.circular(32),
                                border: Border.all(color: Colors.white.withOpacity(0.15), width: 1.5),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withOpacity(0.1),
                                    blurRadius: 10,
                                    offset: Offset(0, 10),
                                  )
                                ],
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _isLogin ? 'Sign In' : 'Sign Up',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                      fontSize: 22,
                                    ),
                                  ),
                                  SizedBox(height: 20),
                                  
                                  // Email Input
                                  TextFormField(
                                    controller: _emailController,
                                    keyboardType: TextInputType.emailAddress,
                                    style: TextStyle(color: Colors.white, fontSize: 16),
                                    validator: (val) {
                                      if (val == null || val.trim().isEmpty) return 'Please enter your email';
                                      if (!RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$').hasMatch(val.trim())) {
                                        return 'Please enter a valid email address';
                                      }
                                      return null;
                                    },
                                    decoration: InputDecoration(
                                      labelText: 'Email Address',
                                      labelStyle: TextStyle(color: Colors.white70, fontSize: 14),
                                      prefixIcon: Icon(Icons.alternate_email_rounded, color: Colors.white60),
                                      filled: true,
                                      fillColor: Colors.white.withOpacity(0.06),
                                      border: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(20),
                                        borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
                                      ),
                                      enabledBorder: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(20),
                                        borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
                                      ),
                                      focusedBorder: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(20),
                                        borderSide: BorderSide(color: Colors.blueAccent, width: 2),
                                      ),
                                      errorBorder: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(20),
                                        borderSide: BorderSide(color: Colors.red.shade400),
                                      ),
                                    ),
                                  ),
                                  SizedBox(height: 16),
                                  
                                  // Password Input
                                  TextFormField(
                                    controller: _passwordController,
                                    obscureText: _obscurePassword,
                                    style: TextStyle(color: Colors.white, fontSize: 16),
                                    validator: (val) {
                                      if (val == null || val.isEmpty) return 'Please enter your password';
                                      if (!_isLogin && val.length < 6) return 'Password must be at least 6 characters';
                                      return null;
                                    },
                                    decoration: InputDecoration(
                                      labelText: 'Password',
                                      labelStyle: TextStyle(color: Colors.white70, fontSize: 14),
                                      prefixIcon: Icon(Icons.lock_outline_rounded, color: Colors.white60),
                                      suffixIcon: IconButton(
                                        icon: Icon(
                                          _obscurePassword ? Icons.visibility_off : Icons.visibility,
                                          color: Colors.white60,
                                        ),
                                        onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                                      ),
                                      filled: true,
                                      fillColor: Colors.white.withOpacity(0.06),
                                      border: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(20),
                                        borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
                                      ),
                                      enabledBorder: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(20),
                                        borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
                                      ),
                                      focusedBorder: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(20),
                                        borderSide: BorderSide(color: Colors.blueAccent, width: 2),
                                      ),
                                      errorBorder: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(20),
                                        borderSide: BorderSide(color: Colors.red.shade400),
                                      ),
                                    ),
                                  ),
                                  if (!_isLogin) ...[
                                    SizedBox(height: 16),
                                    TextFormField(
                                      controller: _confirmPasswordController,
                                      obscureText: _obscureConfirmPassword,
                                      style: TextStyle(color: Colors.white, fontSize: 16),
                                      validator: (val) {
                                        if (val == null || val.isEmpty) return 'Please confirm your password';
                                        if (val != _passwordController.text) return 'Passwords do not match';
                                        return null;
                                      },
                                      decoration: InputDecoration(
                                        labelText: 'Confirm Password',
                                        labelStyle: TextStyle(color: Colors.white70, fontSize: 14),
                                        prefixIcon: Icon(Icons.lock_outline_rounded, color: Colors.white60),
                                        suffixIcon: IconButton(
                                          icon: Icon(
                                            _obscureConfirmPassword ? Icons.visibility_off : Icons.visibility,
                                            color: Colors.white60,
                                          ),
                                          onPressed: () => setState(() => _obscureConfirmPassword = !_obscureConfirmPassword),
                                        ),
                                        filled: true,
                                        fillColor: Colors.white.withOpacity(0.06),
                                        border: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(20),
                                          borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
                                        ),
                                        enabledBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(20),
                                          borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
                                        ),
                                        focusedBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(20),
                                          borderSide: BorderSide(color: Colors.blueAccent, width: 2),
                                        ),
                                        errorBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(20),
                                          borderSide: BorderSide(color: Colors.red.shade400),
                                        ),
                                      ),
                                    ),
                                  ],
                                  SizedBox(height: 28),
                                  
                                  // Gradient Button with Cyan Backlight Glow
                                  _isLoading
                                      ? Center(child: CircularProgressIndicator(color: Colors.blue))
                                      : Container(
                                          width: double.infinity,
                                          height: 54,
                                          decoration: BoxDecoration(
                                            gradient: LinearGradient(
                                              colors: [Colors.blue.shade600, Colors.cyan.shade600],
                                              begin: Alignment.centerLeft,
                                              end: Alignment.centerRight,
                                            ),
                                            borderRadius: BorderRadius.circular(20),
                                            boxShadow: [
                                              BoxShadow(
                                                color: Colors.cyan.withOpacity(0.3),
                                                blurRadius: 15,
                                                offset: Offset(0, 4),
                                              )
                                            ],
                                          ),
                                          child: Material(
                                            color: Colors.transparent,
                                            child: InkWell(
                                              onTap: _submit,
                                              borderRadius: BorderRadius.circular(20),
                                              child: Center(
                                                child: Text(
                                                  _isLogin ? 'Log In' : 'Create Account',
                                                  style: TextStyle(
                                                    color: Colors.white,
                                                    fontSize: 16,
                                                    fontWeight: FontWeight.bold,
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ),
                                        ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        SizedBox(height: 24),
                        
                        // Switch Text Switcher Action Button
                        TextButton(
                          onPressed: () {
                            setState(() {
                              _isLogin = !_isLogin;
                              _formKey.currentState?.reset();
                            });
                          },
                          style: TextButton.styleFrom(
                            foregroundColor: Colors.white,
                            padding: EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16),
                              side: BorderSide(color: Colors.white24),
                            ),
                          ),
                          child: Text(
                            _isLogin ? 'Need an account? Sign Up' : 'Already have an account? Log In',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
