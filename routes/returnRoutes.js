const express = require('express');
const router = express.Router();
const ReturnItem = require('../models/ReturnItem');

// สำหรับการเข้าถึง Environment Variables
require('dotenv').config();

// สำหรับ Google Sheets API
 const { google } = require('googleapis'); // คอมเมนต์บรรทัดนี้
 const path = require('path'); // คอมเมนต์บรรทัดนี้

 let auth, sheets; // คอมเมนต์บรรทัดนี้
 if (process.env.GOOGLE_APPLICATION_CREDENTIALS) { // คอมเมนต์ Block นี้ทั้งหมด
    try {
         const keyFilePath = path.join(__dirname, '..', process.env.GOOGLE_APPLICATION_CREDENTIALS);
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
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [rowData],
            },
        });
        console.log(`Appended row to Google Sheet <span class="math-inline">\{sheetId\}/</span>{sheetName}:`, response.data.updates.updatedRange);
        return true;
    } catch (error) {
        console.error(`Failed to append row to Google Sheet <span class="math-inline">\{sheetId\}/</span>{sheetName}:`, error.message, error.response ? error.response.data : '');
        return false;
    }
};


// Middleware สำหรับจัดการข้อผิดพลาดใน async functions
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// --- API Endpoints ---

// 1. รับข้อมูลการคืนของเสียทั้งหมด (Get All Return History) - ปรับปรุงสำหรับค้นหา
router.get('/', asyncHandler(async (req, res) => {
    const { searchSn } = req.query; // รับ Query Parameter 'searchSn'

    let query = {};
    if (searchSn) {
        // ค้นหาแบบ Case-insensitive และ Partial Match
        query.serialNumber = { $regex: searchSn, $options: 'i' };
    }

    const returnedItems = await ReturnItem.find(query).sort({ returnedDate: -1, createdAt: -1 });
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

        const existingReturn = await ReturnItem.findOne({ serialNumber: trimmedSn });

        if (existingReturn) {
            errors.push(`Serial Number "${trimmedSn}" has already been returned.`);
            skippedCount++;
            continue;
        }

        try {
            const newReturnItem = new ReturnItem({
                returnerName: returnerName,
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

            // *** เขียนลง Google Sheet ***
            // ... ใน router.post('/', ...) ก็ต้องคอมเมนต์ส่วนที่เรียกใช้ appendRowToGoogleSheet ด้วย

const sheetId = process.env.GOOGLE_SHEET_HISTORY_ID;
const sheetName = 'ประวัติการคืนของเสีย';
const returnedDateObj = new Date(newReturnItem.returnedDate);

if (sheetId && sheets) {
    const rowData = [
        returnedDateObj.toLocaleDateString('th-TH'),
        returnedDateObj.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        newReturnItem.returnerName,
        newReturnItem.serialNumber
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

// 3. แก้ไขรายการคืนของเสีย (Update Return Item)
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
    const { password } = req.body;

    const ADMIN_DELETE_PASSWORD = process.env.ADMIN_DELETE_PASSWORD;

    if (!ADMIN_DELETE_PASSWORD) {
        console.error("ADMIN_DELETE_PASSWORD is not set in .env file!");
        return res.status(500).json({ message: 'Server configuration error: Delete password not set.' });
    }

    if (!password || password !== ADMIN_DELETE_PASSWORD) {
        return res.status(401).json({ message: 'Unauthorized: Incorrect password.' });
    }

    const result = await ReturnItem.deleteMany({});

    res.json({ message: `ล้างประวัติการคืนของเสียสำเร็จ ${result.deletedCount} รายการ.` });
}));


module.exports = router;