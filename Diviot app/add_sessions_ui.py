import re

file_path = 'lib/screens/settings_screen.dart'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

# Add state variables
state_vars = '''  List<dynamic> _sessions = [];
  bool _isLoadingSessions = true;
  bool _hasPrimarySession = false;
'''
code = code.replace('  String? _selectedWifiDevice;', '  String? _selectedWifiDevice;\n' + state_vars)

# Add _loadSessions method
load_sessions_method = '''
  Future<void> _loadSessions() async {
    try {
      final sessions = await _apiService.getSessions();
      if (mounted) {
        setState(() {
          _sessions = sessions;
          _isLoadingSessions = false;
          _hasPrimarySession = sessions.any((s) => s['isPrimary'] == true);
        });
      }
    } catch (e) {
      if (mounted) setState(() => _isLoadingSessions = false);
    }
  }

  void _showSessionPasswordModal(String action, String targetId) {
    _removePassController.clear();
    final isDark = Theme.of(context).brightness == Brightness.dark;
    
    String title = action == 'logout-all' ? 'Log Out All Devices' 
                 : action == 'logout' ? 'Remove Primary Device' 
                 : 'Set Primary Device';
                 
    String desc = action == 'logout-all' ? 'A primary device is set. Enter your password to log out all devices.'
                : action == 'logout' ? 'Enter your password to log out the primary device.'
                : 'Enter your password to set this as the primary device.';
                
    _showModal(
      title,
      desc,
      [
        TextField(controller: _removePassController, obscureText: true, decoration: InputDecoration(hintText: 'Your Password', filled: true, fillColor: isDark ? Colors.grey.shade800 : Colors.grey.shade100, border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none))),
      ],
      ElevatedButton(
        onPressed: () async {
          try {
            if (action == 'logout-all') {
              await _apiService.logoutAll(password: _removePassController.text);
              Navigator.pop(context);
              await Provider.of<AuthProvider>(context, listen: false).logout();
              Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => LoginScreen()));
            } else if (action == 'logout') {
              await _apiService.logoutSession(targetId, password: _removePassController.text);
              Navigator.pop(context);
              showToast(context, 'Device logged out');
              _loadSessions();
            } else if (action == 'set-primary') {
              await _apiService.setPrimarySession(targetId, password: _removePassController.text);
              Navigator.pop(context);
              showToast(context, 'Primary device updated');
              _loadSessions();
            }
          } catch(e) {
            showToast(context, e.toString().replaceAll('Exception: ', ''), isError: true);
          }
        },
        child: Text('Verify'),
        style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
      ),
    );
  }
'''
code = code.replace('  Future<void> _loadSettings() async {', load_sessions_method + '\n  Future<void> _loadSettings() async {')

# Call _loadSessions in initState
code = code.replace('    _loadSettings();', '    _loadSettings();\n    _loadSessions();')

# Update logoutAll logic
new_logout_all = '''              ElevatedButton(
                onPressed: () async {
                  Navigator.pop(ctx);
                  if (_hasPrimarySession) {
                    _showSessionPasswordModal('logout-all', 'all');
                  } else {
                    try {
                      await _apiService.logoutAll();
                      await auth.logout();
                      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => LoginScreen()));
                    } catch(e) {
                      showToast(context, 'Failed to log out all devices', isError: true);
                    }
                  }
                },'''
code = re.sub(r'              ElevatedButton\(\s*onPressed: \(\) async \{\s*Navigator\.pop\(ctx\);\s*await _apiService\.logoutAll\(\);\s*Navigator\.pushReplacement\(context, MaterialPageRoute\(builder: \(_\) => LoginScreen\(\)\);\s*\},', new_logout_all, code)


# Insert Active Sessions UI block
sessions_ui = '''
                  _buildGroupTitle('Active Sessions (${_sessions.length})'),
                  _buildCardContainer(
                    children: _isLoadingSessions ? [
                      Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator()))
                    ] : _sessions.isEmpty ? [
                      Padding(padding: EdgeInsets.all(20), child: Center(child: Text('No active sessions', style: TextStyle(color: Colors.grey))))
                    ] : _sessions.map((session) {
                      final isCurrent = session['isCurrentDevice'] == true;
                      final isPrimary = session['isPrimary'] == true;
                      final id = session['_id'];
                      
                      return Column(
                        children: [
                          ListTile(
                            contentPadding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                            leading: Container(
                              padding: EdgeInsets.all(10),
                              decoration: BoxDecoration(color: isCurrent ? Colors.green.withOpacity(0.2) : Colors.grey.withOpacity(0.2), shape: BoxShape.circle),
                              child: Icon(Icons.devices_rounded, color: isCurrent ? Colors.green : (isDark ? Colors.white : Colors.black87), size: 24),
                            ),
                            title: Wrap(
                              crossAxisAlignment: WrapCrossAlignment.center,
                              spacing: 8,
                              children: [
                                Text(session['deviceName'] ?? 'Unknown', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: isDark ? Colors.white : Colors.black87)),
                                if (isCurrent)
                                  Container(
                                    padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(color: Colors.green.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                                    child: Text('Current', style: TextStyle(color: Colors.green, fontSize: 10, fontWeight: FontWeight.bold)),
                                  ),
                                if (isPrimary)
                                  Container(
                                    padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(color: Colors.amber.withOpacity(0.2), borderRadius: BorderRadius.circular(4)),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(Icons.star, color: Colors.amber, size: 12),
                                        SizedBox(width: 2),
                                        Text('Primary', style: TextStyle(color: Colors.amber, fontSize: 10, fontWeight: FontWeight.bold)),
                                      ],
                                    ),
                                  ),
                              ],
                            ),
                            subtitle: Text('${session['location'] ?? 'Unknown Location'} • Last active: ${session['lastActive'] != null ? DateTime.parse(session['lastActive']).toLocal().toString().split('.')[0] : 'Unknown'}', style: TextStyle(fontSize: 12, color: isDark ? Colors.white54 : Colors.black54)),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (!isPrimary)
                                  IconButton(
                                    icon: Icon(Icons.star_border_rounded, color: Colors.grey),
                                    onPressed: () => _showSessionPasswordModal('set-primary', id),
                                    tooltip: 'Set as Primary',
                                  ),
                                IconButton(
                                  icon: Icon(Icons.delete_outline_rounded, color: Colors.redAccent),
                                  onPressed: () {
                                    if (isPrimary) {
                                      _showSessionPasswordModal('logout', id);
                                    } else {
                                      _apiService.logoutSession(id).then((_) {
                                        showToast(context, 'Device logged out');
                                        _loadSessions();
                                        if (isCurrent) {
                                          Provider.of<AuthProvider>(context, listen: false).logout();
                                          Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => LoginScreen()));
                                        }
                                      }).catchError((e) => showToast(context, e.toString().replaceAll('Exception: ', ''), isError: true));
                                    }
                                  },
                                  tooltip: 'Log Out Device',
                                ),
                              ],
                            ),
                          ),
                          Divider(height: 1, color: isDark ? Colors.white12 : Colors.black12, indent: 64),
                        ],
                      );
                    }).toList(),
                  ),
'''
code = code.replace("_buildGroupTitle('System Preferences')", sessions_ui + "\n                  _buildGroupTitle('System Preferences')")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
print('Updated settings_screen.dart')
