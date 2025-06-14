const express = require('express');
const router = express.Router(); // <--- ประกาศ router ที่นี่

const ReturnItem = require('../models/ReturnItem');

require('dotenv').config();

// สำหรับ Google Sheets API
const { google } = require('googleapis');
const path = require('path'); // path ยังคงจำเป็นหากใช้ keyFile

let auth, sheets;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
        // *** แก้ไขตรงนี้ ***
        // ถ้า GOOGLE_APPLICATION_CREDENTIALS เป็นเนื้อหา JSON (ไม่ใช่ Path ไฟล์)
        // ควรใช้ credentials โดยตรง แทน keyFile
        const credentialsContent = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        auth = new google.auth.GoogleAuth({
            credentials: credentialsContent, // ใช้ credentials object โดยตรง
            scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        sheets = google.sheets({ version: 'v4', auth });
        console.log('Google Sheets API client initialized.');
    } catch (error) {
        console.error('Error initializing Google Sheets API client:', error.message);
        if (error instanceof SyntaxError) {
            console.error('Possible cause: GOOGLE_APPLICATION_CREDENTIALS environment variable is not valid JSON.');
        }
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
        // ไม่ต้องเรียก auth.getClient() และกำหนด sheets.context._options.auth ที่นี่แล้ว
        // เพราะ 'sheets' object ถูก initialize พร้อม 'auth' ที่ถูกต้องแล้ว
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: `${sheetName}!A:A`, // ให้ Sheets หาแถวว่างสุดท้ายในคอลัมน์ A เป็นต้นไป
            valueInputOption: 'USER_ENTERED', // แนะนำให้ใช้ USER_ENTERED เพื่อให้ Sheets ตีความวันที่/ตัวเลขได้ถูกต้อง
            insertDataOption: 'INSERT_ROWS', // แทรกเป็นแถวใหม่
            resource: {
                values: [rowData], // ข้อมูลที่จะเขียน (เป็น Array ของ Array)
            },
        });
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

// --- API Endpoints ---

router.get('/', asyncHandler(async (req, res) => {
    const { searchSn } = req.query;

    let query = {};
    if (searchSn) {
        query.serialNumber = { $regex: searchSn, $options: 'i' };
    }

    const returnedItems = await ReturnItem.find(query).sort({ returnedDate: -1, createdAt: -1 });
    res.json(returnedItems);
}));

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

            // *** ส่วนการเขียนลง Google Sheet: โค้ดที่ใช้งานแล้ว ***
            const sheetId = process.env.GOOGLE_SHEET_HISTORY_ID;
            const sheetName = 'ประวัติการคืนของเสีย'; // ตรวจสอบชื่อชีทใน Google Sheet (ต้องตรงเป๊ะ)
            const returnedDateObj = new Date(newReturnItem.returnedDate);

            if (sheetId && sheets) { // ตรวจสอบว่าตั้งค่า Google Sheet ID และ client initialized
                const rowData = [
                    returnedDateObj.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }),
                    returnedDateObj.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                    newReturnItem.returnerName,
                    newReturnItem.serialNumber
                ];
                const appended = await appendRowToGoogleSheet(sheetId, sheetName, rowData);
                if (!appended) {
                    errors.push(`Failed to append SN "${trimmedSn}" to Google Sheet.`);
                }
            } else if (sheetId && !sheets) { // กรณีมี Sheet ID แต่ sheets client ไม่พร้อม
                console.warn(`Google Sheet ID set but Sheets client not initialized for SN "${trimmedSn}". Skipping Google Sheet append.`);
            } else { // กรณีไม่มี Sheet ID เลย
                console.warn(`Google Sheet ID not set. Skipping Google Sheet append for SN "${trimmedSn}".`);
            }
            // *** สิ้นสุดส่วน Google Sheet ***

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

router.put('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { returnerName, serialNumber, returnedDate, notes } = req.body;
    const updatedItem = await ReturnItem.findByIdAndUpdate(id, { returnerName, serialNumber, returnedDate, notes }, { new: true });
    if (!updatedItem) {
        return res.status(404).json({ message: 'Return item not found.' });
    }
    res.json(updatedItem);
}));

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


module.exports = router; // <--- Export router ตรงๆ
