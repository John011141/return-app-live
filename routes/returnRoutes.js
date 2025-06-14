const express = require('express');
const router = express.Router();
const ReturnItem = require('../models/ReturnItem');

// สำหรับการเข้าถึง Environment Variables
require('dotenv').config();

// *** จุดสำคัญ: เปลี่ยน module.exports ให้เป็นฟังก์ชันที่รับ `sheets` object เข้ามา ***
// โค้ดทั้งหมดจะถูกห่อหุ้มอยู่ในฟังก์ชันนี้
module.exports = function(sheets) {

    // ฟังก์ชันสำหรับเขียนข้อมูล 1 แถวลง Google Sheet (ปรับปรุงเล็กน้อย)
    // ฟังก์ชันนี้จะใช้ `sheets` object ที่ได้รับมาจาก app.js โดยตรง
    const appendRowToGoogleSheet = async (sheetId, sheetName, rowData) => {
        // ตรวจสอบว่า sheets object ถูกส่งมาหรือไม่
        if (!sheets) {
            console.error("Google Sheets client was not provided. Cannot append row.");
            return false;
        }
        try {
            // เรียกใช้ sheets.spreadsheets.values.append โดยตรง ไม่ต้องมี auth.getClient() อีกต่อไป
            const response = await sheets.spreadsheets.values.append({
                spreadsheetId: sheetId,
                range: `${sheetName}!A:A`, // ให้ Sheets หาแถวว่างสุดท้ายในคอลัมน์ A เป็นต้นไป
                valueInputOption: 'USER_ENTERED', // แนะนำให้ใช้ USER_ENTERED เพื่อให้ Sheets ตีความวันที่/ตัวเลขได้ถูกต้อง
                insertDataOption: 'INSERT_ROWS',
                resource: {
                    values: [rowData],
                },
            });
            console.log(`Appended row to Google Sheet ${sheetId}/${sheetName}:`, response.data.updates.updatedRange);
            return true;
        } catch (error) {
            // แสดง error message ที่มาจาก Google API โดยตรง
            console.error(`Failed to append row to Google Sheet ${sheetId}/${sheetName}:`, error.message);
            return false;
        }
    };


    // Middleware สำหรับจัดการข้อผิดพลาดใน async functions (โค้ดเดิม)
    const asyncHandler = fn => (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };

    // --- API Endpoints (โค้ดเดิมทั้งหมดของคุณ) ---

    // 1. รับข้อมูลการคืนของเสียทั้งหมด
    router.get('/', asyncHandler(async (req, res) => {
        const { searchSn } = req.query;
        let query = {};
        if (searchSn) {
            query.serialNumber = { $regex: searchSn, $options: 'i' };
        }
        const returnedItems = await ReturnItem.find(query).sort({ returnedDate: -1, createdAt: -1 });
        res.json(returnedItems);
    }));

    // 2. เพิ่มรายการคืนของเสียใหม่
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

                // *** ส่วนที่เรียกใช้ Google Sheet (ใช้โค้ดเดิมของคุณ) ***
                const sheetId = process.env.GOOGLE_SHEET_HISTORY_ID;
                const sheetName = 'ประวัติการคืนของเสีย'; // ตรวจสอบว่าชื่อ Sheet ถูกต้อง
                const returnedDateObj = new Date(newReturnItem.returnedDate);

                if (sheetId) { // ตรวจสอบแค่ sheetId เพราะ sheets object ถูกเช็คในฟังก์ชันแล้ว
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
                } else {
                    console.warn(`Google Sheet ID not set for SN "${trimmedSn}". Skipping Google Sheet append.`);
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

    // 3. แก้ไขรายการคืนของเสีย
    router.put('/:id', asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { returnerName, serialNumber, returnedDate, notes } = req.body;
        const updatedItem = await ReturnItem.findByIdAndUpdate(id, { returnerName, serialNumber, returnedDate, notes }, { new: true });
        if (!updatedItem) {
            return res.status(404).json({ message: 'Return item not found.' });
        }
        res.json(updatedItem);
    }));

    // 4. ล้างประวัติการคืนของเสียทั้งหมด
    router.delete('/clear-all', asyncHandler(async (req, res) => {
        const { password } = req.body;
        const ADMIN_DELETE_PASSWORD = process.env.ADMIN_DELETE_PASSWORD;
        if (!ADMIN_DELETE_PASSWORD) {
            return res.status(500).json({ message: 'Server configuration error: Delete password not set.' });
        }
        if (!password || password !== ADMIN_DELETE_PASSWORD) {
            return res.status(401).json({ message: 'Unauthorized: Incorrect password.' });
        }
        const result = await ReturnItem.deleteMany({});
        res.json({ message: `ล้างประวัติการคืนของเสียสำเร็จ ${result.deletedCount} รายการ.` });
    }));

    // *** จุดสำคัญ: return ตัว router ออกไปเพื่อให้ app.js นำไปใช้ ***
    return router;
};
