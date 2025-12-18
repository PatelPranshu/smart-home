// backend/create_device.js
require('dotenv').config();
const mongoose = require('mongoose');
const Device = require('./models/Device');
const User = require('./models/User');

const createDevice = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to DB...");

    // 1. Find your Admin User
    const userEmail = "admin@smart.home"; 
    const user = await User.findOne({ email: userEmail });
    
    if (!user) {
        console.log("❌ User not found! Run create_admin.js first.");
        return;
    }

    // 2. Define the Device
    // This ID "esp32_001" MUST match the 'deviceId' in your ESP32 Arduino code
    const newDevice = {
        deviceId: "esp32_001", 
        secret: "device_secret_key_123", // Used for future security
        owner: user._id, // Assign this device to your user
        switches: [
            { id: 0, name: "Living Room Light", state: false },
            { id: 1, name: "Living Room Fan", state: false },
            { id: 2, name: "Kitchen Light", state: false },
            { id: 3, name: "Kitchen Socket", state: false },
            { id: 4, name: "Bedroom Light", state: false },
            { id: 5, name: "Bedroom AC", state: false },
            { id: 6, name: "Porch Light", state: false },
            { id: 7, name: "Bathroom Light", state: false }
        ]
    };

    // 3. Save to Database (Upsert: Create if new, Update if exists)
    await Device.findOneAndUpdate(
        { deviceId: newDevice.deviceId },
        newDevice,
        { upsert: true, new: true }
    );

    console.log(`\n🎉 SUCCESS! Device Added.`);
    console.log(`📱 Device ID: ${newDevice.deviceId}`);
    console.log(`👤 Owner: ${userEmail}`);
    console.log(`💡 Switch: ${newDevice.switches[0].name}`);

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    mongoose.connection.close();
  }
};

createDevice();