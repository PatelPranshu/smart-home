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
const char* syncTopic = "devices/esp32_001/sync"; // New Topic

// --- PINS (For 8-Channel Relay) ---
const int NUM_RELAYS = 8;

// OUTPUTS: Connect IN1...IN8 to these pins
//                        Relay:  1,  2,  3,  4,  5,  6,  7,  8
const int relayPins[NUM_RELAYS] = {22, 23, 14, 27, 26, 25, 33, 32};

// INPUTS: Connect Wall Switches to these pins (other side to GND)
//                       Switch:  1,  2,  3,  4,  5,  6,  7,  8
const int switchPins[NUM_RELAYS] = {15,  4, 16, 17,  5, 18, 19, 21};

// --- GLOBALS ---
WiFiClientSecure espClient;
PubSubClient client(espClient);

// State tracking arrays
bool relayState[NUM_RELAYS] = {false};
int lastSwitchState[NUM_RELAYS] = {HIGH}; 
unsigned long lastDebounceTime[NUM_RELAYS] = {0};
unsigned long debounceDelay = 50;

void setup() {
  Serial.begin(115200);
  
  // Initialize Pins
  for(int i=0; i<NUM_RELAYS; i++) {
    // Relay Setup
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], HIGH); // Start OFF
    
    // Switch Setup
    pinMode(switchPins[i], INPUT_PULLUP);
    lastSwitchState[i] = digitalRead(switchPins[i]);
  }

  // WiFi Connection
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected");

  // MQTT Secure Connection (Bypassing Certificate Check)
  espClient.setInsecure(); // <--- CRITICAL FIX
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void callback(char* topic, byte* payload, unsigned int length) {
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
      digitalWrite(relayPins[id], state ? LOW : HIGH); // <--- SWAPPED HERE
      Serial.printf("Relay %d set to %s\n", id, state ? "ON" : "OFF");
        }
  }
}

void reconnect() {
  if (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    
    if (client.connect(deviceId, mqtt_user, mqtt_pass)) {
      Serial.println("connected");
      
      // 1. Listen for commands
      client.subscribe(commandTopic);
      
      // 2. ASK SERVER FOR RESTORE (The Fix)
      // Send a small "1" to tell the server we need our data back
      client.publish(syncTopic, "1"); 
      
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

for(int i=0; i<NUM_RELAYS; i++) {
     int reading = digitalRead(switchPins[i]);
     
     if (reading != lastSwitchState[i]) {
        lastDebounceTime[i] = millis();
     }

     if ((millis() - lastDebounceTime[i]) > debounceDelay) {
        static int stableState[NUM_RELAYS] = {HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH};
        
        if (reading != stableState[i]) {
           stableState[i] = reading;
           
           // Toggle State
           relayState[i] = !relayState[i];
           
           // FIX: If true (ON), write LOW. If false (OFF), write HIGH.
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