const mongoose = require('mongoose')

const MonthTracker = require('./monthTracker')

const expenseSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    category: {
        type: String,
        default: 'Savings',
        required: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    date: { 
        type: Date, 
        default: Date.now 
    },
    recurring: {
        type: Boolean,
        default: false
        // required: true
    },
    recurringId: {
        type: String
    },
    monthTracker: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MonthTracker',
        // required: true,
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    }
}, { timestamps: true,}
)

module.exports = mongoose.model('Expense', expenseSchema)