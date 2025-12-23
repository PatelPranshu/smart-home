#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h> 
#include <Preferences.h>
#include <WiFiManager.h> // <--- REQUIRED LIBRARY
#include <time.h>

// --- CONFIGURATION ---

// 1. SSL CERTIFICATE (Required for HiveMQ Cloud)
const char* root_ca = \
"-----BEGIN CERTIFICATE-----\n" \
"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\n" \
"-----END CERTIFICATE-----";

// MQTT Broker
const char* mqtt_server = "6c37b4fdae72447883f91b6cc992648e.s1.eu.hivemq.cloud";
const int mqtt_port = 8883; // Secure Port
const char* mqtt_user = "backend_admin";
const char* mqtt_pass = "Admin@3500";

// --- DYNAMIC GLOBALS (Defined at runtime) ---
String uniqueDeviceId; 
String commandTopic;
String updateTopic;
String syncTopic;
String statusTopic;
String wifiTopic; 
String currentSSID = "Unknown"; // For display only
int wifiRetryCount = 0;
unsigned long lastWifiCheck = 0;

// --- PINS ---
const int NUM_RELAYS = 8;
const int relayPins[NUM_RELAYS] = {22, 23, 14, 27, 26, 25, 33, 32};
const int switchPins[NUM_RELAYS] = {15,  4, 16, 17,  5, 18, 19, 21};
const int STATUS_LED = 2;

// --- OBJECTS ---
WiFiClientSecure espClient;
PubSubClient client(espClient);
Preferences preferences; 

// Switch State Tracking
bool relayState[NUM_RELAYS] = {false};
int lastSwitchState[NUM_RELAYS] = {HIGH}; 
unsigned long lastDebounceTime[NUM_RELAYS] = {0};
unsigned long debounceDelay = 50;

// TIMERS
unsigned long lastMqttAttempt = 0;
const unsigned long mqttInterval = 5000;
int mqttRetryCount = 0;
unsigned long lastHeartbeat = 0;

// LED Status
int ledState = LOW;
unsigned long previousLedMillis = 0;
unsigned long successStateStart = 0;
bool isSuccessAnim = false;       
bool mqttKnownConnected = false;
unsigned long blinkStartTime = 0;
bool isBlinking = false;
const int BLINK_DURATION = 100;

// Multithreading
TaskHandle_t SwitchTask; 
bool mqttNeedsUpdate[NUM_RELAYS] = {false};

// --- HELPER: Trigger Manual Blink ---
void blinkFeedback() {
  digitalWrite(STATUS_LED, HIGH);
  blinkStartTime = millis();
  isBlinking = true;
}

// --- HELPER: Manage All LED Patterns ---
void handleLedStatus() {
  unsigned long now = millis();
  bool currentMqtt = client.connected();
  bool currentWifi = (WiFi.status() == WL_CONNECTED);

  // Success Animation logic
  if (currentMqtt && !mqttKnownConnected) {
      mqttKnownConnected = true;
      isSuccessAnim = true;
      successStateStart = now;
      digitalWrite(STATUS_LED, HIGH); 
  }
  if (!currentMqtt) mqttKnownConnected = false;

  if (isSuccessAnim) {
      if (now - successStateStart > 2000) {
          isSuccessAnim = false;
          digitalWrite(STATUS_LED, LOW);
      }
      return; 
  }

  // WiFi Connecting (Fast Blink)
  if (!currentWifi) {
      if (now - previousLedMillis >= 100) {
          previousLedMillis = now;
          ledState = !ledState;
          digitalWrite(STATUS_LED, ledState);
      }
      return;
  } 
  
  // MQTT Connecting (Slow Blink)
  else if (!currentMqtt) {
      if (now - previousLedMillis >= 300) {
          previousLedMillis = now;
          ledState = !ledState;
          digitalWrite(STATUS_LED, ledState);
      }
      return;
  } 
  
  // Idle / Feedback
  else {
      if (isBlinking) {
          if (now - blinkStartTime >= BLINK_DURATION) {
              digitalWrite(STATUS_LED, LOW);
              isBlinking = false;
          }
      } else {
         digitalWrite(STATUS_LED, LOW);
      }
  }
}

// --- CORE 0: SWITCH TASK ---
void switchTaskCode(void *PvParameters) {
  for (;;) {
    for(int i=0; i<NUM_RELAYS; i++) {
       int reading = digitalRead(switchPins[i]);
       if (reading != lastSwitchState[i]) lastDebounceTime[i] = millis();

       if ((millis() - lastDebounceTime[i]) > debounceDelay) {
          // Adjust HIGH/LOW based on your physical switch type (Momentary vs Toggle)
          static int stableState[NUM_RELAYS] = {HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH}; 
          if (reading != stableState[i]) {
             stableState[i] = reading;
             blinkFeedback(); 
             relayState[i] = !relayState[i];
             digitalWrite(relayPins[i], relayState[i] ? LOW : HIGH);
             mqttNeedsUpdate[i] = true;
          }
       }
       lastSwitchState[i] = reading;
    }
    vTaskDelay(10 / portTICK_PERIOD_MS);
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  blinkFeedback();
  String message;
  for (int i = 0; i < length; i++) message += (char)payload[i];

  // --- A. CHECK FOR WIFI UPDATE ---
  // FIX: This now uses the global wifiTopic variable correctly
  if (String(topic) == wifiTopic) {
      Serial.println("New Wi-Fi Credentials Received via MQTT!");
      
      StaticJsonDocument<200> doc;
      deserializeJson(doc, message);
      const char* newSSID = doc["ssid"];
      const char* newPass = doc["pass"];
      
      if (newSSID && newPass) {
          Serial.println("Updating System Wi-Fi...");
          
          // FIX: Force system to save to NVS by calling begin()
          WiFi.disconnect(); 
          delay(100);
          WiFi.begin(newSSID, newPass); 
          
          // Wait a moment for the ESP32 to write to flash memory
          delay(2000); 
          
          Serial.println("Restarting to apply changes...");
          ESP.restart(); 
      }
      return;
  }

  // --- B. NORMAL SWITCH COMMAND ---
  StaticJsonDocument<512> doc;
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

// --- HELPER: Sync Time for SSL Validation ---
void setClock() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov"); // UTC time

  Serial.print(F("Waiting for NTP time sync: "));
  time_t nowSecs = time(nullptr);
  while (nowSecs < 8 * 3600 * 2) { // Wait until time is > year 2016 roughly
    delay(500);
    Serial.print(F("."));
    yield();
    nowSecs = time(nullptr);
  }

  Serial.println();
  struct tm timeinfo;
  gmtime_r(&nowSecs, &timeinfo);
  Serial.print(F("Current time: "));
  Serial.print(asctime(&timeinfo));
}

void checkWiFiConnection() {
  // Only run this check every 10 seconds to avoid spamming
  if (millis() - lastWifiCheck > 10000) { 
    lastWifiCheck = millis();

    if (WiFi.status() != WL_CONNECTED) {
      wifiRetryCount++;
      Serial.print("WiFi connection lost. Retry count: ");
      Serial.println(wifiRetryCount);
      
      // Attempt to reconnect visually
      WiFi.reconnect();

      // --- THE SELF-HEALING BLOCK ---
      if (wifiRetryCount >= 1) {
        Serial.println("\n!!! CONNECTION FAILED REPEATEDLY (2 Mins) !!!");
        Serial.println("Wiping bad Wi-Fi settings and restarting...");
        
        // 1. Wipe WiFiManager settings
        WiFiManager wm;
        wm.resetSettings();
        
        // 2. Wipe Preferences (as requested)
        preferences.clear(); 
        
        // 3. Restart into Setup Mode
        ESP.restart(); 
      }
      // -----------------------------
    } else {
      // If we are connected, reset the counter to 0
      wifiRetryCount = 0;
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW); 

  for(int i=0; i<NUM_RELAYS; i++) {
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], HIGH); 
    pinMode(switchPins[i], INPUT_PULLUP);
    lastSwitchState[i] = digitalRead(switchPins[i]);
  }

  // --- FIX START: Turn on WiFi Radio first ---
  WiFi.mode(WIFI_STA); 
  delay(100); 
  // ------------------------------------------

  // 1. GENERATE UNIQUE ID
  String mac = WiFi.macAddress();
  mac.replace(":", ""); 
  uniqueDeviceId = "esp32_" + mac; 
  
  Serial.println("--------------------------------");
  Serial.println("DEVICE ID: " + uniqueDeviceId);
  Serial.println("--------------------------------");

  // Construct Topics dynamically
  commandTopic = "devices/" + uniqueDeviceId + "/command";
  updateTopic = "devices/" + uniqueDeviceId + "/update";
  syncTopic = "devices/" + uniqueDeviceId + "/sync";
  statusTopic = "devices/" + uniqueDeviceId + "/status";
  
  // FIX: removed 'String' here so it updates the Global Variable
  wifiTopic = "devices/" + uniqueDeviceId + "/wifi";

  // 2. WIFI MANAGER
  WiFiManager wm;
  // wm.resetSettings(); // UNCOMMENT if you need to wipe settings to test again
  
  String apName = "SmartHome_Setup_" + mac.substring(8); 
  bool res = wm.autoConnect(apName.c_str(), "setup123"); 

  if(!res) {
    Serial.println("Failed to connect");
    ESP.restart();
  } 
  Serial.println("WiFi Connected!");
  currentSSID = WiFi.SSID(); // Store for logging

  // 3. SYNC TIME (REQUIRED FOR SSL)
  setClock(); 

  // 4. SECURE MQTT SETUP
  espClient.setCACert(root_ca); // Enable SSL
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setBufferSize(2048); 
  client.setKeepAlive(15);

  // 5. START SWITCH TASK
  xTaskCreatePinnedToCore(switchTaskCode, "SwitchTask", 10000, NULL, 1, &SwitchTask, 0);
}

void handleMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (client.connected()) { mqttRetryCount = 0; return; }

  unsigned long now = millis();
  if (now - lastMqttAttempt > mqttInterval) {
    lastMqttAttempt = now;
    mqttRetryCount++;
    Serial.print("Attempting Secure MQTT connection...");
    
    // Random Client ID prevents disconnection if multiple devices have same code
    String clientId = uniqueDeviceId + "-" + String(random(0xffff), HEX);
    
    // Note: statusTopic.c_str() converts String to const char* for the library
    if (client.connect(clientId.c_str(), mqtt_user, mqtt_pass, statusTopic.c_str(), 0, true, "offline")) {
      Serial.println("connected");
      client.publish(statusTopic.c_str(), "online", true);
      client.subscribe(commandTopic.c_str());
      client.subscribe(wifiTopic.c_str()); 
      client.publish(syncTopic.c_str(), "1"); 
    } else {
      Serial.print("failed, rc=");
      Serial.println(client.state());
    }
  }
}

void loop() {
  checkWiFiConnection();
  handleLedStatus();
  
  if (client.connected()) {
      for(int i=0; i<NUM_RELAYS; i++) {
          if (mqttNeedsUpdate[i]) {
              mqttNeedsUpdate[i] = false;
              StaticJsonDocument<256> doc;
              doc["switchId"] = i;
              doc["state"] = relayState[i];
              char buffer[256];
              serializeJson(doc, buffer);
              client.publish(updateTopic.c_str(), buffer);
          }
      }
      
      // Heartbeat
      if (millis() - lastHeartbeat > 30000) {
         lastHeartbeat = millis();
         client.publish(statusTopic.c_str(), "online", true);
         // PRINT ID FOR DEBUGGING
         Serial.println("Heartbeat sent. ID: " + uniqueDeviceId);
      }
      client.loop();
  }
  
  handleMQTT(); 
}