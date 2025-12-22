#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h> 
#include <Preferences.h> 

// --- CONFIGURATION ---
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
const char* wifiTopic = "devices/esp32_001/wifi"; 

// --- PINS ---
const int NUM_RELAYS = 8;
const int relayPins[NUM_RELAYS] = {22, 23, 14, 27, 26, 25, 33, 32};
const int switchPins[NUM_RELAYS] = {15,  4, 16, 17,  5, 18, 19, 21};
const int STATUS_LED = 2;

// --- GLOBALS ---
WiFiClientSecure espClient;
PubSubClient client(espClient);
Preferences preferences; 

String currentSSID;
String currentPass;

// Switch State Tracking
bool relayState[NUM_RELAYS] = {false};
int lastSwitchState[NUM_RELAYS] = {HIGH}; 
unsigned long lastDebounceTime[NUM_RELAYS] = {0};
unsigned long debounceDelay = 50;

// TIMERS
unsigned long lastWifiAttempt = 0;
unsigned long lastMqttAttempt = 0;
const unsigned long wifiInterval = 10000; 
const unsigned long mqttInterval = 5000; 
int wifiRetryCount = 0; // Tracks failed attempts
int mqttRetryCount = 0; // <--- NEW: Tracks failed MQTT attempts

// Heartbeat Timer
unsigned long lastHeartbeat = 0;

// --- LED STATUS VARIABLES ---
int ledState = LOW;
unsigned long previousLedMillis = 0;
unsigned long successStateStart = 0;
bool isSuccessAnim = false;       
bool wifiKnownConnected = false;  
bool mqttKnownConnected = false;  

// Manual Blink Tracking (Non-Blocking)
unsigned long blinkStartTime = 0;
bool isBlinking = false;
const int BLINK_DURATION = 100;

// --- HELPER: Trigger Manual Blink ---
void blinkFeedback() {
  digitalWrite(STATUS_LED, HIGH);
  blinkStartTime = millis();
  isBlinking = true;
}

// --- HELPER: Manage All LED Patterns ---
void handleLedStatus() {
  unsigned long now = millis();
  bool currentWifi = (WiFi.status() == WL_CONNECTED);
  bool currentMqtt = client.connected();

  // 1. Detect Transitions for 2s Success Light
  if (currentWifi && !wifiKnownConnected) {
      wifiKnownConnected = true;
      isSuccessAnim = true;
      successStateStart = now;
      digitalWrite(STATUS_LED, HIGH); 
  }
  if (!currentWifi) wifiKnownConnected = false;

  if (currentMqtt && !mqttKnownConnected) {
      mqttKnownConnected = true;
      isSuccessAnim = true;
      successStateStart = now;
      digitalWrite(STATUS_LED, HIGH); 
  }
  if (!currentMqtt) mqttKnownConnected = false;

  // 2. Handle LED Priorities
  
  // PRIORITY A: Success Animation (2s Solid ON)
  if (isSuccessAnim) {
      if (now - successStateStart > 2000) {
          isSuccessAnim = false;
          digitalWrite(STATUS_LED, LOW);
      } else {
           digitalWrite(STATUS_LED, HIGH); 
      }
      return; 
  }

  // PRIORITY B: WiFi Connecting (Fast Blink - 100ms)
  if (!currentWifi) {
      if (now - previousLedMillis >= 100) {
          previousLedMillis = now;
          ledState = !ledState;
          digitalWrite(STATUS_LED, ledState);
      }
      return;
  } 
  
  // PRIORITY C: MQTT Connecting (Slow Blink - 300ms)
  else if (!currentMqtt) {
      if (now - previousLedMillis >= 300) {
          previousLedMillis = now;
          ledState = !ledState;
          digitalWrite(STATUS_LED, ledState);
      }
      return;
  } 
  
  // PRIORITY D: Idle (Manual Switch Feedback)
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



// --- MULTITHREADING VARIABLES ---
TaskHandle_t SwitchTask; 
bool mqttNeedsUpdate[NUM_RELAYS] = {false}; // Flag to sync Core 0 and Core 1

// --- CORE 0: DEDICATED SWITCH TASK (Runs independently) ---
void switchTaskCode(void * pvParameters) {
  for (;;) { // Infinite loop for this core
    // 1. Check Switches
    for(int i=0; i<NUM_RELAYS; i++) {
       int reading = digitalRead(switchPins[i]);
       
       if (reading != lastSwitchState[i]) {
          lastDebounceTime[i] = millis();
       }

       if ((millis() - lastDebounceTime[i]) > debounceDelay) {
          static int stableState[NUM_RELAYS] = {HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH};
          
          if (reading != stableState[i]) {
             stableState[i] = reading;
             blinkFeedback(); // Blink LED

             relayState[i] = !relayState[i];
             digitalWrite(relayPins[i], relayState[i] ? LOW : HIGH);
             
             // Mark this switch as "Needs Update" for the Main Loop to handle
             mqttNeedsUpdate[i] = true; 
          }
       }
       lastSwitchState[i] = reading;
    }
    // Small delay to prevent crashing the CPU Watchdog
    vTaskDelay(10 / portTICK_PERIOD_MS); 
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

  // --- LOAD WIFI ---
  preferences.begin("my-app", true); 
  currentSSID = preferences.getString("ssid", default_ssid); 
  currentPass = preferences.getString("pass", default_password);
  preferences.end();

  Serial.println("Loaded Config:");
  Serial.println("SSID: " + currentSSID);

  IPAddress primaryDNS(8, 8, 8, 8);   
  IPAddress secondaryDNS(8, 8, 4, 4); 
  WiFi.config(INADDR_NONE, INADDR_NONE, INADDR_NONE, primaryDNS, secondaryDNS);
  WiFi.setSleep(false); 

  Serial.println("Starting WiFi...");
  WiFi.begin(currentSSID.c_str(), currentPass.c_str());

  espClient.setInsecure(); 
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  
  // Fixes for Speed & Stability
  client.setBufferSize(1024); 
  client.setKeepAlive(5);
  client.setSocketTimeout(4);  

  // --- START BACKGROUND TASK FOR SWITCHES (Core 0) ---
  xTaskCreatePinnedToCore(
      switchTaskCode,   // Function to run
      "SwitchTask",     // Name
      10000,            // Stack size
      NULL,             // Parameters
      1,                // Priority
      &SwitchTask,      // Task Handle
      0);               // Core ID (0 = Background, 1 = Main Loop)
      
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
          preferences.begin("my-app", false); 
          preferences.putString("ssid", newSSID);
          preferences.putString("pass", newPass);
          preferences.end();
          delay(1000); 
          ESP.restart(); 
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
  // 1. If connected, reset counter and exit
  if (WiFi.status() == WL_CONNECTED) {
      wifiRetryCount = 0; 
      return;
  }

  unsigned long now = millis();
  if (now - lastWifiAttempt > wifiInterval) {
    lastWifiAttempt = now;
    wifiRetryCount++; 

    Serial.print("Reconnecting to WiFi: ");
    Serial.print(currentSSID);
    Serial.print(" (Attempt ");
    Serial.print(wifiRetryCount);
    Serial.println("/10)");

    // --- SELF-HEALING LOGIC ---
    // If failed 5 times, wipe memory and restart to default
    if (wifiRetryCount >= 10) {
        Serial.println("\n!!! CONNECTION FAILED REPEATEDLY !!!");
        Serial.println("Wiping bad Wi-Fi settings and restarting...");
        
        preferences.begin("my-app", false); 
        preferences.clear(); // WIPE ALL SAVED DATA
        preferences.end();
        
        digitalWrite(STATUS_LED, HIGH); delay(100); digitalWrite(STATUS_LED, LOW); delay(100);
        digitalWrite(STATUS_LED, HIGH); delay(100); digitalWrite(STATUS_LED, LOW);
        delay(1000);
        ESP.restart(); 
    }

    // --- FORCE DISCONNECT & RETRY ---
    WiFi.disconnect(); 
    WiFi.mode(WIFI_OFF);   
    delay(100);            
    WiFi.mode(WIFI_STA);   
    WiFi.begin(currentSSID.c_str(), currentPass.c_str()); 
  }
}

void handleMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  // 1. If connected, reset counter and exit
  if (client.connected()) {
      mqttRetryCount = 0; // Reset counter on success
      return; 
  }

  unsigned long now = millis();
  if (now - lastMqttAttempt > mqttInterval) {
    lastMqttAttempt = now;
    mqttRetryCount++; // Increment failure counter

    Serial.print("Attempting MQTT connection... (");
    Serial.print(mqttRetryCount);
    Serial.println("/5)");

    // --- SELF-HEALING LOGIC (NEW) ---
    // If MQTT fails 5 times, maybe the network firewall is blocking it or WiFi is "fake" connected.
    // Wipe settings and restart to Default WiFi.
    if (mqttRetryCount >= 5) {
        Serial.println("\n!!! MQTT FAILED REPEATEDLY !!!");
        Serial.println("Wiping bad Wi-Fi settings and restarting...");
        
        preferences.begin("my-app", false); 
        preferences.clear(); // WIPE ALL SAVED DATA
        preferences.end();
        
        // Visual warning (Fast double blink)
        digitalWrite(STATUS_LED, HIGH); delay(100); digitalWrite(STATUS_LED, LOW); delay(100);
        digitalWrite(STATUS_LED, HIGH); delay(100); digitalWrite(STATUS_LED, LOW);
        delay(1000);
        ESP.restart(); 
    }

    // Attempt connection
    String randomClientId = String(deviceId) + "-" + String(random(0xffff), HEX);

    if (client.connect(randomClientId.c_str(), mqtt_user, mqtt_pass, statusTopic, 0, true, "offline")) {
      Serial.println("MQTT Connected");
      mqttRetryCount = 0; // <--- IMPORTANT: Reset counter on success
      
      client.publish(statusTopic, "online", true);
      client.subscribe(commandTopic);
      client.subscribe(wifiTopic); 
      client.publish(syncTopic, "1"); 
    } else {
      Serial.print("Failed, rc=");
      Serial.println(client.state());
    }
  }
}
void loop() {
  // --- 1. HANDLE LED STATUS ---
  handleLedStatus();

  // --- 2. HANDLE MQTT UPDATES ---
  if (client.connected()) {
      for(int i=0; i<NUM_RELAYS; i++) {
          if (mqttNeedsUpdate[i]) {
              mqttNeedsUpdate[i] = false; 
              StaticJsonDocument<200> doc;
              doc["switchId"] = i;
              doc["state"] = relayState[i];
              char buffer[256];
              serializeJson(doc, buffer);
              client.publish(updateTopic, buffer);
          }
      }
      
      // --- NEW: HEARTBEAT (Fixes "Offline" Status Bug) ---
      // Every 30 seconds, force-tell the server "I AM ONLINE"
      if (millis() - lastHeartbeat > 30000) {
         lastHeartbeat = millis();
         client.publish(statusTopic, "online", true);
         Serial.println("Sent Heartbeat: Online");
      }
      
      client.loop(); 
  }

  // --- 3. CONNECTION MANAGEMENT ---
  handleWiFi(); 
  handleMQTT(); 
}