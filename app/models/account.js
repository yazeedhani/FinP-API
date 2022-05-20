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

// Calculate total expenses for monthTracker
accountSchema.virtual('totalCashflow').get(function() {
    let total = 0

	for(let i = 0; i < this.monthTrackers.length; i++)
	{
		total += this.monthTrackers[i].monthly_cashflow
	}

    return total
})

module.exports = mongoose.model('Account', accountSchema)