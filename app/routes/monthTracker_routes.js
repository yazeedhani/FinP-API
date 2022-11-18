// Express docs: http://expressjs.com/en/api.html
const express = require('express')
// Passport docs: http://www.passportjs.org/docs/
const passport = require('passport')

// pull in Mongoose model for examples
const MonthTracker = require('../models/monthTracker')
const Expense = require('../models/expense')
const Account = require('../models/account')
const Year = require('../models/year')

// this is a collection of methods that help us detect situations when we need
// to throw a custom error
const customErrors = require('../../lib/custom_errors')
// we'll use this function to send 404 when non-existant document is requested
const handle404 = customErrors.handle404
// we'll use this function to send 401 when a user tries to modify a resource
// that's owned by someone else
const requireOwnership = customErrors.requireOwnership

// this is middleware that will remove blank fields from `req.body`, e.g.
// { example: { title: '', text: 'foo' } } -> { example: { text: 'foo' } }
const removeBlanks = require('../../lib/remove_blank_fields')

// passing this as a second argument to `router.<verb>` will make it
// so that a token MUST be passed for that route to be available
// it will also set `req.user`
const requireToken = passport.authenticate('bearer', { session: false })

// instantiate a router (mini app that only handles routes)
const router = express.Router()

// Adjust total cashflow for account document	
const adjustAccountTotalCashflow = async (userId) => {
	try {
		let totalCashflow = 0
		const userAccount = await Account.findOne({owner: userId}).populate('monthTrackers')
		await handle404(userAccount)
		console.log('userAccount in adjustAccounTotalCashflow()')
		console.log('userAccount: ', userAccount)
		userAccount.monthTrackers.forEach( monthTracker => {
			console.log('monthTracker[i].monthly_cashflow', monthTracker.monthly_cashflow)
			totalCashflow += monthTracker.monthly_cashflow
			console.log('totalcashflow: ', totalCashflow)
		})

		userAccount.cashflow = totalCashflow
		userAccount.save()
		console.log('End of adjustAccounTotalCashflow()')
		return totalCashflow	
	}
	catch(err) {
		next(err)
	}
}

/******************* MONTHTRACKER ***********************/

// INDEX -> GET /monthTrackers - get monthTrackers only for the logged in user
router.get('/monthTrackers', requireToken, async (req, res, next) => {
	try {
		const userId = req.user._id
		const monthTrackersByOwner = await MonthTracker.find({owner: userId})
		await handle404(monthTrackersByOwner)
		const monthTrackersByOwnerJsObjects = monthTrackersByOwner.map((monthTracker) => monthTracker.toObject())
		res.status(200).json({ monthTrackers: monthTrackersByOwnerJsObjects })
	}
	catch(err) {
		next(err)
	}
})

// SHOW -> GET /monthTrackers/5a7db6c74d55bc51bdf39793
router.get('/monthTrackers/:id', requireToken, async (req, res, next) => {
	// req.params.id will be set based on the `:id` in the route
	try {
		const monthTrackerById = await MonthTracker.findById(req.params.id).populate('expenses')
		// Check to see if the document queried exists or not to throw 404
		await handle404(monthTrackerById)
		console.log('MONTHTRACKER BY ID:', monthTrackerById)
		await requireOwnership(req, monthTrackerById)
		res.status(200).json({ monthTracker: monthTrackerById.toObject() })
	}
	catch(err) {
		console.log('Error.name:', err.name)
		console.log('Error.status:', err.status)
		console.log('Error:', err)
		next(err)
	}
})

// CREATE -> POST /monthTrackers
router.post('/monthTrackers', requireToken, async (req, res, next) => {
	// set owner, annualTakeHome, and monthlyTakeHome of new monthTracker
	console.log('req.user:', req.user)
	console.log('req.body.monthTracker:', req.body.monthTracker)
	try {
		// set income and monthtrackerId variables using let
		let income
		let monthTrackerId

		// Find account for logged in user and populate monthTrackers
		const loggedInUserAccount = await Account.findOne({owner: req.user._id})
		await handle404(loggedInUserAccount)
		console.log('loggedInUserAccount:', loggedInUserAccount)

		// then set income and properties for req.body.monthTracker
		income = loggedInUserAccount.income
		req.body.monthTracker.owner = req.user._id
		req.body.monthTracker.year = parseInt(req.body.monthTracker.year)
		req.body.monthTracker.annualTakeHome = income
		req.body.monthTracker.monthlyTakeHome = parseFloat(income / 12)
		req.body.monthTracker.budget = parseFloat(req.body.monthTracker.budget)
		req.body.monthTracker.monthly_cashflow = req.body.monthTracker.monthlyTakeHome
		req.body.monthTracker.totalExpenses = 0

		// First, create new monthTracker
		const newMonthTracker = await MonthTracker.create(req.body.monthTracker)
		monthTrackerId = newMonthTracker._id
		console.log('New Month Tracker: ', newMonthTracker)
		// add new monthTracker to account
		loggedInUserAccount.monthTrackers.push(monthTrackerId)
		console.log('LoggedInUserAccount monthTrackers:', loggedInUserAccount.monthTrackers)
		// Second, create the recurring Expense documents using insertMany() from the account.recurrences
		console.log('RECURRENCES LENGTH: ', loggedInUserAccount.recurrences.length)
		const recurringExpenses = await Expense.insertMany(loggedInUserAccount.recurrences)

		// Third, assign each recurring expense the new monthTrackerId
		recurringExpenses.forEach( async (recurringExpense) => {
			recurringExpense.monthTracker = monthTrackerId
			delete recurringExpense.recurringId // NOT WORKING
			// Fourth, increment loan payments. monthlyTakeHome, and savings amounts for the month
			// and adjust total loans payments and savings for the account document
			if( recurringExpense.category === 'Loans' )
			{
				newMonthTracker.monthly_loan_payments += recurringExpense.amount
				loggedInUserAccount.loans -= recurringExpense.amount
				// account.loans += expenses[i].amount
			}
			else if( recurringExpense.category === 'Savings' )
			{
				newMonthTracker.monthly_savings += recurringExpense.amount
				loggedInUserAccount.savings += recurringExpense.amount
			}
			else if( recurringExpense.category === 'Income' )
			{
				newMonthTracker.monthlyTakeHome += recurringExpense.amount
			}
			// Fifth, calculate monthTracker.totalExpeses if there were any recurring expeneses, excluding expenses with an 'Income' category.
			if( recurringExpense.category !== 'Income' )
			{
				newMonthTracker.totalExpenses += recurringExpense.amount
			}
			await recurringExpense.save()
			console.log('RECURRING EXPENSE: ', recurringExpense)
		})

		// Sixth, calculate monthly cashflow
		newMonthTracker.monthly_cashflow = parseFloat(newMonthTracker.monthlyTakeHome) - parseFloat(newMonthTracker.totalExpenses)
		
		await loggedInUserAccount.save()
		// Eigth, add the expenses with the new monthTracker's ID to its expenses array in monthTracker
		newMonthTracker.expenses = recurringExpenses
		await newMonthTracker.save()
		console.log('UPDATED MONTHTRACKER: ', newMonthTracker)
		// Ninth, adjust total cashflow in account document
		console.log('Executing adjustTotalCashflow()')
		const adjustTotalCashFlow = await adjustAccountTotalCashflow(req.user._id)
		console.log('Executed adjustTotalCashflow()')
		res.status(201).json({ monthTracker: newMonthTracker.toObject() })
	}
	catch(err) {
		next(err)
	}
})

// UPDATE -> PATCH /monthTrackers/5a7db6c74d55bc51bdf39793
router.patch('/monthTrackers/:id', requireToken, removeBlanks, async (req, res, next) => {
	// if the client attempts to change the `owner` property by including a new
	// owner, prevent that by deleting that key/value pair
	try {
		delete req.body.monthTracker.owner
		const monthTrackerId = req.params.id
	
		const monthTracker = await MonthTracker.findById(monthTrackerId).populate('expenses')
		await handle404(monthTracker)
		// pass the `req` object and the Mongoose record to `requireOwnership`
		// it will throw an error if the current user isn't the owner
		requireOwnership(req, monthTracker)
		// Find all transactions with category 'Income' to add it to monthlyTakehome
		let extraIncome = 0
		monthTracker.expenses.forEach( expense => {
			if( expense.category === 'Income' )
			{
				console.log('EXPENSE: ', expense)
				extraIncome += expense.amount
			}
		})
		// Recalculate total monthlyTakeHome
		req.body.monthTracker.monthlyTakeHome = (req.body.monthTracker.annualTakeHome / 12) + extraIncome

		// pass the result of Mongoose's `.update` to the next `.then`
		// Recalculate cashflow
		req.body.monthTracker.monthly_cashflow = req.body.monthTracker.monthlyTakeHome - monthTracker.totalExpenses
		// Update monthTracker
		await monthTracker.updateOne(req.body.monthTracker)
		// Adjust total cashflow in account document
		await adjustAccountTotalCashflow(req.user._id, next)

		res.sendStatus(204)
	}
	catch(err) {
		next(err)
	}
})

// DESTROY -> DELETE /monthTrackers/5a7db6c74d55bc51bdf39793 - deletes a monthTracker along with all of its expenses
// MonthTracker will also be removed from monthTrackers array in account document
// Adjust total cashflow in account document
// Get the total of savings and loans for each monthTracker to be deleted
router.delete('/monthTrackers/:monthTrackerId', requireToken, async (req, res, next) => {
	try {
		const owner = req.user._id
		const monthTrackerId = req.params.monthTrackerId
		const monthTracker = await MonthTracker.findById(monthTrackerId)
		await handle404(monthTracker)
		// throw an error if current user doesn't own `monthTracker`
		requireOwnership(req, monthTracker)
		// Adjust total savings and total loan repayments in user's account
		const userAccount = await Account.findOne({owner: owner})
		await handle404(userAccount)
		userAccount.savings -= monthTracker.monthly_savings
		userAccount.loans += monthTracker.monthly_loan_payments
		// Remove monthTracker from account
		userAccount.monthTrackers.splice(userAccount.monthTrackers.indexOf(monthTrackerId), 1)
		await userAccount.save()
		// delete the monthTracker ONLY IF the above didn't throw
		await monthTracker.deleteOne()
		// Delete all expenses for the monthTracker
		await Expense.deleteMany({monthTracker: monthTrackerId})
		// Adjust total cashflow in account document
		await adjustAccountTotalCashflow(req.user._id, next)
		// send back 204 and no content if the deletion succeeded
		res.sendStatus(204)
	}
	catch(err) {
		next(err)
	}
})

/******************* EXPENSES ***********************/

// INDEX -> GET /monthTrackers/:monthTrackerId/expenses - to display expenses array in a monthTracker
router.get('/monthTrackers/:monthTrackerId/expenses', requireToken, async (req, res, next) => {
	try {
		const monthTrackerId = req.params.monthTrackerId

		const monthTracker = await MonthTracker.findById(monthTrackerId).populate('expenses')
		await handle404(monthTracker)
		requireOwnership(req, monthTracker)
		res.status(200).json({ expenses: monthTracker.expenses.toObject() })
	}
	catch(err) {
		next(err)
	}
})

// SHOW -> GET /monthTrackers/:monthTrackerID/:expenseId - to display a single expense for a monthTracker
router.get('/monthTrackers/:monthTrackerId/:expenseId', requireToken, async (req, res, next) => {	
	try {
		const expenseId = req.params.expenseId
		const expense = await Expense.findById(expenseId)
		await handle404(expense)
		requireOwnership(req, expense)
		res.status(200).json({ expense: expense.toObject()})
	}
	catch(err) {
		next(err)
	}
})

// CREATE -> POST /monthTrackers/:monthTrackerId/expenses 
// - to create a new expense add it to the expenses array in the current monthTracker document
router.post('/monthTrackers/:monthTrackerId/expense', requireToken, async (req, res, next) => {
	try {
		const monthTrackerId = req.params.monthTrackerId
		req.body.expense.owner = req.user._id
		req.body.expense.monthTracker = monthTrackerId
		req.body.expense.amount = parseFloat(req.body.expense.amount)
		req.body.expense.date = new Date(req.body.expense.date)
		console.log('REQ.BODY:', req.body)
		// Create the new expense
		const newExpense = await Expense.create(req.body.expense)

		// Add new expense to monthTracker
		const monthTracker = await MonthTracker.findById(monthTrackerId)
		monthTracker.expenses.push(newExpense)

		// If category is 'Savings', add amount to monthly savings and total savings in account
		const userAccount = await Account.findOne({owner: req.user._id})
		if(newExpense.category === 'Savings')
		{
			monthTracker.monthly_savings += newExpense.amount
			userAccount.savings += newExpense.amount
		}
		// If category is 'Loans', add amount to monthly savings and subtract from total loans in account
		else if(newExpense.category === 'Loans')
		{
			monthTracker.monthly_loan_payments += newExpense.amount
			userAccount.loans -= newExpense.amount
		}
		// If category is 'Income', add amount to monthly income
		else if(newExpense.category === 'Income')
		{
			monthTracker.monthlyTakeHome += newExpense.amount
		}

		// Adjust monthly cashflow and totalExpenses
		// If category is 'Income', do not add amount to total expenses
		if(newExpense.category !== 'Income')
		{
			monthTracker.totalExpenses += newExpense.amount
		}
		monthTracker.monthly_cashflow = parseFloat(monthTracker.monthlyTakeHome) - parseFloat(monthTracker.totalExpenses)
		await monthTracker.save()
		
		if(newExpense.recurring)
		{	
			delete req.body.expense.monthTracker
			// Anytime you create a recurring expense assign it a custom field and random number - called it recurringID
			req.body.expense.recurringId = Math.floor(Math.random() * 1000000).toString() + req.body.expense.name 
			userAccount.recurrences.push(req.body.expense)
		}
		await userAccount.save()

		await adjustAccountTotalCashflow(req.user._id, next)

		res.status(201).json({ expense: newExpense.toObject() })
	}
	catch(err) {
		next(err)
	}
})

// UPDATE/PATCH -> PATCH /monthTrackers/:monthTrackerID/:expenseId - to edit a single expense for a monthTracker
// If expense is in the Savings or Loans category, then update the savings or loans in the monthTracker and accounts documents to reflect the change
// Monthly cashflow will be adjusted
router.patch('/monthTrackers/:monthTrackerId/:expenseId', requireToken, removeBlanks, async (req, res, next) => {
	try {
		const monthTrackerId = req.params.monthTrackerId
		const expenseId = req.params.expenseId
		// console.log('REQ.BODY:', req.body)
		delete req.body.expense.owner

		const monthTracker = await MonthTracker.findById(monthTrackerId).populate('expenses')
		await handle404(monthTracker)
		requireOwnership(req, monthTracker)
		const expense = await Expense.findById(expenseId)
		await handle404(expense)
		requireOwnership(req, expense)
		const userAccount = await Account.findOne({owner: req.user._id})
		await handle404(userAccount)

		// To edit an expense that is changing its category from Savings to another category, except Loans
		if(expense.category === 'Savings' && req.body.expense.category !== 'Savings' && req.body.expense.category !== 'Loans')
		{
			console.log('ONE')
			await userAccount.updateOne({ savings: userAccount.savings - parseFloat(expense.amount)})

			// If req.body.expense.category is 'Income'
			if(req.body.expense.category === 'Income')
			{
				// Update monthlyTakeHome
				monthTracker.monthlyTakeHome += parseFloat(req.body.expense.amount)
				await monthTracker.save()
			}						
			// Update savings for month tracker
			console.log('EXPENSE.AMOUNT: ', expense.amount)	
			await monthTracker.updateOne({monthly_savings: monthTracker.monthly_savings - parseFloat(expense.amount)}) 
		}
		// To edit an expense that is changing its category from Loans to another category, except Savings
		else if(expense.category === 'Loans' && req.body.expense.category !== 'Loans' && req.body.expense.category !== 'Savings')
		{
			console.log('TWO')
			await userAccount.updateOne({ loans: userAccount.loans + parseFloat(expense.amount)})

			// If req.body.expense.category is 'Income'
			if(req.body.expense.category === 'Income')
			{
				// Update monthlyTakeHome
				monthTracker.monthlyTakeHome += parseFloat(req.body.expense.amount)
				await monthTracker.save()
			}						
			// Update savings for month tracker
			await monthTracker.updateOne({monthly_loan_payments: monthTracker.monthly_loan_payments - parseFloat(expense.amount)}) 
		}
		// To edit an expense that is changing its category to Savings, (The previos category cannot be Loans)
		else if(expense.category !== 'Savings' && req.body.expense.category === 'Savings' && expense.category !== 'Loans')
		{
			console.log('THREE')
			await userAccount.updateOne({ savings: userAccount.savings + parseFloat(req.body.expense.amount)})

			// If expense.category is 'Income'
			if(expense.category === 'Income')
			{
				// Update monthlyTakeHome
				monthTracker.monthlyTakeHome -= parseFloat(expense.amount)
				console.log('MONTHLY TAKEHOME UPDATED: ', monthTracker.monthlyTakeHome, expense.amount)
				await monthTracker.save()
			}
			// Update savings for month tracker
			await monthTracker.updateOne({monthly_savings: monthTracker.monthly_savings + parseFloat(req.body.expense.amount)})
		}
		// To edit an expense that is changing its category to Loans, (The previos category cannot be Savings)
		else if(expense.category !== 'Loans' && req.body.expense.category === 'Loans' && expense.category !== 'Savings')
		{
			console.log('FOUR')
			await userAccount.updateOne({ loans: userAccount.loans - parseFloat(req.body.expense.amount)})

			// If expense.category is 'Income'
			if(expense.category === 'Income')
			{
				// Update monthlyTakeHome
				monthTracker.monthlyTakeHome -= parseFloat(expense.amount)
				console.log('MONTHLY TAKEHOME UPDATED: ', monthTracker.monthlyTakeHome, expense.amount)
				await monthTracker.save()
			}
			// Update savings for month tracker
			await monthTracker.updateOne({monthly_loan_payments: monthTracker.monthly_loan_payments + parseFloat(req.body.expense.amount)})
		}
		// To edit an expense that is changing its category from Savings to Loans
		else if(expense.category === 'Savings' && req.body.expense.category === 'Loans')
		{
			console.log('FIVE')
			console.log('SAVINGS TO LOANS')
			
			userAccount.loans -= parseFloat(req.body.expense.amount)
			userAccount.savings -= parseFloat(expense.amount)
			await userAccount.save()
			
			monthTracker.monthly_loan_payments += parseFloat(req.body.expense.amount)
			monthTracker.monthly_savings -= parseFloat(expense.amount)
			await monthTracker.save()
		}
		// To edit an expense that is changing its category from Loans to Savings
		else if(expense.category === 'Loans' && req.body.expense.category === 'Savings')
		{
			console.log('SIX')
			console.log('LOANS TO SAVINGS')

			userAccount.loans += parseFloat(expense.amount)
			userAccount.savings += parseFloat(req.body.expense.amount)
			await userAccount.save()
			
			monthTracker.monthly_loan_payments -= parseFloat(expense.amount)
			monthTracker.monthly_savings += parseFloat(req.body.expense.amount)
			await monthTracker.save()
		}
		// To edit an expense with the current category Savings
		else if(req.body.expense.category === 'Savings' || expense.category === 'Savings')
		{
			console.log('SEVEN')
			console.log('SAVINGS UPDATED')
			console.log('EXPENSE.AMOUNT: ', expense.amount)

			const updatedSavingsExpense = parseFloat(req.body.expense.amount)

			if(monthTracker.monthly_savings === 0)
			{
				await userAccount.updateOne({ savings: (userAccount.savings + updatedSavingsExpense) })
				await monthTracker.updateOne({ monthly_savings: updatedSavingsExpense })
			}
			else
			{
				await userAccount.updateOne({ savings: (userAccount.savings - monthTracker.monthly_savings) + (monthTracker.monthly_savings - expense.amount + updatedSavingsExpense) })
				await monthTracker.updateOne({ monthly_savings: monthTracker.monthly_savings - expense.amount + updatedSavingsExpense })
			}
		}
		// To edit an expense with the current category Loans
		else if(expense.category === 'Loans' || req.body.expense.category === 'Loans')
		{
			console.log('EIGHT')
			console.log('LOANS UPDATED')
		
			if(monthTracker.monthly_loan_payments === 0)
			{
				await userAccount.updateOne({ loans: (userAccount.loans + parseFloat(req.body.expense.amount)) })
				await monthTracker.updateOne({ monthly_loan_payments: parseFloat(req.body.expense.amount) })
			}
			else
			{
				await userAccount.updateOne({ loans: (userAccount.loans + monthTracker.monthly_loan_payments) - (monthTracker.monthly_loan_payments - expense.amount + parseFloat(req.body.expense.amount)) })
				await monthTracker.updateOne({ monthly_loan_payments: (monthTracker.monthly_loan_payments - expense.amount + parseFloat(req.body.expense.amount)) })
			}
		}
		// To edit an expense with the current category Income
		else if( expense.category === 'Income' && req.body.expense.category === 'Income' )
		{
			console.log('NINE')
			await monthTracker.updateOne({ monthlyTakeHome: (monthTracker.monthlyTakeHome - expense.amount) + parseFloat(req.body.expense.amount)})
		}
		// To edit an expense with the current category Income to another category other than Savings and Loans
		else if( expense.category === 'Income' && req.body.expense.category !== 'Savings' && req.body.expense.category !== 'Loans')
		{
			console.log('TEN')
			await monthTracker.updateOne({ monthlyTakeHome: (monthTracker.monthlyTakeHome - expense.amount)})
		}
		// To edit an expense from a category other than Income, Savings and Loans to Income category
		else if( expense.category !== 'Income' && req.body.expense.category === 'Income' && req.body.expense.category !== 'Savings' && req.body.expense.category !== 'Loans')
		{
			console.log('ELEVEN')
			await monthTracker.updateOne({ monthlyTakeHome: (monthTracker.monthlyTakeHome + parseFloat(req.body.expense.amount))})
		}

		// To handle recurring transaction checkbox
		// if(req.body.expense.recurring && expense.recurring === false)
		// {
		// 	const recurringTransaction = {
		// 		name: req.body.expense.name,
		// 		amount: req.body.expense.amount,
		// 		category: req.body.expense.category,
		// 		recurring: true,
		// 		owner: req.user._id,
		// 		recurringId: Math.floor(Math.random() * 1000000).toString() + req.body.expense.name
		// 	}
		// 	userAccount.recurrences.push(recurringTransaction)
		// 	await userAccount.save()
		// }
		// else
		// {
		// 	let expenseIndex
		// 	console.log('HERE')
		// 	// const expenseIndex = account.recurrences.indexOf(recurringId)
		// 	userAccount.recurrences.forEach( (recurrence, index) => {
		// 		console.log('RECURRENCE: ', recurrence)
		// 		console.log('EXPENSE:', expense)
		// 		if(recurrence.recurringId === expense.recurringId)
		// 		{
		// 			expenseIndex = index
		// 		}
		// 	})
		// 	userAccount.recurrences.splice(expenseIndex, 1)
		// 	await userAccount.save()
		// }

		// Update the expense
		// console.log('EXPENSE UPDATING')
		expense.name = req.body.expense.name
		expense.amount = req.body.expense.amount
		expense.category = req.body.expense.category
		expense.recurring = req.body.expense.recurring
		expense.date = new Date(req.body.expense.date)
		await expense.save()

		console.log('EXPENSE UPDATED:', expense)


		// Re-calculate totalExpenses, monthly cashflow, and total cashflow
		// Re-calculate total expenses and update total expenses if transaction category isn't 'Income'
		let updatedTotalExpenses = 0

		const updatedExpensesInMonthTracker = await MonthTracker.findById(monthTrackerId).populate('expenses')
		await handle404(updatedExpensesInMonthTracker)
		updatedExpensesInMonthTracker.expenses.forEach( expense => {
			// console.log('EXPENSE: ', expense)
			if(expense.category !== 'Income')
			{
				updatedTotalExpenses += parseFloat(expense.amount)
			}
		})
		// console.log('TOTAL EXPENSES:', updatedTotalExpenses)
		updatedExpensesInMonthTracker.totalExpenses = updatedTotalExpenses
		await updatedExpensesInMonthTracker.updateOne({ totalExpenses: updatedTotalExpenses })
		// Re-calculate monthly cashflow and update monthly cashflow
		// console.log('UPDATED MONTHLY-TAKEHOME: ', updatedExpensesInMonthTracker.monthlyTakeHome)
		// console.log('UPDATED TOTAL EXPENSES - MONTHTRACKER: ', updatedExpensesInMonthTracker.totalExpenses)
		// monthTracker.monthly_cashflow = parseFloat(monthTracker.monthlyTakeHome) - parseFloat(monthTracker.totalExpenses)
		// console.log('MONTHLY CASHFLOW: ', updatedExpensesInMonthTracker.monthly_cashflow)
		await updatedExpensesInMonthTracker.updateOne({ monthly_cashflow: parseFloat(updatedExpensesInMonthTracker.monthlyTakeHome) - parseFloat(updatedExpensesInMonthTracker.totalExpenses) })

		// Re-calculate total cashflow
		await adjustAccountTotalCashflow(req.user._id, next)

		res.sendStatus(204)
	}
	catch(err) {
		next(err)
	}
})

// DESTROY -> DELETE /monthTrackers/:monthTrackerID/:expenseId - to delete a single expense for a monthTracker
// The expense must be removed from the expenses array in MonthTracker and delete the expense document
// Monthly cashflow will be adjusted
router.delete('/monthTrackers/:monthTrackerId/:expenseId', requireToken, async (req, res, next) => {
	try {
		const monthTrackerId = req.params.monthTrackerId
		const expenseId = req.params.expenseId

		// This removes the expense from the expenses array in monthTracker
		const monthTracker = await MonthTracker.findById(monthTrackerId).populate('expenses')
		await handle404(monthTracker)
		requireOwnership(req, monthTracker)
		const expenses = monthTracker.expenses
		console.log('monthTracker in DELETE route', monthTracker)
		console.log('expenses in DELETE route', expenses)
		console.log('expenseId', expenseId)

		const userAccount = await Account.findOne({owner: req.user._id})

		//Remove the expense from the expenses array for the monthTracker
		// FIND THE INDEX OF THE EXPENSE IN THE EXPENSES ARRAY
		let index = null
		// Iterate through the expenses array
		for(let i = 0; i < expenses.length; i++)
		{
			// Since each element is an object, check to see if that object contains the expenseId
			// If the object contains the expenseId, then assign it to an index variable and exit the loop
			if(expenses[i]._id == expenseId)
			{
				index = i
				// Decrement the monthly_savings in monthTracker
				if(expenses[i].category === 'Savings')
				{
					monthTracker.monthly_savings -= expenses[i].amount
					userAccount.savings -= expenses[i].amount
					await userAccount.save()

					// Finally, remove the expense from the expenses array
					expenses.splice(index, 1)
					await monthTracker.save()
				}
				// Decrement the monthly_loan_payments in monthTracker
				else if(expenses[i].category === 'Loans')
				{
					monthTracker.monthly_loan_payments -= expenses[i].amount
					userAccount.loans += expenses[i].amount
					await userAccount.save()

					// Finally, remove the expense from the expenses array
					expenses.splice(index, 1)
					await monthTracker.save()
				}
				// Adjust monthly takehome when income transaction is removed
				else if(expenses[i].category === 'Income')
				{
					// Remove the expense from the expenses array
					monthTracker.monthlyTakeHome -= expenses[i].amount
					expenses.splice(index, 1)
					await monthTracker.save()
				} 
				else
				{
					expenses.splice(index, 1)
					await monthTracker.save()
				}
			}
		}
		// Adjust monthly_cashflow and totalExpenses when expense is deleted
		// Do not adjust totalExpenses if transaction category is 'Income'
		const expense = await Expense.findById(expenseId)

		if( expense.category !== 'Income')
		{
			monthTracker.totalExpenses -= expense.amount
		}
		monthTracker.monthly_cashflow = parseFloat(monthTracker.monthlyTakeHome) - parseFloat(monthTracker.totalExpenses)
		await monthTracker.save()

		// This deletes the expense document
		requireOwnership(req, expense)
		expense.deleteOne()

		// Adjust total cashflow in account document
		await adjustAccountTotalCashflow(req.user._id, next)

		res.sendStatus(204)
	}
	catch(err) {
		next(err)
	}
})

module.exports = router, adjustAccountTotalCashflow