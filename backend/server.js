require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const morgan = require('morgan');
const http = require('http'); 
const { Server } = require('socket.io'); 
const connectDB = require('./config/db');
const mqttClient = require('./config/mqtt');
const startScheduler = require('./utils/scheduler');
const { globalLimiter } = require('./middleware/limiter');

// Initialize Express App
const app = express();
const server = http.createServer(app);

// Initialize Socket.io with CORS matching your Express setup
const io = new Server(server, { //
    cors: {
        origin: [process.env.FRONTEND_URL, "https://oauth-redirect.googleusercontent.com"].filter(Boolean),
        methods: ["GET", "POST"]
    }
});

// Make io accessible in your controllers via req.app.get('socketio')
app.set('socketio', io); //
mqttClient.attachIO(io); // Link Socket.io to MQTT for real-time updates

// 1. DATABASE CONNECTION
connectDB();

// 2. GLOBAL MIDDLEWARE

// --- [CRITICAL] EXPRESS 5.0 PATCH ---
// This must be at the top to prevent "read-only query" crashes
app.use((req, res, next) => {
  Object.defineProperty(req, 'query', {
    value: req.query,
    writable: true,
    configurable: true
  });
  next();
});

// Logging
app.use(morgan('common'));

// Trust proxy for secure cookies/rate limiting
app.set('trust proxy', 1);

// Security Headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", process.env.ORIGIN_URL],
      formAction: ["'self'", process.env.ORIGIN_URL, "https://oauth-redirect.googleusercontent.com"],
    },  
  },
}));

// CORS Configuration
app.use(cors({
  origin: [process.env.FRONTEND_URL, "https://oauth-redirect.googleusercontent.com"].filter(Boolean),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-access-token', 'x-admin-secret', 'Authorization'],
  credentials: true
}));

// Request Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security: Prevent NoSQL Injection (Now safe because req.query is writable)
app.use(mongoSanitize());

// Global Rate Limiting
app.use(globalLimiter);

// Socket.io Connection Logic
io.on('connection', (socket) => { //
    console.log('📱 A user connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('📱 User disconnected');
    });
});


// 3. ROUTES MOUNTING
app.use('/api', require('./routes/deviceRoutes')); 
app.use('/api', require('./routes/historyRoutes'));
app.use('/api', require('./routes/authRoutes'));
app.use('/api', require('./routes/adminRoutes'));
app.use('/api', require('./routes/taskRoutes'));

// OAuth and Google Home
app.use('/', require('./routes/googleRoutes'));

// Test route
app.get('/api/test', (req, res) => res.send("API is working"));
// 4. BACKGROUND SERVICES
startScheduler(mqttClient);

// 5. SERVER START
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => { 
    console.log(`🚀 Smart Home Backend running at http://localhost:${PORT}`);
});