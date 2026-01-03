#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h> 
#include <Preferences.h>
#include <WiFiManager.h> 
#include <time.h>
#include <DHT.h> 

#define DHTPIN 13     // Pin where DHT11 is connected
#define DHTTYPE DHT11 // Sensor type
DHT dht(DHTPIN, DHTTYPE); 

// --- CONFIGURATION ---

// 1. SSL CERTIFICATE (HiveMQ Cloud)
const char* root_ca = \
"-----BEGIN CERTIFICATE-----\n" \
"MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw\n" \
"TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh\n" \
"cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4\n" \
"WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu\n" \
"ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY\n" \
"MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc\n" \
"h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+\n" \
"0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U\n" \
"A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW\n" \
"T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH\n" \
"B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC\n" \
"B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv\n" \
"KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn\n" \
"OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn\n" \
"jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw\n" \
"qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI\n" \
"rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV\n" \
"HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq\n" \
"hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL\n" \
"ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ\n" \
"3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK\n" \
"NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5\n" \
"ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur\n" \
"TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC\n" \
"jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc\n" \
"oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq\n" \
"4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA\n" \
"mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d\n" \
"emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=\n" \
"-----END CERTIFICATE-----";

// MQTT Broker
const char* mqtt_server = "b05e6bbab5eb466db17fd7a4403f054e.s1.eu.hivemq.cloud";
const int mqtt_port = 8883; 
const char* mqtt_user = "device_fleet_01";
const char* mqtt_pass = "UK!tuzL4P.6N4ku";

// --- DYNAMIC GLOBALS ---
String uniqueDeviceId; 
String commandTopic;
String updateTopic;
String syncTopic;
String statusTopic;
String sensorTopic; 
String wifiTopic; 
unsigned long lastWifiCheck = 0; 

// CONFIGURATION: Thresholds
const float TEMP_THRESHOLD = 0.5; // Update if temp changes by 0.5°C
const float HUM_THRESHOLD = 5.0;  // Update if humidity changes by 5%

// [FIXED] Renamed 'lastDhtRead' to 'lastDhtCheck' to match loop logic
unsigned long lastDhtCheck = 0;   
float lastTemp = 0;
float lastHum = 0;

// --- PINS ---
const int NUM_RELAYS = 9;
const int relayPins[NUM_RELAYS] = {22, 23, 14, 27, 26, 25, 33, 32};
const int switchPins[NUM_RELAYS] = {15, 4, 16, 17, 5, 18, 19, 21};
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

// TIMERS
unsigned long lastMqttAttempt = 0;
const unsigned long mqttInterval = 5000;
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

// --- CORE 0: SWITCH TASK ---
void switchTaskCode(void *PvParameters) {
  int stableState[NUM_RELAYS];
  for(int i=0; i<NUM_RELAYS; i++) stableState[i] = HIGH; 

  for (;;) {
    for(int i=0; i<NUM_RELAYS; i++) {
       int reading = digitalRead(switchPins[i]);
       if (reading != lastSwitchState[i]) lastDebounceTime[i] = millis();

       if ((millis() - lastDebounceTime[i]) > debounceDelay) {
          if (reading != stableState[i]) {
             stableState[i] = reading;
             triggerSwitchFeedback = true; // Request LED feedback
             relayState[i] = !relayState[i];
             digitalWrite(relayPins[i], relayState[i] ? LOW : HIGH);
             saveState(i, relayState[i]);
             mqttNeedsUpdate[i] = true;
          }
       }
       lastSwitchState[i] = reading;
    }
    vTaskDelay(10 / portTICK_PERIOD_MS);
  }
}

// --- NEW LED HANDLER WITH STATES ---
void handleLedStatus() {
  unsigned long now = millis();

  // 1. PRIORITY: Immediate Switch Feedback
  if (triggerSwitchFeedback) {
      triggerSwitchFeedback = false; 
      digitalWrite(STATUS_LED, HIGH);
      blinkStartTime = now;
      isBlinking = true;
      Serial.println("[LED] Feedback Pulse");
      return; 
  }

  // Handle Feedback Duration
  if (isBlinking) {
      if (now - blinkStartTime >= FEEDBACK_DURATION) {
          digitalWrite(STATUS_LED, LOW);
          isBlinking = false;
      }
      return; 
  }

  // 2. DETERMINE STATE
  bool currentMqtt = client.connected();
  bool currentWifi = (WiFi.status() == WL_CONNECTED);

  if (!currentWifi) {
      currentSystemState = STATE_NO_WIFI;
  } else if (!currentMqtt) {
      currentSystemState = STATE_NO_MQTT;
  } else {
      currentSystemState = STATE_IDLE;
  }

  // 3. EXECUTE STATE BLINKING
  switch (currentSystemState) {
    case STATE_NO_WIFI:
      // Fast Blink (200ms) - WiFi Lost / Searching
      if (now - previousLedMillis >= 200) {
        previousLedMillis = now;
        ledState = !ledState;
        digitalWrite(STATUS_LED, ledState);
        if (lastLoggedState != STATE_NO_WIFI) {
           Serial.println("[LED] State: No WiFi (Fast Blink)");
           lastLoggedState = STATE_NO_WIFI;
        }
      }
      break;

    case STATE_NO_MQTT:
      // Slow Blink (1000ms) - Connected to WiFi, but no Server
      if (now - previousLedMillis >= 1000) {
        previousLedMillis = now;
        ledState = !ledState;
        digitalWrite(STATUS_LED, ledState);
        if (lastLoggedState != STATE_NO_MQTT) {
           Serial.println("[LED] State: No MQTT (Slow Blink)");
           lastLoggedState = STATE_NO_MQTT;
        }
      }
      break;

    case STATE_IDLE:
      // Solid OFF - Everything OK
      digitalWrite(STATUS_LED, LOW); 
      if (lastLoggedState != STATE_IDLE) {
          Serial.println("[LED] State: Online (OFF)");
          lastLoggedState = STATE_IDLE;
      }
      break;
      
    default:
      digitalWrite(STATUS_LED, LOW);
      break;
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  triggerSwitchFeedback = true; 
  String message;
  for (int i = 0; i < length; i++) message += (char)payload[i];
  Serial.print("[MQTT] Recv: ");
  Serial.println(topic);

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
  // Infinite Retry Logic
  if (millis() - lastWifiCheck > 10000) { 
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Lost. Retrying background connection...");
      // Do NOT reboot here. Just trigger reconnect.
      WiFi.reconnect(); 
    }
  }
}

void blinkFast() {
  digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
}

// Setup Mode Callback
void configModeCallback (WiFiManager *myWiFiManager) {
  Serial.println("[Setup] Config Mode Started");
  Serial.println("[Setup] Hotspot: " + myWiFiManager->getConfigPortalSSID());
  digitalWrite(STATUS_LED, HIGH); // Solid ON in setup
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n[Boot] System Starting...");
  
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW); 
  
  preferences.begin("relays", false);
  pinMode(TOUCH_RESET_PIN, INPUT_PULLUP); 

  // --- BOOT-TIME FACTORY RESET ---
  if (digitalRead(TOUCH_RESET_PIN) == LOW) { 
    Serial.println("[Boot] Reset Button Detected...");
    for(int i=0; i<20; i++) { 
        blinkFast(); 
        delay(100); 
    }
    if (digitalRead(TOUCH_RESET_PIN) == LOW) {
        Serial.println("[Boot] Wiping Data & Restarting...");
        WiFiManager wm;
        wm.resetSettings(); 
        preferences.clear(); 
        digitalWrite(STATUS_LED, HIGH); 
        delay(1000);
        ESP.restart();
    }
  }
  
  for(int i=0; i<NUM_RELAYS; i++) {
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], HIGH); 
    pinMode(switchPins[i], INPUT_PULLUP);
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

  commandTopic = "devices/" + uniqueDeviceId + "/command";
  updateTopic = "devices/" + uniqueDeviceId + "/update";
  syncTopic = "devices/" + uniqueDeviceId + "/sync";
  statusTopic = "devices/" + uniqueDeviceId + "/status";
  wifiTopic = "devices/" + uniqueDeviceId + "/wifi";
  sensorTopic = "devices/" + uniqueDeviceId + "/sensor"; 

  dht.begin(); // Start Sensor

  // --- WIFIMANAGER SETUP ---
  WiFiManager wm;
  String apName = "SmartHome_Setup_" + mac.substring(8); 
  
  wm.setAPCallback(configModeCallback);
  wm.setConnectTimeout(180); // 3 Minute Timeout

  Serial.println("[WiFi] AutoConnect Started...");
  
  // Attempt to connect. If saved creds exist, it tries them.
  // If connection fails (bad creds OR router off), it starts AP.
  bool res = wm.autoConnect(apName.c_str(), "setup123"); 

  if(!res) {
      Serial.println("[WiFi] Connection/Setup Failed.");
      
      // CRITICAL LOGIC:
      // If we failed to connect AND we have no SSID stored, 
      // it means the device is unconfigured and the user ignored the AP.
      // We MUST REBOOT to bring the AP back up.
      if (WiFi.SSID() == "" || WiFi.SSID().length() == 0) {
          Serial.println("[WiFi] No saved credentials found.");
          Serial.println("[WiFi] Rebooting to restart Config Portal...");
          delay(2000);
          ESP.restart();
      }
      
      // If we have an SSID, it means we are just offline (Router off).
      // We continue without rebooting.
      Serial.println("[WiFi] Credentials found (" + WiFi.SSID() + ").");
      Serial.println("[WiFi] Entering Offline Mode (Infinite Retry).");
  }
  else {
      Serial.println("[WiFi] Connected!");
      Serial.println(WiFi.localIP());
      setClock(); 
      espClient.setCACert(root_ca);
      client.setServer(mqtt_server, mqtt_port);
      client.setCallback(callback);
      client.setBufferSize(2048); 
      client.setKeepAlive(15);
  }
}

void handleMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (client.connected()) { mqttRetryCount = 0; return; }

  unsigned long now = millis();
  if (now - lastMqttAttempt > mqttInterval) {
    lastMqttAttempt = now;
    mqttRetryCount++;
    Serial.print("[MQTT] Connecting... ");
    
    // 1. Random Client ID (Critical for Fleet stability)
    String clientId = uniqueDeviceId + "-" + String(random(0xffff), HEX);
    
    // 2. LWT (Dead Man's Switch) Configuration
    const char* willTopic = statusTopic.c_str();
    const char* willMsg = "offline";
    int willQoS = 1;        // QoS 1 ensures the Broker saves the message
    bool willRetain = true; // KEEP: True ensures the App sees "Offline" instantly
    
    // 3. Connect using the Fleet Credentials + LWT
    if (client.connect(clientId.c_str(), mqtt_user, mqtt_pass, willTopic, willQoS, willRetain, willMsg)) {
      
      Serial.println("Success (LWT Registered)");
      
      // 4. Immediately override "offline" with "online"
      client.publish(statusTopic.c_str(), "online", true);
      
      client.subscribe(commandTopic.c_str());
      client.subscribe(wifiTopic.c_str()); 
      client.publish(syncTopic.c_str(), "1"); 
      
    } else {
      Serial.print("Fail rc=");
      Serial.println(client.state());
    }
  }
}

void loop() {
  // --- RESET BUTTON LOGIC ---
  if (digitalRead(TOUCH_RESET_PIN) == LOW) {
      if (touchStartTime == 0) {
        touchStartTime = millis();
        Serial.println("[Reset] Button Pressed...");
      }
      
      unsigned long heldTime = millis() - touchStartTime;
      
      // Visual Feedback while holding
      if (heldTime % 100 < 50) digitalWrite(STATUS_LED, HIGH);
      else digitalWrite(STATUS_LED, LOW);

      if (heldTime > 4000) { 
          Serial.println("[Reset] Action Triggered!");
          digitalWrite(STATUS_LED, HIGH); 
          WiFiManager wm;
          wm.resetSettings(); 
          delay(500);
          ESP.restart(); 
      }
  } else {
      // FIX: Only run this logic ONCE when button is released
      if (touchStartTime != 0) {
          touchStartTime = 0;
          Serial.println("[Reset] Button Released (Action Cancelled)");
          digitalWrite(STATUS_LED, LOW); 
      }
  }

  // Normal Loop Operations (only if reset not active)
  if (touchStartTime == 0) {
      checkWiFiConnection(); 
      handleLedStatus(); 
      
      // [NEW] SMART SENSOR LOGIC
      // 1. Read sensor every 2 seconds (DHT11 is slow, don't read faster than this)
      if (millis() - lastDhtCheck > 2000) {
        lastDhtCheck = millis();

        float currentTemp = dht.readTemperature();
        float currentHum = dht.readHumidity();

        // 2. Check if read was successful
        if (!isnan(currentTemp) && !isnan(currentHum)) {
            
            // 3. COMPARE: Has data changed by 0.5C or 5%?
            float tempDiff = abs(currentTemp - lastTemp);
            float humDiff = abs(currentHum - lastHum);

            if (tempDiff >= TEMP_THRESHOLD || humDiff >= HUM_THRESHOLD) {
                
                // 4. Update "Last" values
                lastTemp = currentTemp;
                lastHum = currentHum;

                // 5. Publish to Server
                if (WiFi.status() == WL_CONNECTED && client.connected()) {
                    StaticJsonDocument<128> doc;
                    doc["temp"] = currentTemp;
                    doc["hum"] = currentHum;
                    char buffer[128];
                    serializeJson(doc, buffer);
                    
                    client.publish(sensorTopic.c_str(), buffer);
                    
                    Serial.printf("[DHT] UPDATE SENT: %.1f°C | %.0f%%\n", currentTemp, currentHum);
                }
            }
        }
    }
    
    if (WiFi.status() == WL_CONNECTED) {
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
            if (millis() - lastHeartbeat > 30000) {
               lastHeartbeat = millis();
               client.publish(statusTopic.c_str(), "online", true);
            }
            client.loop();
        }
        handleMQTT(); 
    }
  }
}