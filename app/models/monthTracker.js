const mongoose = require('mongoose')

const Expense = require('./expense')

const monthTrackerSchema = new mongoose.Schema(
	{
		month: {
			type: String,
			required: true,
		},
		year: {
			type: Number,
			required: true,
		},
		annualTakeHome: {
			type: Number,
		},
		monthlyTakeHome: {
			type: Number,
		},
		budget: {
			type: Number,
		},
		monthly_savings: {
			type: Number,
			default: 0,
		},
		monthly_loan_payments: {
			type: Number,
			default: 0
		},
		monthly_cashflow: {
			type: Number,
			default: 0,
		},
		expenses: 
			[
				{
					type: mongoose.Schema.Types.ObjectId,
					ref: 'Expense',
					// required: true,
				}
			]
		,
		owner: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
	},
	{
		timestamps: true,
		toObject: {virtuals: true},
		toJSON: {virtuals: true}
	}
)

monthTrackerSchema.virtual('monthTrackerTitle').get(function() {
	return `${this.month} ${this.year}`
})

monthTrackerSchema.virtual('totalExpenses').get(function() {
	let total = 0

	for(let i = 0; i < this.expenses.length; i++)
	{
		total += this.expenses[i].amount
	}

	return total
})

module.exports = mongoose.model('MonthTracker', monthTrackerSchema)
