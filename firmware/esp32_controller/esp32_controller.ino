#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h> 
#include <Preferences.h>
#include <WiFiManager.h> 
#include <time.h>
#include <DHT.h> 
#include <esp_task_wdt.h> // For Hardware Watchdog
#include <HTTPClient.h>   // For downloading updates
#include <HTTPUpdate.h>   // <--- ADD THIS LINE FOR OTA
#include <Update.h>       // For installing updates

#define DHTPIN 13     // Pin where DHT11 is connected
#define DHTTYPE DHT11 // Sensor type
DHT dht(DHTPIN, DHTTYPE); 

// --- PRODUCTION CONFIGURATION ---
#define WDT_TIMEOUT 10 // 10 Seconds Hardware Watchdog Timeout

// 1. SSL CERTIFICATE (HiveMQ Cloud)
const char* root_ca = \
"-----BEGIN CERTIFICATE-----\n" \
"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\n" \
"-----END CERTIFICATE-----";

// MQTT Broker
const char* mqtt_server = "b05e6bbab5eb466db17fd7a4403f054e.s1.eu.hivemq.cloud";
const int mqtt_port = 8883; 
String mqtt_user; // Empty initially
String mqtt_pass;
// --- DYNAMIC GLOBALS ---
String uniqueDeviceId; 
String commandTopic;
String updateTopic;
String syncTopic;
String statusTopic;
String sensorTopic; 
String wifiTopic; 
String otaTopic; // [NEW] OTA Topic

unsigned long lastWifiCheck = 0; 

// CONFIGURATION: Thresholds
const float TEMP_THRESHOLD = 1.0; 
const float HUM_THRESHOLD = 10.0;

unsigned long lastDhtCheck = 0;   
float lastTemp = 0;
float lastHum = 0;

// --- PINS ---
const int NUM_RELAYS = 9; 

// [FIXED] Relay 9 is now on GPIO 4 (Safe Pin)
const int relayPins[NUM_RELAYS] = {22, 23, 14, 27, 26, 25, 33, 32, 4}; 

// [FIXED] Switch 9 is now on GPIO 35 (Input Only - Needs Resistor)
const int switchPins[NUM_RELAYS] = {15, 16, 17, 5, 18, 19, 21, 34, 35}; 

// Flags for saving state safely
volatile bool saveNeeded[NUM_RELAYS] = {false};

const int STATUS_LED = 2;
const int TOUCH_RESET_PIN = 0; // Boot Button

// --- OBJECTS ---
WiFiClientSecure espClient;
PubSubClient client(espClient);
Preferences preferences; 

// Volatile for Thread Safety
volatile bool relayState[NUM_RELAYS] = {false};
volatile bool triggerSwitchFeedback = false; 

int lastSwitchState[NUM_RELAYS] = {HIGH};
unsigned long lastDebounceTime[NUM_RELAYS] = {0};
unsigned long debounceDelay = 50;

// TIMERS & BACKOFF
unsigned long lastMqttAttempt = 0;
unsigned long currentBackoff = 5000; // Start backoff at 5s
int mqttRetryCount = 0;
unsigned long lastHeartbeat = 0;
unsigned long touchStartTime = 0; 

// LED STATE MANAGEMENT
enum SystemState {
  STATE_IDLE,       // Everything OK (LED OFF)
  STATE_NO_WIFI,    // Fast Blink (200ms)
  STATE_NO_MQTT,    // Slow Blink (1000ms)
  STATE_SETUP,      // Solid ON
  STATE_FEEDBACK    // Quick Pulse
};

SystemState currentSystemState = STATE_NO_WIFI;
SystemState lastLoggedState = STATE_IDLE; 
unsigned long previousLedMillis = 0;
bool ledState = LOW;
unsigned long blinkStartTime = 0;
bool isBlinking = false;
const int FEEDBACK_DURATION = 100;

// Multithreading
TaskHandle_t SwitchTask; 
bool mqttNeedsUpdate[NUM_RELAYS] = {false};

// --- HELPER: SAVE & LOAD STATE ---
void saveState(int id, bool state) {
  char key[10];
  sprintf(key, "sw_%d", id);
  preferences.putBool(key, state);
}

void loadState() {
  for(int i=0; i<NUM_RELAYS; i++) {
    char key[10];
    sprintf(key, "sw_%d", i);
    relayState[i] = preferences.getBool(key, false); 
    digitalWrite(relayPins[i], relayState[i] ? LOW : HIGH);
  }
}

// --- CORE 0: SWITCH TASK & EMERGENCY RESET ---
void switchTaskCode(void *PvParameters) {
  int stableState[NUM_RELAYS];
  unsigned long buttonPressStart = 0; // Timer for the Boot Button

  // 1. Read actual hardware state on startup
  for(int i=0; i<NUM_RELAYS; i++) {
     stableState[i] = digitalRead(switchPins[i]);
     lastSwitchState[i] = stableState[i]; 
  }

  for (;;) {
    // --- EMERGENCY RESET BUTTON LOGIC (Always Active) ---
    // Runs on Core 0, so it works even if WiFi is broken/frozen
    if (digitalRead(TOUCH_RESET_PIN) == LOW) {
        // Start Timer
        if (buttonPressStart == 0) {
            buttonPressStart = millis();
            Serial.println("[Task] Boot Button Pressed...");
        }

        unsigned long heldTime = millis() - buttonPressStart;

        // Visual Feedback (Fast Blink while holding)
        if (heldTime > 500) {
            digitalWrite(STATUS_LED, (millis() / 100) % 2); 
        }

        // ACTION: Factory Reset after 4 Seconds
        if (heldTime > 4000) {
            Serial.println("[Task] EMERGENCY RESET TRIGGERED!");
            
            // 1. Wipe WiFi Credentials (SSID/Pass)
            WiFi.disconnect(true, true); 
            delay(500);
            
            // 2. Wipe Relay States (Optional)
            preferences.begin("relays", false);
            preferences.clear();
            preferences.end();
            
            // 3. Force Reboot
            // The device will restart, see no WiFi, and start the Setup AP.
            ESP.restart(); 
        }
    } else {
        // Button Released
        buttonPressStart = 0;
        // Make sure LED isn't stuck ON if we released early
        // (The main loop will take over LED control again)
    }

    // --- NORMAL SWITCH LOGIC ---
    for(int i=0; i<NUM_RELAYS; i++) {
       int reading = digitalRead(switchPins[i]);
       
       if (reading != lastSwitchState[i]) lastDebounceTime[i] = millis();

       if ((millis() - lastDebounceTime[i]) > debounceDelay) {
          if (reading != stableState[i]) {
             stableState[i] = reading;
             
             triggerSwitchFeedback = true; 
             relayState[i] = !relayState[i];
             digitalWrite(relayPins[i], relayState[i] ? LOW : HIGH);
             
             saveNeeded[i] = true;
             mqttNeedsUpdate[i] = true;
          }
       }
       lastSwitchState[i] = reading;
    }
    vTaskDelay(10 / portTICK_PERIOD_MS);
  }
}

// --- LED HANDLER ---
void handleLedStatus() {
  unsigned long now = millis();

  // 1. Switch Feedback Pulse
  if (triggerSwitchFeedback) {
      triggerSwitchFeedback = false; 
      digitalWrite(STATUS_LED, HIGH);
      blinkStartTime = now;
      isBlinking = true;
      return; 
  }

  if (isBlinking) {
      if (now - blinkStartTime >= FEEDBACK_DURATION) {
          digitalWrite(STATUS_LED, LOW);
          isBlinking = false;
      }
      return; 
  }

  // 2. System State Logic
  bool currentMqtt = client.connected();
  bool currentWifi = (WiFi.status() == WL_CONNECTED);

  if (!currentWifi) currentSystemState = STATE_NO_WIFI;
  else if (!currentMqtt) currentSystemState = STATE_NO_MQTT;
  else currentSystemState = STATE_IDLE;

  switch (currentSystemState) {
    case STATE_NO_WIFI:
      if (now - previousLedMillis >= 200) {
        previousLedMillis = now;
        ledState = !ledState;
        digitalWrite(STATUS_LED, ledState);
      }
      break;

    case STATE_NO_MQTT:
      if (now - previousLedMillis >= 1000) {
        previousLedMillis = now;
        ledState = !ledState;
        digitalWrite(STATUS_LED, ledState);
      }
      break;

    case STATE_IDLE:
      digitalWrite(STATUS_LED, LOW); 
      break;
      
    default:
      digitalWrite(STATUS_LED, LOW);
      break;
  }
}

// --- [NEW] OTA UPDATE FUNCTION ---
void performOTA(String url) {
    Serial.println("[OTA] Starting Update from: " + url);
    
    // Stop operations
    client.disconnect(); 
    
    WiFiClientSecure otaClient;
    otaClient.setCACert(root_ca); // Use the same HiveMQ SSL cert or add Let's Encrypt Root
    otaClient.setInsecure(); // Or use setInsecure() if file server cert varies
    
    t_httpUpdate_return ret = httpUpdate.update(otaClient, url);

    switch (ret) {
      case HTTP_UPDATE_FAILED:
        Serial.printf("[OTA] Error (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
        break;
      case HTTP_UPDATE_NO_UPDATES:
        Serial.println("[OTA] No Update Found");
        break;
      case HTTP_UPDATE_OK:
        Serial.println("[OTA] Update OK! Restarting...");
        ESP.restart(); 
        break;
    }
}

// --- MQTT CALLBACK ---
void callback(char* topic, byte* payload, unsigned int length) {
  triggerSwitchFeedback = true; 
  String message;
  for (int i = 0; i < length; i++) message += (char)payload[i];
  Serial.print("[MQTT] Recv: ");
  Serial.println(topic);

  // 1. OTA Command
  if (String(topic) == otaTopic) {
      StaticJsonDocument<200> doc;
      deserializeJson(doc, message);
      const char* downloadUrl = doc["url"];
      if (downloadUrl) {
          performOTA(String(downloadUrl));
      }
      return;
  }

  // 2. WiFi Update
  if (String(topic) == wifiTopic) {
      StaticJsonDocument<200> doc;
      deserializeJson(doc, message);
      const char* newSSID = doc["ssid"];
      const char* newPass = doc["pass"];
      if (newSSID && newPass) {
          Serial.println("[MQTT] Remote WiFi Update...");
          WiFi.disconnect(); 
          delay(100);
          WiFi.begin(newSSID, newPass); 
          delay(2000); 
          ESP.restart(); 
      }
      return;
  }

  // 3. Switch Control
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, message);
  if (!error) {
    int id = doc["switchId"];
    bool state = doc["state"];
    if (id >= 0 && id < NUM_RELAYS) {
      relayState[id] = state;
      digitalWrite(relayPins[id], state ? LOW : HIGH); 
      saveState(id, state); 
      Serial.printf("[MQTT] Sw %d -> %s\n", id, state ? "ON" : "OFF");
    }
  }
}

void setClock() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov"); 
  Serial.print(F("Syncing Time"));
  time_t nowSecs = time(nullptr);
  int retry = 0;
  while (nowSecs < 8 * 3600 * 2 && retry < 20) { 
    delay(500);
    Serial.print(".");
    yield();
    nowSecs = time(nullptr);
    retry++;
  }
  Serial.println(" Done");
}

void checkWiFiConnection() {
  if (millis() - lastWifiCheck > 10000) { 
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Lost. Retrying...");
      WiFi.reconnect(); 
    }
  }
}

void blinkFast() {
  digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
}

void configModeCallback (WiFiManager *myWiFiManager) {
  Serial.println("[Setup] Config Mode Started");
  digitalWrite(STATUS_LED, HIGH); 
}

// --- SETUP ---
void setup() {
  Serial.begin(115200);
  Serial.println("\n[Boot] System Starting...");
  
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW); 
  
  // --- [NEW] LOAD SECRETS FROM MEMORY ---
  // Security Step: Read MQTT User/Pass from NVS
  preferences.begin("creds", true); // Open "creds" in Read-Only mode
  mqtt_user = preferences.getString("user", ""); 
  mqtt_pass = preferences.getString("pass", "");
  preferences.end();

  // Security Check: If memory is empty, STOP.
  if (mqtt_user == "" || mqtt_pass == "") {
      Serial.println("[FATAL ERROR] No Credentials Found in NVS!");
      Serial.println("Please run the Provisioning Sketch first.");
      while(1) {
          // Blink SOS Pattern to alert factory worker
          digitalWrite(STATUS_LED, HIGH); delay(100);
          digitalWrite(STATUS_LED, LOW);  delay(100);
      }
  }
  Serial.println("[Boot] Credentials Loaded Successfully");
  // --------------------------------------

  preferences.begin("relays", false);
  pinMode(TOUCH_RESET_PIN, INPUT_PULLUP); 

  // --- FACTORY RESET LOGIC ---
  if (digitalRead(TOUCH_RESET_PIN) == LOW) { 
    Serial.println("[Boot] Reset Button Detected...");
    for(int i=0; i<20; i++) { 
        blinkFast(); 
        delay(100); 
    }
    if (digitalRead(TOUCH_RESET_PIN) == LOW) {
        Serial.println("[Boot] Wiping Data...");
        WiFiManager wm;
        wm.resetSettings(); 
        preferences.clear(); // Wipes Relay States
        // Note: We do NOT wipe "creds" here, so user/pass persists after reset!
        digitalWrite(STATUS_LED, HIGH); 
        delay(1000);
        ESP.restart();
    }
  }
  
  // --- GPIO INIT ---
  for(int i=0; i<NUM_RELAYS; i++) {
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], HIGH); 

    // Handle Input-Only pins for switches
    if (switchPins[i] >= 34) {
      pinMode(switchPins[i], INPUT); // Requires external 10k resistor!
    } else {
      pinMode(switchPins[i], INPUT_PULLUP);
    }
    
    lastSwitchState[i] = digitalRead(switchPins[i]);
  }

  loadState();

  xTaskCreatePinnedToCore(switchTaskCode, "SwitchTask", 10000, NULL, 1, &SwitchTask, 0);

  WiFi.mode(WIFI_STA); 
  delay(100); 

  String mac = WiFi.macAddress();
  mac.replace(":", ""); 
  uniqueDeviceId = "esp32_" + mac; 
  Serial.println("[Boot] ID: " + uniqueDeviceId);

  // Topic Definitions
  commandTopic = "devices/" + uniqueDeviceId + "/command";
  updateTopic = "devices/" + uniqueDeviceId + "/update";
  syncTopic = "devices/" + uniqueDeviceId + "/sync";
  statusTopic = "devices/" + uniqueDeviceId + "/status";
  wifiTopic = "devices/" + uniqueDeviceId + "/wifi";
  sensorTopic = "devices/" + uniqueDeviceId + "/sensor"; 
  otaTopic = "devices/" + uniqueDeviceId + "/ota";

  dht.begin(); 

  // --- WIFI MANAGER ---
  WiFiManager wm;
  String apName = "SmartHome_Setup_" + mac.substring(8); 
  wm.setAPCallback(configModeCallback);
  wm.setConnectTimeout(180); 

  // CRITICAL: Watchdog starts AFTER this block
  if(!wm.autoConnect(apName.c_str())) {
      Serial.println("[WiFi] Failed. Offline Mode.");
  } else {
      Serial.println("[WiFi] Connected!");
      setClock(); 
      espClient.setCACert(root_ca);
      client.setServer(mqtt_server, mqtt_port);
      client.setCallback(callback);
      client.setBufferSize(4096); 
      client.setKeepAlive(15);
  }

  // START WATCHDOG HERE (Final Step) 
  esp_task_wdt_config_t twdt_config = {
      .timeout_ms = WDT_TIMEOUT * 1000,
      .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
      .trigger_panic = true
  };
  esp_task_wdt_init(&twdt_config);
  esp_task_wdt_add(NULL); 
}

// --- MQTT HANDLING WITH BACKOFF ---
void handleMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  
  if (client.connected()) { 
      currentBackoff = 5000; // Reset backoff on success
      mqttRetryCount = 0; 
      return; 
  }

  unsigned long now = millis();
  if (now - lastMqttAttempt > currentBackoff) {
    lastMqttAttempt = now;
    
    // Exponential Backoff Logic
    currentBackoff = currentBackoff * 2;
    if (currentBackoff > 120000) currentBackoff = 120000; // Max 2 mins
    
    Serial.printf("[MQTT] Connecting (Backoff: %lu ms)... ", currentBackoff);
    
    String clientId = uniqueDeviceId + "-" + String(random(0xffff), HEX);
    const char* willTopic = statusTopic.c_str();
    
    // Use .c_str() to convert String to the format MQTT needs
    if (client.connect(clientId.c_str(), mqtt_user.c_str(), mqtt_pass.c_str(), willTopic, 1, true, "offline")) {
      Serial.println("Success");
      // 1. DELETE OLD GHOST COMMANDS
      // We publish an empty message with Retain=True to the command topic. 
      // This wipes any "Turn Off" commands waiting on the server.
      client.publish(commandTopic.c_str(), "", true); 

      // 2. FORCE UPLOAD CURRENT STATE
      // We loop through all switches and tell the server their REAL status now.
      for(int i=0; i<NUM_RELAYS; i++) {
           StaticJsonDocument<256> doc;
           doc["switchId"] = i;
           doc["state"] = relayState[i]; // Send the ACTUAL current state
           char buffer[256];
           serializeJson(doc, buffer);
           // Retain=true ensures the App sees this state immediately
           client.publish(updateTopic.c_str(), buffer, true); 
      }
      
      client.publish(statusTopic.c_str(), "online", true);
      client.subscribe(commandTopic.c_str());
      client.subscribe(wifiTopic.c_str()); 
      client.subscribe(otaTopic.c_str()); // Subscribe to OTA
      client.publish(syncTopic.c_str(), "1"); 
    } else {
      Serial.print("Fail rc=");
      Serial.println(client.state());
    }
  }
}

void loop() {
  // 1. Pet the Watchdog (Keep the system alive)
  esp_task_wdt_reset();

  // Note: The Emergency Reset Button logic is now in switchTaskCode (Core 0)
  // so it works perfectly even if WiFi/Loop is blocked.

  // 2. Connectivity & LED Checks
  checkWiFiConnection(); 
  handleLedStatus(); 
  
  // 3. Sensor Logic (Runs every 2 seconds)
  if (millis() - lastDhtCheck > 2000) {
    lastDhtCheck = millis();
    float currentTemp = dht.readTemperature();
    float currentHum = dht.readHumidity();

    if (!isnan(currentTemp) && !isnan(currentHum)) {
        float tempDiff = abs(currentTemp - lastTemp);
        float humDiff = abs(currentHum - lastHum);

        // Only send if values changed significantly
        if (tempDiff >= TEMP_THRESHOLD || humDiff >= HUM_THRESHOLD) {
            lastTemp = currentTemp;
            lastHum = currentHum;
            if (WiFi.status() == WL_CONNECTED && client.connected()) {
                StaticJsonDocument<128> doc;
                doc["temp"] = currentTemp;
                doc["hum"] = currentHum;
                char buffer[128];
                serializeJson(doc, buffer);
                client.publish(sensorTopic.c_str(), buffer);
            }
        }
    }
  }
  
  // 4. MQTT & Server Updates
  if (WiFi.status() == WL_CONNECTED) {
      if (client.connected()) {
          // Send any pending Switch Updates to Server
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
          // Send Heartbeat every 30s
          if (millis() - lastHeartbeat > 30000) {
             lastHeartbeat = millis();
             client.publish(statusTopic.c_str(), "online", true);
          }
          client.loop();
      }
      handleMQTT(); 
  }

  // 5. SAFE SAVING (Runs even if Offline!)
  for(int i=0; i<NUM_RELAYS; i++) {
      if(saveNeeded[i]) {
          saveNeeded[i] = false; 
          saveState(i, relayState[i]); 
          Serial.printf("[System] State saved for Switch %d\n", i);
      }
  }
}