require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const returnRoutes = require('./routes/returnRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('--- app.js STARTING (v2) ---'); // LOG 1: เพิ่ม v2
console.log('PORT from .env:', PORT); // LOG 2
console.log('Node.js version:', process.version); // LOG 3: ตรวจสอบเวอร์ชัน Node

// Middleware
console.log('Setting up middleware...'); // LOG 4
app.use(express.json());
app.use(express.static('public')); // LOG 5

// API Routes
console.log('Setting up API routes...'); // LOG 6
app.use('/api/returns', returnRoutes); // LOG 7


// เชื่อมต่อ MongoDB
console.log('Attempting to connect to MongoDB...'); // LOG 8
console.log('MONGO_URI from .env:', process.env.MONGO_URI); // LOG 9: ตรวจสอบค่า MONGO_URI อีกครั้ง
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('MongoDB connected successfully'); // LOG 10
    })
    .catch(err => {
        console.error('*** MongoDB connection FAILED! (v2) ***'); // LOG 11: Error message
        console.error('Error details:', err); // LOG 12: Log full error details
        process.exit(1); // บังคับให้โปรแกรมหยุด เพื่อให้เห็น Error ใน Terminal
    });

// เริ่มต้น Server
console.log('Attempting to start server...'); // LOG 13
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`); // LOG 14
});

console.log('--- app.js END of main script (v2) ---'); // LOG 15