#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h> // Install "ArduinoJson" by Benoit Blanchon via Library Manager

// --- CONFIGURATION ---
const char* ssid = "Ambarish01";
const char* password = "123450789";

// MQTT Broker (HiveMQ Cloud)
const char* mqtt_server = "6c37b4fdae72447883f91b6cc992648e.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_user = "backend_admin";
const char* mqtt_pass = "Admin@3500";

const char* deviceId = "esp32_001"; 
const char* commandTopic = "devices/esp32_001/command";
const char* updateTopic = "devices/esp32_001/update";
const char* syncTopic = "devices/esp32_001/sync";
const char* statusTopic = "devices/esp32_001/status";

// --- PINS (For 8-Channel Relay) ---
const int NUM_RELAYS = 8;

// OUTPUTS: Connect IN1...IN8 to these pins
//                        Relay:  1,  2,  3,  4,  5,  6,  7,  8
const int relayPins[NUM_RELAYS] = {22, 23, 14, 27, 26, 25, 33, 32};

// INPUTS: Connect Wall Switches to these pins (other side to GND)
//                       Switch:  1,  2,  3,  4,  5,  6,  7,  8
const int switchPins[NUM_RELAYS] = {15,  4, 16, 17,  5, 18, 19, 21};

// STATUS LED (Built-in Blue LED is usually GPIO 2)
const int STATUS_LED = 2;

// --- GLOBALS ---
WiFiClientSecure espClient;
PubSubClient client(espClient);

// State tracking arrays
bool relayState[NUM_RELAYS] = {false};
int lastSwitchState[NUM_RELAYS] = {HIGH}; 
unsigned long lastDebounceTime[NUM_RELAYS] = {0};
unsigned long debounceDelay = 50;

// --- HELPER: Blink Blue LED ---
void blinkFeedback() {
  digitalWrite(STATUS_LED, HIGH); // Blue LED ON
  delay(100);                     // Wait 0.1 second
  digitalWrite(STATUS_LED, LOW);  // Blue LED OFF
}

void setup() {
  Serial.begin(115200);
  
  // Setup Status LED
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW); // Start OFF

  // Initialize Pins
  for(int i=0; i<NUM_RELAYS; i++) {
    // Relay Setup
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], HIGH); // Start OFF (Active Low logic)
    
    // Switch Setup
    pinMode(switchPins[i], INPUT_PULLUP);
    lastSwitchState[i] = digitalRead(switchPins[i]);
  }

  // WiFi Connection
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    // Fast blink while connecting
    digitalWrite(STATUS_LED, HIGH);
    delay(100);
    digitalWrite(STATUS_LED, LOW);
    delay(100);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected");

  // MQTT Secure Connection (Bypassing Certificate Check)
  espClient.setInsecure(); 
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void callback(char* topic, byte* payload, unsigned int length) {
  blinkFeedback(); // <--- BLINK WHEN APP COMMAND RECEIVED

  // 1. Receive Message
  String message;
  for (int i = 0; i < length; i++) message += (char)payload[i];
  Serial.print("Command Received: "); Serial.println(message);

  // 2. Parse JSON
  StaticJsonDocument<200> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (!error) {
    int id = doc["switchId"];
    bool state = doc["state"];

    // 3. Control Relay
    if (id >= 0 && id < NUM_RELAYS) {
      relayState[id] = state;
      // If state is true (ON), send LOW. If false (OFF), send HIGH.
      digitalWrite(relayPins[id], state ? LOW : HIGH); 
      Serial.printf("Relay %d set to %s\n", id, state ? "ON" : "OFF");
    }
  }
}

void reconnect() {
  if (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    
    // Connect with Last Will & Testament (LWT)
    if (client.connect(deviceId, mqtt_user, mqtt_pass, statusTopic, 0, true, "offline")) {
      
      Serial.println("connected");
      
      // 1. Immediately say "I am Online"
      client.publish(statusTopic, "online", true);

      // 2. Resubscribe
      client.subscribe(commandTopic);
      
      // 3. Sync State (Ask server for latest state)
      client.publish(syncTopic, "1"); 
      
      // Long blink to show connection success
      digitalWrite(STATUS_LED, HIGH);
      delay(500);
      digitalWrite(STATUS_LED, LOW);
      
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      delay(2000); 
    }
  }
}

void loop() {
  // 1. Maintain Connection
  if (WiFi.status() == WL_CONNECTED) {
     if (!client.connected()) reconnect();
     client.loop();
  }

  // 2. MANUAL SWITCH CHECK
  for(int i=0; i<NUM_RELAYS; i++) {
     int reading = digitalRead(switchPins[i]);
     
     if (reading != lastSwitchState[i]) {
        lastDebounceTime[i] = millis();
     }

     if ((millis() - lastDebounceTime[i]) > debounceDelay) {
        static int stableState[NUM_RELAYS] = {HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH};
        
        if (reading != stableState[i]) {
           stableState[i] = reading;
           
           blinkFeedback(); // <--- BLINK WHEN MANUAL SWITCH FLIPPED

           // Toggle State
           relayState[i] = !relayState[i];
           
           // Write Output (Active Low: ON=LOW, OFF=HIGH)
           digitalWrite(relayPins[i], relayState[i] ? LOW : HIGH);
           
           // Update Server
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
}