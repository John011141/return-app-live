document.addEventListener('DOMContentLoaded', () => {
    // --- ฟังก์ชันพื้นฐาน ----------------------------------------------------

    // ฟังก์ชันสำหรับตั้งค่าวันที่ปัจจุบันในฟอร์ม (ถูกเรียกเมื่อโหลดหน้า)
    window.setCurrentDate = () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');
        const formattedDate = `${year}-${month}-${day}`;

        const dateInput = document.getElementById('return-date');
        if (dateInput) {
            dateInput.value = formattedDate;
        }
    };

    // ฟังก์ชันสำหรับแสดง/ซ่อน Section ต่างๆ และโหลดข้อมูลที่เกี่ยวข้อง
    window.showSection = (sectionId) => {
        document.querySelectorAll('section').forEach(section => {
            section.classList.add('hidden');
        });
        document.getElementById(sectionId).classList.remove('hidden');

        if (sectionId === 'return-history-section') {
            loadReturnHistory(); // โหลดประวัติเมื่อเข้าหน้าประวัติ
        } else if (sectionId === 'return-form-section') {
            setCurrentDate(); // ตั้งค่าวันที่เมื่อแสดงฟอร์มคืนของเสีย
        }
    };

    // ฟังก์ชันสำหรับแสดงข้อความสถานะ (สำเร็จ/ผิดพลาด)
    const showMessage = (elementId, message, type = 'success') => {
        const element = document.getElementById(elementId);
        element.textContent = message;
        element.className = `message ${type}`;
        setTimeout(() => {
            element.textContent = '';
            element.className = 'message';
        }, 5000); // แสดงข้อความ 5 วินาที
    };

    // --- ฟังก์ชันโหลดข้อมูลตาราง -------------------------------------------

    // โหลดประวัติการคืนของเสีย
    const loadReturnHistory = async () => {
        const historyTableBody = document.querySelector('#history-table tbody');
        // กำหนด colspan เป็น 4 เพราะตอนนี้มี 4 คอลัมน์ (วันที่, เวลา, ชื่อ, SN) ไม่มีคอลัมน์จัดการแล้ว
        historyTableBody.innerHTML = '<tr><td colspan="4">กำลังโหลดประวัติ...</td></tr>';
        try {
            const response = await fetch('/api/returns');
            const items = await response.json();
            historyTableBody.innerHTML = '';

            if (items.length === 0) {
                historyTableBody.innerHTML = '<tr><td colspan="4">ไม่มีรายการคืนของเสียในประวัติ</td></tr>';
                return;
            }

            items.forEach(item => {
                const row = historyTableBody.insertRow();
                row.insertCell().textContent = item.returnedDate ? new Date(item.returnedDate).toLocaleDateString('th-TH') : '-';
                row.insertCell().textContent = item.returnedDate ? new Date(item.returnedDate).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
                row.insertCell().textContent = item.returnerName || '-';
                row.insertCell().textContent = item.serialNumber || '-';

                // *** ลบโค้ดที่สร้างปุ่ม "ลบ" (actionsCell) ออกไปแล้ว ***
                // (เพราะจะไม่มีปุ่มลบแยกแต่ละรายการแล้ว)
                // const actionsCell = row.insertCell();
                // actionsCell.innerHTML = `<button onclick="deleteReturnItem('${item._id}')" style="background-color: #f44336; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">ลบ</button>`;
            });
        } catch (error) {
            console.error('Error loading return history:', error);
            historyTableBody.innerHTML = '<tr><td colspan="4">เกิดข้อผิดพลาดในการโหลดประวัติ</td></tr>';
            showMessage('history-message', 'เกิดข้อผิดพลาดในการโหลดประวัติการคืนของเสีย', 'error');
        }
    };

    // --- Event Listener สำหรับฟอร์ม ----------------------------------------

    // Event Listener สำหรับฟอร์มคืนของเสีย
    const returnItemForm = document.getElementById('return-item-form');
    if (returnItemForm) {
        returnItemForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const returnDateInput = document.getElementById('return-date');
            const returnerName = document.getElementById('returner-name').value;
            const rawSns = document.getElementById('sn-list').value;

            const serialNumbers = rawSns.split('\n')
                                        .map(sn => sn.trim())
                                        .filter(sn => sn !== '');

            if (!returnerName) {
                showMessage('form-message', 'กรุณากรอก ชื่อ-นามสกุล ผู้คืน', 'error');
                return;
            }
            if (serialNumbers.length === 0) {
                showMessage('form-message', 'กรุณากรอก SN ที่คืน อย่างน้อย 1 ตัว', 'error');
                return;
            }

            try {
                const response = await fetch('/api/returns', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        returnerName: returnerName,
                        serialNumbers: serialNumbers
                    }),
                });
                const data = await response.json();

                if (response.ok) {
                    let msg = `คืนของเสียสำเร็จ ${data.addedCount} รายการ`;
                    if (data.skippedCount > 0) {
                        msg += `, ข้ามไป ${data.skippedCount} รายการ. Error: ${data.errors.join(', ')}`;
                    }
                    showMessage('form-message', msg, 'success');
                    returnItemForm.reset();
                    setCurrentDate();
                    loadReturnHistory();
                } else {
                    showMessage('form-message', `ข้อผิดพลาด: ${data.message || 'ไม่สามารถบันทึกการคืนของเสียได้'}`, 'error');
                    console.error('API Error Response:', data);
                }
            } catch (error) {
                console.error('Error submitting return item:', error);
                showMessage('form-message', 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ Server', 'error');
            }
        });
    }

    // *** ฟังก์ชันสำหรับลบรายการคืนของเสีย (เดิม) - ถูกลบไปแล้ว ***
    // window.deleteReturnItem = async (id) => { ... }

    // NEW Event Listener สำหรับปุ่ม "ล้างประวัติทั้งหมด"
    const clearAllHistoryButton = document.getElementById('clear-all-history-button');
    if (clearAllHistoryButton) {
        clearAllHistoryButton.addEventListener('click', async () => {
            const password = prompt("กรุณากรอกรหัสผ่านเพื่อยืนยันการล้างประวัติทั้งหมด:");

            if (!password) {
                showMessage('history-message', 'การล้างประวัติถูกยกเลิก', 'error');
                return;
            }

            if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการล้างประวัติการคืนของเสียทั้งหมด? การดำเนินการนี้ไม่สามารถย้อนกลับได้!")) {
                showMessage('history-message', 'การล้างประวัติถูกยกเลิก', 'error');
                return;
            }

            try {
                const response = await fetch('/api/returns/clear-all', { // เรียกใช้ API ลบทั้งหมด
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ password: password }) // ส่งรหัสผ่าน
                });

                const data = await response.json();

                if (response.status === 401) {
                    showMessage('history-message', `ข้อผิดพลาด: ${data.message || 'รหัสผ่านไม่ถูกต้อง'}`, 'error');
                } else if (response.ok) {
                    showMessage('history-message', data.message || 'ล้างประวัติทั้งหมดสำเร็จ!', 'success');
                    loadReturnHistory(); // โหลดประวัติใหม่ (ตอนนี้ควรจะว่างเปล่า)
                } else {
                    showMessage('history-message', `ข้อผิดพลาดในการล้างประวัติ: ${data.message || 'ไม่สามารถล้างประวัติได้'}`, 'error');
                    console.error('Clear All API Error Response:', data);
                }
            } catch (error) {
                console.error('Error clearing all history:', error);
                showMessage('history-message', 'เกิดข้อผิดพลาดในการเชื่อมต่อ Server ขณะล้างประวัติ', 'error');
            }
        });
    }

    // โหลดประวัติครั้งแรกเมื่อโหลดหน้า
    showSection('return-form-section'); // แสดงฟอร์มคืนของเสียเป็นหน้าแรก
});