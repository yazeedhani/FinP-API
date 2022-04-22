const mongoose = require('mongoose')

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
		expenses: 
			[
				{
					type: mongoose.Schema.Types.ObjectId,
					ref: 'Expense',
					required: true,
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
	}
)

module.exports = mongoose.model('MonthTracker', monthTrackerSchema)
