#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h> 
#include <Preferences.h> // Library to save data permanently

// --- DEFAULT CONFIGURATION (Fallback) ---
// If no WiFi is saved, it will try these:
const char* default_ssid = "PRANSHU";
const char* default_password = "123450789";

// MQTT Broker
const char* mqtt_server = "6c37b4fdae72447883f91b6cc992648e.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_user = "backend_admin";
const char* mqtt_pass = "Admin@3500";

const char* deviceId = "esp32_001"; 
const char* commandTopic = "devices/esp32_001/command";
const char* updateTopic = "devices/esp32_001/update";
const char* syncTopic = "devices/esp32_001/sync";
const char* statusTopic = "devices/esp32_001/status"; 
const char* wifiTopic = "devices/esp32_001/wifi"; // NEW TOPIC

// --- PINS ---
const int NUM_RELAYS = 8;
const int relayPins[NUM_RELAYS] = {22, 23, 14, 27, 26, 25, 33, 32};
const int switchPins[NUM_RELAYS] = {15,  4, 16, 17,  5, 18, 19, 21};
const int STATUS_LED = 2;

// --- GLOBALS ---
WiFiClientSecure espClient;
PubSubClient client(espClient);
Preferences preferences; // Object to save data

// Variables to hold current WiFi Creds
String currentSSID;
String currentPass;

// State tracking
bool relayState[NUM_RELAYS] = {false};
int lastSwitchState[NUM_RELAYS] = {HIGH}; 
unsigned long lastDebounceTime[NUM_RELAYS] = {0};
unsigned long debounceDelay = 50;

// TIMERS FOR BACKGROUND TASKS
unsigned long lastWifiAttempt = 0;
unsigned long lastMqttAttempt = 0;
const unsigned long wifiInterval = 10000; // Try WiFi every 10s
const unsigned long mqttInterval = 5000;  // Try MQTT every 5s

// --- HELPER: Blink Blue LED (Non-blocking) ---
void blinkFeedback() {
  digitalWrite(STATUS_LED, HIGH); 
  delay(10);                      
  digitalWrite(STATUS_LED, LOW);  
}

void setup() {
  Serial.begin(115200);
  
  // 1. Setup Status LED
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW); 

  // 2. Initialize Pins
  for(int i=0; i<NUM_RELAYS; i++) {
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], HIGH); // Relays OFF (Active Low)
    pinMode(switchPins[i], INPUT_PULLUP);
    lastSwitchState[i] = digitalRead(switchPins[i]);
  }

  // --- 3. LOAD WIFI FROM STORAGE ---
  preferences.begin("my-app", true); // Open storage in read-only mode first
  currentSSID = preferences.getString("ssid", default_ssid); // Get saved SSID or use default
  currentPass = preferences.getString("pass", default_password);
  preferences.end();

  Serial.println("Loaded Config:");
  Serial.println("SSID: " + currentSSID);

  // 4. JIO DNS FIX
  IPAddress primaryDNS(8, 8, 8, 8);   
  IPAddress secondaryDNS(8, 8, 4, 4); 
  WiFi.config(INADDR_NONE, INADDR_NONE, INADDR_NONE, primaryDNS, secondaryDNS);

  // 5. Initial WiFi Start (Non-Blocking)
  Serial.println("Starting WiFi...");
  WiFi.begin(currentSSID.c_str(), currentPass.c_str());
  // We do NOT wait here. We go straight to loop() so switches work immediately.

  // 6. MQTT Config
  espClient.setInsecure(); 
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void callback(char* topic, byte* payload, unsigned int length) {
  blinkFeedback(); 
  String message;
  for (int i = 0; i < length; i++) message += (char)payload[i];
  
  // --- A. CHECK FOR WIFI UPDATE ---
  if (String(topic) == wifiTopic) {
      Serial.println("New Wi-Fi Credentials Received!");
      
      StaticJsonDocument<200> doc;
      deserializeJson(doc, message);
      
      const char* newSSID = doc["ssid"];
      const char* newPass = doc["pass"];
      
      if (newSSID && newPass) {
          Serial.println("Saving and Restarting...");
          
          // Save to Flash Memory
          preferences.begin("my-app", false); // Read-Write mode
          preferences.putString("ssid", newSSID);
          preferences.putString("pass", newPass);
          preferences.end();
          
          delay(1000); // Small delay to ensure save completes
          ESP.restart(); // Reboot to apply changes
      }
      return;
  }

  // --- B. NORMAL SWITCH COMMAND ---
  StaticJsonDocument<200> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (!error) {
    int id = doc["switchId"];
    bool state = doc["state"];
    if (id >= 0 && id < NUM_RELAYS) {
      relayState[id] = state;
      digitalWrite(relayPins[id], state ? LOW : HIGH); 
    }
  }
}

// --- BACKGROUND CONNECTION MANAGERS ---

void handleWiFi() {
  // If connected, do nothing
  if (WiFi.status() == WL_CONNECTED) return;

  // If disconnected, only try reconnecting once every 10 seconds
  unsigned long now = millis();
  if (now - lastWifiAttempt > wifiInterval) {
    lastWifiAttempt = now;
    Serial.println("Reconnecting to WiFi: " + currentSSID);
    // WiFi.disconnect(); // Optional
    WiFi.begin(currentSSID.c_str(), currentPass.c_str()); 
  }
}

void handleMQTT() {
  // Only try MQTT if WiFi is ready
  if (WiFi.status() != WL_CONNECTED) return;
  // If already connected, do nothing
  if (client.connected()) return;

  // If disconnected, try once every 5 seconds
  unsigned long now = millis();
  if (now - lastMqttAttempt > mqttInterval) {
    lastMqttAttempt = now;
    Serial.println("Attempting MQTT connection...");
    
    // Attempt connection
    if (client.connect(deviceId, mqtt_user, mqtt_pass, statusTopic, 0, true, "offline")) {
      Serial.println("MQTT Connected");
      client.publish(statusTopic, "online", true);
      client.subscribe(commandTopic);
      client.subscribe(wifiTopic); // <--- SUBSCRIBE TO WIFI UPDATES
      client.publish(syncTopic, "1"); 
      
      // Quick double blink for success
      digitalWrite(STATUS_LED, HIGH); delay(50); digitalWrite(STATUS_LED, LOW);
      delay(50);
      digitalWrite(STATUS_LED, HIGH); delay(50); digitalWrite(STATUS_LED, LOW);
    }
  }
}

void loop() {
  // --- 1. PRIORITY: MANUAL SWITCHES (Runs continuously) ---
  for(int i=0; i<NUM_RELAYS; i++) {
     int reading = digitalRead(switchPins[i]);
     
     if (reading != lastSwitchState[i]) {
        lastDebounceTime[i] = millis();
     }

     if ((millis() - lastDebounceTime[i]) > debounceDelay) {
        static int stableState[NUM_RELAYS] = {HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH};
        
        if (reading != stableState[i]) {
           stableState[i] = reading;
           blinkFeedback(); 

           relayState[i] = !relayState[i];
           digitalWrite(relayPins[i], relayState[i] ? LOW : HIGH);
           
           // Only send to server if connected (Prevents lag)
           if (client.connected()) {
             StaticJsonDocument<200> doc;
             doc["switchId"] = i;
             doc["state"] = relayState[i];
             char buffer[256];
             serializeJson(doc, buffer);
             client.publish(updateTopic, buffer);
           }
        }
     }
     lastSwitchState[i] = reading;
  }

  // --- 2. BACKGROUND TASKS ---
  handleWiFi(); // Check WiFi status every 10s
  handleMQTT(); // Check MQTT status every 5s
  
  if (client.connected()) {
    client.loop(); // Handle incoming MQTT messages
  }
}