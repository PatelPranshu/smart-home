#include <ArduinoJson.h>
#include <DHT.h>
#include <HTTPClient.h>  // For downloading updates
#include <HTTPUpdate.h>  // For OTA
#include <Preferences.h>
#include <PubSubClient.h>
#include <Update.h>  // For installing updates
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <esp_task_wdt.h>  // For Hardware Watchdog
#include <time.h>

#define DHTPIN 13     // Pin where DHT11 is connected
#define DHTTYPE DHT11 // Sensor type
DHT dht(DHTPIN, DHTTYPE);

// --- FIRMWARE VERSIONING (OTA) ---
#define FIRMWARE_VERSION "1.0.0"

// --- PRODUCTION CONFIGURATION ---
// [FIX 1] Increased from 10s to 35s to allow SSL/TLS handshake to complete
// without starving the loop task and triggering a WDT reset.
#define WDT_TIMEOUT 35

// 1. SSL CERTIFICATE (HiveMQ Cloud)
const char *root_ca =
    "-----BEGIN CERTIFICATE-----\n"
    "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\n"
    "-----END CERTIFICATE-----";

// MQTT Broker
const char *mqtt_server = "b05e6bbab5eb466db17fd7a4403f054e.s1.eu.hivemq.cloud";
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
String otaTopic;      // OTA Topic
String fanSpeedTopic; // Fan Speed Topic
String versionTopic;  // Firmware Version Topic
String checkTopic;    // Check Status Topic

unsigned long lastWifiCheck = 0;
unsigned long wifiDisconnectedSince = 0; // [NEW] Track persistent WiFi disconnection for hard reconnect
bool clockSynced = false;                // [NEW] Track NTP time sync for SSL certificate validation

// CONFIGURATION: Thresholds
const float TEMP_THRESHOLD = 1.0;
const float HUM_THRESHOLD = 10.0;

unsigned long lastDhtCheck = 0;
float lastTemp = 0;
float lastHum = 0;

// --- PINS ---
const int NUM_RELAYS = 8;

const int relayPins[NUM_RELAYS] = {22, 23, 14, 27, 26, 25, 33, 32};

const int switchPins[NUM_RELAYS] = {15, 16, 17, 5, 18, 19, 21, 4};

// Flags for saving state safely
volatile bool saveNeeded[NUM_RELAYS] = {false};

const int STATUS_LED = 2;
const int TOUCH_RESET_PIN = 0; // Boot Button

// --- OBJECTS ---
WiFiClientSecure espClient;
PubSubClient client(espClient);
Preferences preferences;

// =============================================================================
// THREAD SAFETY MODEL (FreeRTOS Dual-Core)
// =============================================================================
// Core 0: switchTaskCode — owns physical switch reading & relay GPIO toggling
//   Writes: relayState[i], saveNeeded[i], mqttNeedsUpdate[i], triggerSwitchFeedback
//
// Core 1: loop() + MQTT callbacks — owns WiFi, MQTT, LED, NVS saves
//   Writes: relayState[i] (from MQTT commands), triggerSwitchFeedback, triggerFullSync
//   Reads & resets: saveNeeded[i], mqttNeedsUpdate[i]
//
// Safety rationale:
// - bool on ESP32 Xtensa LX6 is 1-byte aligned = atomic read/write at hardware level.
// - Each relay index is written by only one source at a time (physical switch XOR MQTT
//   command). A user cannot flip a wall switch and send an app command for the exact
//   same relay at the exact same microsecond — serialized by human intent.
// - The volatile qualifier ensures cross-core visibility by preventing the compiler
//   from caching values in registers, forcing reads/writes through to memory.
// - Flag arrays (saveNeeded, mqttNeedsUpdate) follow a strict producer/consumer
//   pattern: Core 0 sets true, Core 1 reads & resets. No mutex needed.
// =============================================================================
volatile bool relayState[NUM_RELAYS] = {false};
volatile bool triggerSwitchFeedback = false;

// Written by Core 1 during setup() init, then exclusively by Core 0 in switchTaskCode.
// Safe because setup() completes and startupDelayComplete is set before Core 0 processes switches.
int lastSwitchState[NUM_RELAYS] = {HIGH};
unsigned long lastDebounceTime[NUM_RELAYS] = {0}; // Core 0 only
unsigned long debounceDelay = 50;

// TIMERS & BACKOFF
unsigned long lastMqttAttempt = 0;
unsigned long currentBackoff = 5000; // Start backoff at 5s
int mqttRetryCount = 0;
unsigned long touchStartTime = 0;

// LED STATE MANAGEMENT
enum SystemState {
  STATE_IDLE,    // Everything OK (LED OFF)
  STATE_NO_WIFI, // Fast Blink (200ms)
  STATE_NO_MQTT, // Slow Blink (1000ms)
  STATE_SETUP,   // Solid ON
  STATE_FEEDBACK // Quick Pulse
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
volatile bool mqttNeedsUpdate[NUM_RELAYS] = {false};  // Core 0 sets true, Core 1 reads & resets
volatile bool triggerFullSync = false;                  // Core 1 only (callback sets, loop resets)
volatile bool startupDelayComplete = false;             // Core 1 writes once in setup(), Core 0 reads

// --- HELPER: SAVE & LOAD STATE ---
void saveState(int id, bool state) {
  char key[10];
  sprintf(key, "sw_%d", id);
  preferences.putBool(key, state);
}

void loadState() {
  for (int i = 0; i < NUM_RELAYS; i++) {
    char key[10];
    sprintf(key, "sw_%d", i);
    // Load the saved state from memory, but DO NOT turn on relays yet
    relayState[i] = preferences.getBool(key, false);
  }
}

// --- CORE 0: SWITCH TASK & EMERGENCY RESET ---
void switchTaskCode(void *PvParameters) {
  int stableState[NUM_RELAYS];
  unsigned long buttonPressStart = 0; // Timer for the Boot Button

  // 1. Read actual hardware state on startup
  for (int i = 0; i < NUM_RELAYS; i++) {
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
    if (startupDelayComplete) {
      for (int i = 0; i < NUM_RELAYS; i++) {
        int reading = digitalRead(switchPins[i]);
  
        if (reading != lastSwitchState[i])
          lastDebounceTime[i] = millis();
  
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

  if (!currentWifi)
    currentSystemState = STATE_NO_WIFI;
  else if (!currentMqtt)
    currentSystemState = STATE_NO_MQTT;
  else
    currentSystemState = STATE_IDLE;

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

// --- OTA UPDATE FUNCTION ---
void performOTA(String url) {
  Serial.println("[OTA] Starting Update from: " + url);

  // 1. Unsubscribe the loop from WDT so it doesn't reboot during download
  esp_task_wdt_delete(NULL);

  // Stop operations
  client.disconnect();

  WiFiClientSecure otaClient;
  otaClient.setInsecure(); // Skip cert validation since file server cert varies

  t_httpUpdate_return ret = httpUpdate.update(otaClient, url);

  // 2. If it fails and doesn't restart, add WDT back
  esp_task_wdt_add(NULL);

  switch (ret) {
  case HTTP_UPDATE_FAILED:
    Serial.printf("[OTA] Error (%d): %s\n", httpUpdate.getLastError(),
                  httpUpdate.getLastErrorString().c_str());
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
void callback(char *topic, byte *payload, unsigned int length) {
  triggerSwitchFeedback = true;

  // [FIX] Use pre-allocated char buffer instead of String concatenation
  // to prevent heap fragmentation from repeated += in a loop.
  char message[length + 1];
  memcpy(message, payload, length);
  message[length] = '\0';

  Serial.print("[MQTT] Recv: ");
  Serial.println(topic);

  // [FIX] Single String construction for topic comparison instead of
  // repeated String(topic) allocations on each comparison branch.
  String topicStr(topic);

  // 1. OTA Command
  if (topicStr == otaTopic) {
    StaticJsonDocument<256> doc; // [FIX] Increased from 200 to 256 for URL payloads
    DeserializationError err = deserializeJson(doc, message);
    if (err) {
      Serial.print("[MQTT] OTA: JSON error: ");
      Serial.println(err.c_str());
      return;
    }
    const char *downloadUrl = doc["url"];
    if (downloadUrl) {
      performOTA(String(downloadUrl));
    }
    return;
  }

  // 1.5. Check Status Command
  if (topicStr == checkTopic) {
    Serial.println("[MQTT] Status Check Requested");
    triggerFullSync = true;
    return;
  }

  // 2. Fan Speed Command
  if (topicStr == fanSpeedTopic) {
    StaticJsonDocument<256> doc; // [FIX] Increased from 200 to 256
    DeserializationError err = deserializeJson(doc, message);
    if (err) {
      Serial.print("[MQTT] Fan: JSON error: ");
      Serial.println(err.c_str());
      return;
    }
    int id = doc["switchId"];
    int speed = doc["speed"];
    Serial.printf("[MQTT] Fan Speed: Switch %d -> Speed %d\n", id, speed);
    // TODO: Implement hardware fan speed logic (PWM/multi-relay) here
    // For now, treat any speed > 0 as ON, speed 0 as OFF
    if (id >= 0 && id < NUM_RELAYS) {
      bool newState = (speed > 0);
      relayState[id] = newState;
      digitalWrite(relayPins[id], newState ? LOW : HIGH);
      saveState(id, newState);
    }
    return;
  }

  // 3. WiFi Update
  if (topicStr == wifiTopic) {
    StaticJsonDocument<256> doc; // [FIX] Increased from 200 to 256
    DeserializationError err = deserializeJson(doc, message);
    if (err) {
      Serial.print("[MQTT] WiFi: JSON error: ");
      Serial.println(err.c_str());
      return;
    }
    const char *newSSID = doc["ssid"];
    const char *newPass = doc["pass"];
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

  // 4. Switch Control
  StaticJsonDocument<256> doc; // [FIX] Reduced from 512 — 256 is sufficient for {switchId, state}
  DeserializationError error = deserializeJson(doc, message);
  if (error) {
    // [FIX] Added missing error handling — malformed MQTT payload no longer crashes the ESP32
    Serial.print("[MQTT] Switch: JSON error: ");
    Serial.println(error.c_str());
    return;
  }
  int id = doc["switchId"];
  bool state = doc["state"];
  if (id >= 0 && id < NUM_RELAYS) {
    relayState[id] = state;
    digitalWrite(relayPins[id], state ? LOW : HIGH);
    saveState(id, state);
    Serial.printf("[MQTT] Sw %d -> %s\n", id, state ? "ON" : "OFF");
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
    esp_task_wdt_reset(); // [FIX] Pet watchdog during NTP sync to prevent WDT reset
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
      // [NEW] Track how long WiFi has been persistently disconnected
      if (wifiDisconnectedSince == 0) {
        wifiDisconnectedSince = millis();
        // Edge case: millis() == 0 at boot is astronomically unlikely,
        // but use 1 to avoid re-entering this branch.
        if (wifiDisconnectedSince == 0) wifiDisconnectedSince = 1;
      }

      unsigned long disconnectedFor = millis() - wifiDisconnectedSince;

      // [NEW] Hard reconnect cycle after 5 minutes of persistent disconnection.
      // WiFi.reconnect() alone sometimes fails to recover from certain edge cases
      // (e.g., router changed channel, DHCP lease expired). A full disconnect/begin
      // cycle forces a clean re-association.
      // NOTE: Does NOT call ESP.restart() — switches on Core 0 remain unaffected.
      if (disconnectedFor > 300000) {
        Serial.println("[WiFi] Disconnected >5min. Hard reconnect cycle...");
        WiFi.disconnect();
        delay(100); // Brief settle time for WiFi radio
        WiFi.begin(); // Reconnect with stored credentials from flash
        wifiDisconnectedSince = millis(); // Reset timer for next cycle
        if (wifiDisconnectedSince == 0) wifiDisconnectedSince = 1;
      } else {
        Serial.println("[WiFi] Lost. Retrying...");
        WiFi.reconnect();
      }
    } else {
      // WiFi is connected — reset the disconnection tracker
      wifiDisconnectedSince = 0;
    }
  }
}

void blinkFast() { digitalWrite(STATUS_LED, !digitalRead(STATUS_LED)); }

void configModeCallback(WiFiManager *myWiFiManager) {
  Serial.println("[Setup] Config Mode Started");
  digitalWrite(STATUS_LED, HIGH);
}

// --- SETUP ---
void setup() {
  Serial.begin(115200);
  Serial.println("\n[Boot] System Starting...");

  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);

  // --- LOAD SECRETS FROM MEMORY ---
  // Security Step: Read MQTT User/Pass from NVS
  preferences.begin("creds", true); // Open "creds" in Read-Only mode
  mqtt_user = preferences.getString("user", "");
  mqtt_pass = preferences.getString("pass", "");
  preferences.end();

  // Security Check: If memory is empty, STOP.
  // NOTE: This infinite loop runs BEFORE the WDT is initialized (WDT is started
  // at the very end of setup), so there is no risk of a silent WDT reset here.
  // The device is in a fatal state requiring provisioning — blocking is intentional.
  if (mqtt_user == "" || mqtt_pass == "") {
    Serial.println("[FATAL ERROR] No Credentials Found in NVS!");
    Serial.println("Please run the Provisioning Sketch first.");
    while (1) {
      // Blink SOS Pattern to alert factory worker
      digitalWrite(STATUS_LED, HIGH);
      delay(100);
      digitalWrite(STATUS_LED, LOW);
      delay(100);
    }
  }
  Serial.println("[Boot] Credentials Loaded Successfully");
  // --------------------------------------

  preferences.begin("relays", false);
  pinMode(TOUCH_RESET_PIN, INPUT_PULLUP);

  // --- FACTORY RESET LOGIC ---
  // NOTE: Runs before WDT initialization, delay() calls here are safe.
  if (digitalRead(TOUCH_RESET_PIN) == LOW) {
    Serial.println("[Boot] Reset Button Detected...");
    for (int i = 0; i < 20; i++) {
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
  for (int i = 0; i < NUM_RELAYS; i++) {
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

  xTaskCreatePinnedToCore(switchTaskCode, "SwitchTask", 10000, NULL, 1,
                          &SwitchTask, 0);

  Serial.println("[Boot] Load balancing: Waiting 3 seconds before restoring lights...");
  delay(3000);
  
  // Restore states with stagger to prevent current surge
  for(int i=0; i<NUM_RELAYS; i++) {
    if (relayState[i]) {
      digitalWrite(relayPins[i], LOW);
      delay(250); // Stagger turn-on by 250ms per active relay
    } else {
      digitalWrite(relayPins[i], HIGH);
    }
  }
  startupDelayComplete = true;
  Serial.println("[Boot] Lights restored. Switches active.");

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
  fanSpeedTopic = "devices/" + uniqueDeviceId + "/fan-speed";
  versionTopic = "devices/" + uniqueDeviceId + "/version";
  checkTopic = "devices/" + uniqueDeviceId + "/check";

  dht.begin();

  // --- WIFI MANAGER ---
  WiFiManager wm;
  String apName = "SmartHome_Setup_" + mac.substring(8);
  wm.setAPCallback(configModeCallback);
  // [FIX 2] Prevent WiFiManager from blocking indefinitely after power restore.
  // When power is restored, the ESP32 boots faster than the router. The old
  // setConnectTimeout(180) caused a 3-minute block. These finite timeouts
  // ensure the device falls through to offline mode where switches still work.
  wm.setConnectTimeout(20);        // Wait 20 seconds for the router
  wm.setConfigPortalTimeout(60);   // Close the setup portal after 60 seconds

  // CRITICAL: Watchdog starts AFTER this block
  if (!wm.autoConnect(apName.c_str())) {
    Serial.println("[WiFi] Failed. Offline Mode.");
    // [FIX 2] Turn off the solid blue setup LED so the main loop can
    // resume normal "Offline Mode" blinking pattern (fast blink = no WiFi).
    digitalWrite(STATUS_LED, LOW);
  } else {
    Serial.println("[WiFi] Connected!");
    setClock();
    clockSynced = true;
  }

  // [FIX] MQTT client configuration is now UNCONDITIONAL.
  // Previously, these were inside the WiFi success block, meaning if WiFi failed
  // during setup but connected later via checkWiFiConnection(), the MQTT client
  // had no server, callback, or buffer configured — handleMQTT() would silently fail.
  espClient.setCACert(root_ca);
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setBufferSize(4096);
  client.setKeepAlive(10);
  client.setSocketTimeout(10); // [NEW] Prevent PubSubClient::loop() from blocking on hung TCP connection

  // START WATCHDOG HERE (Final Step)
  // Correct way to reconfigure and add the current loop to WDT
  esp_task_wdt_config_t config;
  config.timeout_ms = WDT_TIMEOUT * 1000;
  config.trigger_panic = true;
  config.idle_core_mask = (1 << portNUM_PROCESSORS) - 1;

  // Initialize or Reconfigure
  esp_err_t err = esp_task_wdt_reconfigure(&config);
  if (err != ESP_OK) {
    esp_task_wdt_init(&config); // Init if not already done
  }
  esp_task_wdt_add(NULL); // Add the main loop task to the watchdog

  Serial.printf("[Boot] Watchdog started (%ds timeout)\n", WDT_TIMEOUT);
  Serial.printf("[Boot] Free Heap: %u bytes\n", ESP.getFreeHeap());
}

// --- MQTT HANDLING WITH BACKOFF ---
void handleMQTT() {
  if (WiFi.status() != WL_CONNECTED)
    return;

  if (client.connected()) {
    currentBackoff = 5000; // Reset backoff on success
    mqttRetryCount = 0;
    return;
  }

  // [NEW] If NTP time was never synced (WiFi failed during setup), sync now.
  // SSL certificate validation requires correct system time.
  if (!clockSynced) {
    Serial.println("[MQTT] Clock not synced. Running NTP sync first...");
    setClock();
    clockSynced = true;
  }

  unsigned long now = millis();
  if (now - lastMqttAttempt > currentBackoff) {
    lastMqttAttempt = now;

    // [FIX] Overflow-safe exponential backoff.
    // Original: currentBackoff * 2 could overflow unsigned long before the cap
    // check if currentBackoff was already large (e.g., due to a code path that
    // skipped the cap). Now we guard the multiplication.
    if (currentBackoff < 60000) {
      currentBackoff = currentBackoff * 2;
    }
    if (currentBackoff > 120000) {
      currentBackoff = 120000; // Max 2 minutes
    }

    // [FIX] Cap retry counter to prevent integer overflow after weeks of uptime.
    if (mqttRetryCount < 10000) {
      mqttRetryCount++;
    }

    Serial.printf("[MQTT] Connecting (Attempt: %d, Backoff: %lums)... ", mqttRetryCount, currentBackoff);

    String clientId = uniqueDeviceId + "-" + String(random(0xffff), HEX);
    const char *willTopic = statusTopic.c_str();

    // [FIX 1] Pet watchdog BEFORE the blocking SSL handshake.
    // The TLS handshake with HiveMQ Cloud can take 10-25 seconds.
    // This resets the WDT counter to give the full 35s window.
    esp_task_wdt_reset();

    // Use .c_str() to convert String to the format MQTT needs
    if (client.connect(clientId.c_str(), mqtt_user.c_str(), mqtt_pass.c_str(),
                       willTopic, 1, true, "offline")) {
      // [FIX 1] Pet watchdog AFTER successful SSL handshake completes.
      esp_task_wdt_reset();
      Serial.println("Success");
      // 1. DELETE OLD GHOST COMMANDS
      // We publish an empty message with Retain=True to the command topic.
      // This wipes any "Turn Off" commands waiting on the server.
      client.publish(commandTopic.c_str(), "", true);

      // 2. Mark ourselves online and subscribe to all control topics
      client.publish(statusTopic.c_str(), "online", true);
      client.subscribe(commandTopic.c_str());
      client.subscribe(wifiTopic.c_str());
      client.subscribe(otaTopic.c_str());
      client.subscribe(fanSpeedTopic.c_str());
      client.subscribe(checkTopic.c_str());

      // 3. ESP32 IS SOURCE OF TRUTH: Push local state to server on reconnect
      // This ensures physical switch changes made while offline are preserved
      // and the server DB is updated to match the real hardware state.
      for (int i = 0; i < NUM_RELAYS; i++) {
        StaticJsonDocument<256> doc;
        doc["switchId"] = i;
        doc["state"] = (bool)relayState[i];
        doc["reconnect"] = true; // Flag: server must accept, not override
        char buffer[256];
        serializeJson(doc, buffer);
        client.publish(updateTopic.c_str(), buffer);
        client.loop(); // Prevent buffer overflow
        delay(10);
      }

      // Clear pending update flags since we just pushed all states
      for (int i = 0; i < NUM_RELAYS; i++) {
        mqttNeedsUpdate[i] = false;
      }

      // 4. Report firmware version to server (retained)
      client.publish(versionTopic.c_str(), FIRMWARE_VERSION, true);
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
      for (int i = 0; i < NUM_RELAYS; i++) {
        if (mqttNeedsUpdate[i]) {
          mqttNeedsUpdate[i] = false;
          StaticJsonDocument<256> doc;
          doc["switchId"] = i;
          doc["state"] = (bool)relayState[i];
          char buffer[256];
          serializeJson(doc, buffer);
          client.publish(updateTopic.c_str(), buffer);
        }
      }
      
      // Process Full Sync Request from Refresh Button
      if (triggerFullSync) {
        triggerFullSync = false;
        client.publish(statusTopic.c_str(), "online", true);
        for (int i = 0; i < NUM_RELAYS; i++) {
          StaticJsonDocument<256> doc;
          doc["switchId"] = i;
          doc["state"] = (bool)relayState[i];
          doc["refresh"] = true;
          char buffer[256];
          serializeJson(doc, buffer);
          client.publish(updateTopic.c_str(), buffer);
          client.loop(); // Prevent buffer overflow
          delay(10);
        }
      }

      // Report firmware version every 5 minutes
      static unsigned long lastVersionReport = 0;
      if (millis() - lastVersionReport > 300000) {
        lastVersionReport = millis();
        client.publish(versionTopic.c_str(), FIRMWARE_VERSION, true);
      }

      client.loop();
    }
    handleMQTT();
  }

  // 5. SAFE SAVING (Runs even if Offline!)
  for (int i = 0; i < NUM_RELAYS; i++) {
    if (saveNeeded[i]) {
      saveNeeded[i] = false;
      saveState(i, relayState[i]);
      Serial.printf("[System] State saved for Switch %d\n", i);
    }
  }

  // 6. [NEW] HEAP MONITORING (Production Diagnostics)
  // Runs every 60 seconds. CPU overhead of ESP.getFreeHeap() + Serial.printf is
  // negligible. Invaluable for detecting slow memory leaks over days of uptime.
  static unsigned long lastHeapCheck = 0;
  if (millis() - lastHeapCheck > 60000) {
    lastHeapCheck = millis();
    Serial.printf("[System] Free Heap: %u bytes | Min Free: %u bytes\n",
                  ESP.getFreeHeap(), ESP.getMinFreeHeap());
  }
}