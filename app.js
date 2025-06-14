require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const { google } = require('googleapis'); // เพิ่มการเรียกใช้ googleapis

const app = express();
const PORT = process.env.PORT || 10000; // Render มักจะใช้ port 10000

console.log('--- app.js STARTING (v2) ---');
console.log('PORT from .env:', PORT);
console.log('Node.js version:', process.version);

// --- Google Sheets API Authentication ---
// ส่วนนี้จะทำการตั้งค่าการเชื่อมต่อกับ Google Sheets API เพียงครั้งเดียว
console.log('Setting up Google Sheets API client...');

const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
if (!credentialsJson) {
    // หากไม่พบค่า credentials ใน Environment Variable ให้หยุดการทำงานทันที
    console.error('*** FATAL ERROR: The GOOGLE_CREDENTIALS_JSON environment variable is not set. ***');
    process.exit(1);
}

let credentials;
try {
    // แปลงค่า JSON string ที่ได้จาก .env ให้กลายเป็น Object
    credentials = JSON.parse(credentialsJson);
} catch (e) {
    console.error('*** FATAL ERROR: Failed to parse GOOGLE_CREDENTIALS_JSON. Make sure it is a valid JSON string. ***', e);
    process.exit(1);
}

// สร้างออปเจ็กต์สำหรับยืนยันตัวตน
const auth = new google.auth.GoogleAuth({
    credentials, // ใช้ credentials ที่เป็น Object โดยตรง
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// สร้าง client สำหรับเรียกใช้ Sheets API
const sheets = google.sheets({ version: 'v4', auth });
console.log('Google Sheets API client initialized.');
// --- End of Google Sheets Setup ---


// Middleware
console.log('Setting up middleware...');
app.use(express.json());
app.use(express.static('public'));

// API Routes
// *** จุดสำคัญ: เราจะส่ง `sheets` object ที่สร้างไว้เข้าไปให้ไฟล์ routes ***
const returnRoutes = require('./routes/returnRoutes')(sheets);
console.log('Setting up API routes...');
app.use('/api/returns', returnRoutes);


// เชื่อมต่อ MongoDB
console.log('Attempting to connect to MongoDB...');
console.log('MONGO_URI from .env:', process.env.MONGO_URI);
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('MongoDB connected successfully');
    })
    .catch(err => {
        console.error('*** MongoDB connection FAILED! (v2) ***');
        console.error('Error details:', err);
        process.exit(1);
    });

// เริ่มต้น Server
console.log('Attempting to start server...');
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

console.log('--- app.js END of main script (v2) ---');
