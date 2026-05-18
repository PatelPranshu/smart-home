class DeviceSwitch {
  final int id;
  final String name;
  final String type;
  final bool status;
  final int channel;
  final String? timerExpiresAt;
  final String? lastOnTime;
  final int fanSpeed;

  DeviceSwitch({
    required this.id,
    required this.name,
    required this.type,
    required this.status,
    required this.channel,
    this.timerExpiresAt,
    this.lastOnTime,
    this.fanSpeed = 1,
  });

  factory DeviceSwitch.fromJson(Map<String, dynamic> json) {
    return DeviceSwitch(
      id: json['id'] is int ? json['id'] : (int.tryParse(json['id']?.toString() ?? '') ?? 0),
      name: json['name'] ?? 'Unknown',
      type: json['type'] ?? 'light',
      status: json['state'] == true, // Fixed mapping to match backend 'state'
      channel: json['channel'] is int ? json['channel'] : (int.tryParse(json['channel']?.toString() ?? '') ?? 1),
      timerExpiresAt: json['timerExpiresAt'],
      lastOnTime: json['lastOnTime'],
      fanSpeed: json['speed'] is int ? json['speed'] : (int.tryParse(json['speed']?.toString() ?? '') ?? (json['fanSpeed'] is int ? json['fanSpeed'] : (int.tryParse(json['fanSpeed']?.toString() ?? '') ?? 1))),
    );
  }
}

class Device {
  final String deviceId;
  final String ipAddress;
  final bool isOnline;
  final List<DeviceSwitch> switches;
  final double temperature;
  final double humidity;

  Device({
    required this.deviceId,
    required this.ipAddress,
    required this.isOnline,
    required this.switches,
    required this.temperature,
    required this.humidity,
  });

  factory Device.fromJson(Map<String, dynamic> json) {
    var switchesList = json['switches'] as List? ?? [];
    List<DeviceSwitch> switches = switchesList.map((s) => DeviceSwitch.fromJson(s)).toList();

    return Device(
      deviceId: json['deviceId'] ?? '',
      ipAddress: json['ipAddress'] ?? '',
      isOnline: json['isOnline'] == true,
      switches: switches,
      temperature: json['temperature'] is num ? (json['temperature'] as num).toDouble() : (double.tryParse(json['temperature']?.toString() ?? '') ?? 0.0),
      humidity: json['humidity'] is num ? (json['humidity'] as num).toDouble() : (double.tryParse(json['humidity']?.toString() ?? '') ?? 0.0),
    );
  }
}
