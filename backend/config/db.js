const mongoose = require('mongoose');

const connectDB = async () => {
    // Database Connection Options
    const dbOptions = {
        autoIndex: true, // Maintain indexes
        maxPoolSize: 10, // Maintain up to 10 socket connections
        serverSelectionTimeoutMS: 5000, // Keep trying to connect for 5 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
        family: 4 // Use IPv4, skip trying IPv6
    };

    try {
        await mongoose.connect(process.env.MONGO_URI, dbOptions);
        console.log('✅ MongoDB Connected (Optimized)');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err);
        process.exit(1); // Stop server if DB fails
    }
};

// Handle sudden disconnections
mongoose.connection.on('error', err => {
    console.error('Mongoose secondary error:', err);
});

module.exports = connectDB;