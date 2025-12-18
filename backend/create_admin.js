require('dotenv').config(); // Load your .env secrets
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User'); // Imports your User model

const createAdmin = async () => {
  try {
    // 1. Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to Database...");

    // 2. User Details (CHANGE THESE IF YOU WANT)
    const email = "admin@smart.home"; 
    const plainPassword = "admin";    

    // 3. Securely Hash the Password
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    // 4. Create the User
    // The "upsert" option updates the user if they exist, or creates them if not
    await User.findOneAndUpdate(
      { email: email },
      { email: email, password: hashedPassword },
      { upsert: true, new: true }
    );

    console.log(`\n🎉 SUCCESS! User Created:`);
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Password: ${plainPassword}`);
    console.log(`\nYou can now log in on the website.\n`);

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    mongoose.connection.close(); // Close connection when done
  }
};

createAdmin();