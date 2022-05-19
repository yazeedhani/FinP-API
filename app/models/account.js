const mongoose = require('mongoose')

const User = require('./user')
const Expense = require('./expense')
const MonthTracker = require('./monthTracker')

const accountSchema = new mongoose.Schema({
    savings: {
        type: Number,
        default: 0,
    },
    loans: {
        type: Number,
        default: 0
    },
    cashflow: {
        type: Number,
        default: 0,
    },
    income: {
        type: Number,
        required: true
    },
    recurrences: [],
    monthTrackers: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'MonthTracker',
        }
    ],
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        // required: true
    }
})

module.exports = mongoose.model('Account', accountSchema)