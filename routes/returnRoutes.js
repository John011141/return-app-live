const express = require('express');
const router = express.Router();
const ReturnItem = require('../models/ReturnItem');

// สำหรับการเข้าถึง Environment Variables เช่น รหัสผ่านและ Google Sheet ID
require('dotenv').config();

// สำหรับ Google Sheets API (หากคุณต้องการใช้ฟังก์ชันนี้)
const { google } = require('googleapis');
const path = require('path');

let auth, sheets;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
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

            // *** เพิ่มโค้ดตรงนี้: เขียนลง Google Sheet ***
            const sheetId = process.env.GOOGLE_SHEET_HISTORY_ID;
            const sheetName = 'ประวัติการคืนของเสีย'; // <--- ชื่อชีทใน Google Sheet (ต้องตรงเป๊ะ)
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

// *** API Endpoint เดิมสำหรับลบทีละรายการ (ไม่ใช้แล้ว) ***
// router.delete('/:id', asyncHandler(async (req, res) => { ... }));

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