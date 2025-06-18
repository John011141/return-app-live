const express = require('express');
const router = express.Router();
const ReturnItem = require('../models/ReturnItem');

// สำหรับการเข้าถึง Environment Variables เช่น รหัสผ่านและ Google Sheet ID
require('dotenv').config();

// สำหรับ Google Sheets API (หากคุณต้องการใช้ฟังก์ชันนี้)
const { google } = require('googleapis');
// ไม่ต้องใช้ path เพราะเราจะดึง credentials จาก env vars โดยตรง
// const path = require('path'); // บรรทัดนี้จะถูกลบทิ้งไป

let auth, sheets;

// ***** เริ่มต้นส่วนที่แก้ไขสำหรับ Google Sheets API Initialization *****
// บล็อกโค้ดเก่าที่ใช้ GOOGLE_APPLICATION_CREDENTIALS จะถูกลบออกไปทั้งหมด
// แทนที่ด้วยการดึงค่าจาก Environment Variables โดยตรง
if (process.env.GCP_PRIVATE_KEY && process.env.GCP_CLIENT_EMAIL &&
    process.env.GCP_PROJECT_ID && process.env.GCP_PRIVATE_KEY_ID &&
    process.env.GCP_CLIENT_ID && process.env.GCP_AUTH_URI &&
    process.env.GCP_TOKEN_URI && process.env.GCP_AUTH_PROVIDER_X509_CERT_URL &&
    process.env.GCP_CLIENT_X509_CERT_URL) {
    try {
        const credentials = {
            type: process.env.GCP_TYPE || 'service_account',
            project_id: process.env.GCP_PROJECT_ID,
            private_key_id: process.env.GCP_PRIVATE_KEY_ID,
            // สำคัญ: แปลง \n กลับมา เพราะ Render อาจเก็บเป็น \\n
            private_key: process.env.GCP_PRIVATE_KEY.replace(/\\n/g, '\n'),
            client_email: process.env.GCP_CLIENT_EMAIL,
            client_id: process.env.GCP_CLIENT_ID,
            auth_uri: process.env.GCP_AUTH_URI,
            token_uri: process.env.GCP_TOKEN_URI,
            auth_provider_x509_cert_url: process.env.GCP_AUTH_PROVIDER_X509_CERT_URL,
            client_x509_cert_url: process.env.GCP_CLIENT_X509_CERT_URL,
            universe_domain: process.env.GCP_UNIVERSE_DOMAIN || 'googleapis.com' // ใช้ค่าจาก env หรือ default
        };

        auth = new google.auth.GoogleAuth({
            credentials, // ใช้ credentials object แทน keyFile
            scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        sheets = google.sheets({ version: 'v4', auth });
        console.log('Google Sheets API client initialized using Environment Variables.');
    } catch (error) {
        console.error('Error initializing Google Sheets API client from Env Vars:', error.message);
        // เพิ่ม log สำหรับ debugging หาก credentials มีปัญหา
        if (error.response && error.response.data) {
            console.error('Google Auth Error Details:', error.response.data);
        }
    }
} else {
    console.warn('One or more required GCP environment variables (GCP_PRIVATE_KEY, GCP_CLIENT_EMAIL, etc.) are not set. Google Sheets upload will not work.');
}
// ***** สิ้นสุดส่วนที่แก้ไขสำหรับ Google Sheets API Initialization *****


// ฟังก์ชันสำหรับเขียนข้อมูล 1 แถวลง Google Sheet
const appendRowToGoogleSheet = async (sheetId, sheetName, rowData) => {
    if (!sheets) {
        console.error("Google Sheets API client not initialized. Cannot append row.");
        return false;
    }
    try {
        const authClient = await auth.getClient();
        sheets.context._options.auth = authClient;

        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: `${sheetName}!A:A`,
            valueInputOption: 'RAW', // 'RAW' จะรักษาประเภทข้อมูลที่เราส่งไป ถ้าส่ง string ไป มันก็จะเก็บเป็น string
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [rowData],
            },
        });
        // ลบ span class ออก เพราะมันแสดงผลเป็น raw text ใน log
        console.log(`Appended row to Google Sheet ${sheetId}/${sheetName}:`, response.data.updates.updatedRange);
        return true;
    } catch (error) {
        console.error(`Failed to append row to Google Sheet ${sheetId}/${sheetName}:`, error.message, error.response ? error.response.data : '');
        return false;
    }
};


// Middleware สำหรับจัดการข้อผิดพลาดใน async functions
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// --- API Endpoints สำหรับจัดการของเสีย (Return Item Management) ---

// 1. รับข้อมูลการคืนของเสียทั้งหมด (Get All Return History)
router.get('/', asyncHandler(async (req, res) => {
    const returnedItems = await ReturnItem.find({}).sort({ returnedDate: -1, createdAt: -1 });
    res.json(returnedItems);
}));

// 2. เพิ่มรายการคืนของเสียใหม่ (Add New Return - รองรับหลาย SN)
router.post('/', asyncHandler(async (req, res) => {
    const { returnerName, serialNumbers } = req.body;

    if (!returnerName || !serialNumbers || !Array.isArray(serialNumbers) || serialNumbers.length === 0) {
        return res.status(400).json({ message: 'Returner name and at least one Serial Number are required.' });
    }

    let addedCount = 0;
    let skippedCount = 0;
    let errors = [];
    let addedItemsDetails = [];

    for (const sn of serialNumbers) {
        const trimmedSn = sn.trim();
        if (!trimmedSn) {
            skippedCount++;
            continue;
        }

        // ตรวจสอบว่า serialNumber นี้ถูกคืนไปแล้วหรือไม่
        // ตรวจสอบจาก trimmedSn ที่เป็น String อยู่แล้ว
        const existingReturn = await ReturnItem.findOne({ serialNumber: trimmedSn });

        if (existingReturn) {
            errors.push(`Serial Number "${trimmedSn}" has already been returned.`);
            skippedCount++;
            continue;
        }

        try {
            // สร้าง ReturnItem ใหม่
            const newReturnItem = new ReturnItem({
                returnerName: returnerName,
                // ตรวจสอบให้แน่ใจว่า serialNumber ที่เก็บใน MongoDB เป็น String
                // จาก Schema ของ ReturnItem ก็ควรจะเป็น String อยู่แล้ว
                serialNumber: trimmedSn,
                returnedDate: new Date()
            });
            await newReturnItem.save();
            addedCount++;
            addedItemsDetails.push({
                serialNumber: trimmedSn,
                returnerName: returnerName,
                returnedDate: newReturnItem.returnedDate
            });

            // *** ส่วนที่แก้ไข: เขียนลง Google Sheet ***
            const sheetId = process.env.GOOGLE_SHEET_HISTORY_ID;
            const sheetName = 'ประวัติการคืนของเสีย'; // <--- ชื่อชีทใน Google Sheet (ต้องตรงเป๊ะ)
            const returnedDateObj = new Date(newReturnItem.returnedDate);

            if (sheetId && sheets) {
                const rowData = [
                    returnedDateObj.toLocaleDateString('th-TH'), // วันที่
                    returnedDateObj.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), // เวลา
                    newReturnItem.returnerName, // ชื่อผู้คืน
                    String(newReturnItem.serialNumber) // <--- แก้ไขตรงนี้: แปลง Serial Number เป็น String ก่อนส่ง
                ];
                const appended = await appendRowToGoogleSheet(sheetId, sheetName, rowData);
                if (!appended) {
                    errors.push(`Failed to append SN "${trimmedSn}" to Google Sheet.`);
                }
            } else {
                console.warn(`Google Sheet ID not set or Sheets client not initialized for SN "${trimmedSn}". Skipping Google Sheet append.`);
            }

        } catch (dbError) {
            errors.push(`Error adding return for SN "${trimmedSn}": ${dbError.message}`);
            skippedCount++;
        }
    }

    res.status(200).json({
        message: 'Return process completed.',
        addedCount: addedCount,
        skippedCount: skippedCount,
        errors: errors,
        addedItems: addedItemsDetails
    });
}));

// 3. แก้ไขรายการคืนของเสีย (Update Return Item) - ไม่ได้ใช้ใน Frontend UI นี้
router.put('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { returnerName, serialNumber, returnedDate, notes } = req.body;
    const updatedItem = await ReturnItem.findByIdAndUpdate(id, { returnerName, serialNumber, returnedDate, notes }, { new: true });
    if (!updatedItem) {
        return res.status(404).json({ message: 'Return item not found.' });
    }
    res.json(updatedItem);
}));

// NEW API ENDPOINT: ล้างประวัติการคืนของเสียทั้งหมด
router.delete('/clear-all', asyncHandler(async (req, res) => {
    const { password } = req.body; // รหัสผ่านที่ส่งมาจาก Frontend

    const ADMIN_DELETE_PASSWORD = process.env.ADMIN_DELETE_PASSWORD;

    if (!ADMIN_DELETE_PASSWORD) {
        console.error("ADMIN_DELETE_PASSWORD is not set in .env file!");
        return res.status(500).json({ message: 'Server configuration error: Delete password not set.' });
    }

    if (!password || password !== ADMIN_DELETE_PASSWORD) {
        return res.status(401).json({ message: 'Unauthorized: Incorrect password.' });
    }

    // หากรหัสผ่านถูกต้อง -> ลบข้อมูลทั้งหมด
    const result = await ReturnItem.deleteMany({}); // ลบทุก Document ใน Collection

    res.json({ message: `ล้างประวัติการคืนของเสียสำเร็จ ${result.deletedCount} รายการ.` });
}));


module.exports = router;
