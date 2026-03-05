#include <Preferences.h>

Preferences preferences;

void setup() {
  Serial.begin(115200);
  
  // Open "creds" namespace in Read/Write mode (false)
  preferences.begin("creds", false);
  
  // WRITE credentials to memory
  // Change these to the unique values for this specific board!
  preferences.putString("user", "device_fleet_01");
  preferences.putString("pass", "UK!tuzL4P.6N4ku");
  
  Serial.println("Credentials Saved to NVS!");
  preferences.end();
}

void loop() {
  // Do nothing
}