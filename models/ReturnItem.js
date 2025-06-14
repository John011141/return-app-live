const mongoose = require('mongoose');

const returnItemSchema = new mongoose.Schema({
    returnedDate: { type: Date, default: Date.now, required: true },
    returnerName: { type: String, required: true },
    serialNumber: { type: String, required: true, unique: true },
    notes: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('ReturnItem', returnItemSchema);