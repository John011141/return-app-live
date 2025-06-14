require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');

// require returnRoutes แบบปกติ เพราะตอนนี้ returnRoutes จะจัดการ Google Sheets API เอง
const returnRoutes = require('./routes/returnRoutes'); // <--- จุดสำคัญ: ไม่ต้องส่ง sheets object แล้ว

const app = express();
const PORT = process.env.PORT || 3000;

console.log('--- app.js STARTING ---');
console.log('PORT from .env:', PORT);

// Middleware
app.use(express.json()); // สำหรับ Parse JSON body

// API Routes (ต้องอยู่ก่อน express.static)
app.use('/api/returns', returnRoutes); // <--- จุดสำคัญ: ใช้ returnRoutes ที่ Export มาตรงๆ

// Static Files (อยู่ด้านล่าง API routes)
console.log('Setting up static files...');
app.use(express.static('public'));


// เชื่อมต่อ MongoDB
console.log('Attempting to connect to MongoDB...');
console.log('MONGO_URI from .env:', process.env.MONGO_URI);
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('MongoDB connected successfully');
    })
    .catch(err => {
        console.error('*** MongoDB connection FAILED! ***');
        console.error('Error details:', err);
        // process.exit(1);
    });

// เริ่มต้น Server
console.log('Attempting to start server...');
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

console.log('--- app.js END of main script ---');
