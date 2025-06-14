require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');

// สำหรับ Google Sheets API: ต้อง require ที่นี่และ initialize
const { google } = require('googleapis');
const path = require('path');

let auth, sheets;
// ส่วนนี้จะ initialize Google Sheets API client เมื่อ Server เริ่มต้น
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
        const keyFilePath = path.join(__dirname, process.env.GOOGLE_APPLICATION_CREDENTIALS); // ปรับ path ถ้าไฟล์อยู่ root
        auth = new google.auth.GoogleAuth({
            keyFile: keyFilePath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        sheets = google.sheets({ version: 'v4', auth });
        console.log('Google Sheets API client initialized.');
    } catch (error) {
        console.error('Error initializing Google Sheets API client:', error.message);
    }
} else {
    console.warn('GOOGLE_APPLICATION_CREDENTIALS not set in .env. Google Sheets upload will not work.');
}

// ต้อง require returnRoutes หลังจาก sheets ถูก initialize แล้ว และส่ง sheets object ไปให้
const returnRoutes = require('./routes/returnRoutes')(sheets); // <--- จุดสำคัญ: ส่ง sheets object ไปให้ returnRoutes

const app = express();
const PORT = process.env.PORT || 3000;

console.log('--- app.js STARTING ---');
console.log('PORT from .env:', PORT);

// Middleware
app.use(express.json()); // สำหรับ Parse JSON body

// API Routes (ต้องอยู่ก่อน express.static)
app.use('/api/returns', returnRoutes); // <--- จุดสำคัญ: ใช้ returnRoutes ที่รับ sheets แล้ว

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
