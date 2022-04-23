const mongoose = require('mongoose')

const expenseSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    category: {
        type: String,
        required: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    monthTracker: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MonthTracker',
        required: true,
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    }
})

module.exports = mongoose.model('Expense', expenseSchema)