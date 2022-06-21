// Express docs: http://expressjs.com/en/api.html
const express = require('express')
// Passport docs: http://www.passportjs.org/docs/
const passport = require('passport')

// pull in Mongoose model for examples
const MonthTracker = require('../models/monthTracker')
const Expense = require('../models/expense')
const Account = require('../models/account')

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
const { updateOne, deleteOne } = require('../models/monthTracker')
const monthTracker = require('../models/monthTracker')
const expense = require('../models/expense')
// passing this as a second argument to `router.<verb>` will make it
// so that a token MUST be passed for that route to be available
// it will also set `req.user`
const requireToken = passport.authenticate('bearer', { session: false })

// instantiate a router (mini app that only handles routes)
const router = express.Router()


// Adjust total cashflow for account document	
const adjustAccountTotalCashflow = (userId, next) => {
	Account.findOne({owner: userId})
		.populate('monthTrackers')
		.then( account => {
			let totalCashflow = 0

			for(let i = 0; i < account.monthTrackers.length; i++)
			{
				// console.log('monthTracker[i].monthly_cashflow', account.monthTrackers[i].monthly_cashflow)
				totalCashflow += account.monthTrackers[i].monthly_cashflow
				// console.log('totalcashflow: ', totalCashflow)
			}
			account.cashflow = totalCashflow
            account.save()
		})
		.catch(next)
}

// Calculate totalExpenses for monthTracker
const newTotalExpenses = (monthTracker, next) => {
	let newTotalExpenses = 0

	MonthTracker.findById(monthTracker._id)
		.populate('expenses')
		.then( monthTracker => {
			console.log('MONTHTRACKER FOR NEWTOTALEXPENSES: ', monthTracker)
			monthTracker.expenses.forEach( expense => {
				console.log('EXPENSE: ', expense)
				if( expense.category !== 'Income' )
				{
					newTotalExpenses += expense.amount
				}
			})
		})
		.catch(next)
	
	return newTotalExpenses
}

/******************* MONTHTRACKER ***********************/

// INDEX -> GET /monthTrackers - get monthTrackers only for the logged in user
router.get('/monthTrackers', requireToken, (req, res, next) => {
	const userId = req.user._id
	MonthTracker.find({owner: userId})
	.then( monthTrackers => {
		// To prevent access to a user who does not own the monthTrackers
		for(let i = 0; i < monthTrackers.length; i++)
		{
				requireOwnership(req, monthTrackers[i])
			}
			return monthTrackers
		})
		.then((monthTrackers) => {
			// `monthTrackers` will be an array of Mongoose documents
			// we want to convert each one to a POJO from BSON, so we use `.map` to
			// apply `.toObject` to each one
			return monthTrackers.map((monthTracker) => monthTracker.toObject())
		})
		// respond with status 200 and JSON of the monthTrackers
		.then((monthTrackers) => res.status(200).json({ monthTrackers: monthTrackers }))
		// if an error occurs, pass it to the handler
		.catch(next)
})

// SHOW -> GET /monthTrackers/5a7db6c74d55bc51bdf39793
router.get('/monthTrackers/:id', requireToken, (req, res, next) => {
	// req.params.id will be set based on the `:id` in the route

	MonthTracker.findById(req.params.id)
		.populate('expenses')
		.then(handle404)
		// if `findById` is succesful, respond with 200 and "monthTracker" JSON
		.then((monthTracker) => {
			requireOwnership(req, monthTracker)
			console.log('MONTHTRACKERRRRRR: ', monthTracker)
			monthTracker.save()
			// console.log('TOtal expenses', monthTracker.totalExpenses)
			res.status(200).json({ monthTracker: monthTracker.toObject() })
		})
		// Adjust total cashflow in account document when an new expense is created, updated, or deleted
		// This is placed here because you are redirected to the monthTracker show page after you create, update, or delete an expense
		.then( expense => {
			adjustAccountTotalCashflow(req.user._id, next)
			return expense
		})
		// if an error occurs, pass it to the handler
		.catch(next)
})

// CREATE -> POST /monthTrackers
router.post('/monthTrackers', requireToken, (req, res, next) => {
	// set owner, annualTakeHome, and monthlyTakeHome of new monthTracker
	console.log('req.user:', req.user)
	console.log('req.body.monthTracker:', req.body.monthTracker)
	let income
	let monthTrackerId

	Account.findOne({owner: req.user._id})
		.populate('monthTrackers')
		.then( account => {
			console.log('ACCOUNT:', account)

			income = account.income
			req.body.monthTracker.owner = req.user._id
			req.body.monthTracker.year = parseInt(req.body.monthTracker.year)
			req.body.monthTracker.annualTakeHome = income
			req.body.monthTracker.monthlyTakeHome = parseFloat(income / 12)
			req.body.monthTracker.budget = parseFloat(req.body.monthTracker.budget)
			req.body.monthTracker.monthly_cashflow = req.body.monthTracker.monthlyTakeHome
			req.body.monthTracker.totalExpenses = 0
	
			// req.body.monthTracker.expenses = account.recurrences	

			// console.log('UPDATED RECURRENCES: ', account.recurrences)
			// First, create the monthTracker
			const newMonthTracker = MonthTracker.create(req.body.monthTracker)
				.then( monthTracker => {
					console.log('NEW MONTHTRACKER: ', monthTracker)
					monthTrackerId = monthTracker._id
					console.log('MONTHTRACKER ID : ', monthTrackerId)
					// Add new monthTracker to account array monthTrackers
					account.monthTrackers.push(monthTracker._id)
					
					return monthTracker
				})
				.catch(next)

			// Second, create the Expense documents using insertMany() from the account.recurrences
			const recurringExpenses = Expense.insertMany(account.recurrences)
				.then( expenses => {
					console.log('NEW EXPENSES: ', expenses)
					return expenses
				})
				.catch(next)

			// Third, use a Promise.all() to catch the promises above
			Promise.all([recurringExpenses, newMonthTracker])
				.then( responseData => {
					console.log('RESPONSE DATA [0] - expenses: ', responseData[0])
					console.log('RESPONSE DATA [1] - monthTracker: ', responseData[1])
					const expenses = responseData[0]
					const monthTracker = responseData[1]
					console.log('MONTHTRACKER ID : ', monthTrackerId)
					// Fourth, then assign each expense the new monthTrackerId
					for(let i = 0; i < expenses.length; i++)
					{
						console.log(`EXPENSES${[i]} : `, expenses[i])
						expenses[i].monthTracker = monthTracker._id
						delete expenses[i].recurringId
						// expenses[i].updateOne({ monthTracker: monthTracker._id})
						expenses[i].save()
					}

					MonthTracker.findOne({ _id: monthTrackerId })
						// Fifth, increment loan payments. monthlyTakeHome, and savings amounts for the month
						// if any of the expenses for the monthTracker have a category of 'Savings', 'Loans', or 'Income'
						.then( monthTracker => {
							console.log('Queried MONTHTRACKER: ', monthTracker)
							for(let i = 0; i < expenses.length; i++)
							{
								if( expenses[i].category === 'Loans' )
								{
									monthTracker.monthly_loan_payments += expenses[i].amount
									// account.loans += expenses[i].amount
								}
								else if( expenses[i].category === 'Savings' )
								{
									monthTracker.monthly_savings += expenses[i].amount
								}
								else if( expenses[i].category === 'Income' )
								{
									monthTracker.monthlyTakeHome += expenses[i].amount
								}
								
							}
							// Sixth, calculate monthTracker.totalExpeses if there were any recurring expeneses, excluding expenses with an 'Income' category.
							for(let i = 0; i < expenses.length; i++)
							{
								if( expenses[i].category !== 'Income' )
								{
									monthTracker.totalExpenses += expenses[i].amount
								}
							}
							// Seventh, calculate monthly cashflow
							monthTracker.monthly_cashflow = parseFloat(monthTracker.monthlyTakeHome) - parseFloat(monthTracker.totalExpenses)
							monthTracker.save()
							console.log('UPDATED MONTHTRACKER: ', monthTracker)
							return monthTracker
						})
						// Eigth, adjust total loans payments and savings for the account document
						.then( monthTracker => {
							for(let i = 0; i < expenses.length; i++)
							{
								if( expenses[i].category === 'Loans' )
								{
									// monthTracker.monthly_loan_payments += expenses[i].amount
									account.loans -= expenses[i].amount
								}
								else if( expenses[i].category === 'Savings' )
								{
									// monthTracker.monthly_savings += expenses[i].amount
									account.savings += expenses[i].amount
								}
							}
							account.save()
						})
						.catch(next)

					return [expenses, monthTracker]
				})
				// Ninth, add the expenses with the new monthTracker's ID to its expenses array in monthTracker
				.then( response => {
					const expenses = response[0]
					const monthTracker = response[1]
					console.log('RESPONSE: ', response)

					monthTracker.expenses = expenses
					return monthTracker.save()
				})
				// Tenth, adjust total cashflow in account document
				.then( monthTracker => {
					adjustAccountTotalCashflow(req.user._id, next)
					return monthTracker.save()
				})
				.then( monthTracker => {
					res.status(201).json({ monthTracker: monthTracker.toObject() })
				})
				.catch(next)
		})
		.catch(next)
})

// UPDATE -> PATCH /monthTrackers/5a7db6c74d55bc51bdf39793
router.patch('/monthTrackers/:id', requireToken, removeBlanks, (req, res, next) => {
	// if the client attempts to change the `owner` property by including a new
	// owner, prevent that by deleting that key/value pair
	delete req.body.monthTracker.owner

	MonthTracker.findById(req.params.id)
		.populate('expenses')
		.then(handle404)
		.then((monthTracker) => {
			// pass the `req` object and the Mongoose record to `requireOwnership`
			// it will throw an error if the current user isn't the owner
			requireOwnership(req, monthTracker)
			console.log('req.body.monthtracker: ', req.body.monthTracker)
			console.log('Month Tracker: ', monthTracker)

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
			return monthTracker.updateOne(req.body.monthTracker)
		})
		// Adjust total cashflow in account document
		.then( () => {
			adjustAccountTotalCashflow(req.user._id, next)
		})
		// if that succeeded, return 204 and no JSON
		.then(() => res.sendStatus(204))
		// if an error occurs, pass it to the handler
		.catch(next)
})

// DESTROY -> DELETE /monthTrackers/5a7db6c74d55bc51bdf39793 - deletes a monthTracker along with all of its expenses
// MonthTracker will also be removed from monthTrackers array in account document
// Adjust total cashflow in account document
// Get the total of savings and loans for each monthTracker to be deleted
router.delete('/monthTrackers/:monthTrackerId', requireToken, (req, res, next) => {
	const owner = req.user._id
	const monthTrackerId = req.params.monthTrackerId

	MonthTracker.findById(monthTrackerId)
		.then(handle404)
		.then((monthTracker) => {
			// throw an error if current user doesn't own `monthTracker`
			requireOwnership(req, monthTracker)
			// Adjust total savings and total loan repayments in user's account
			Account.findOne({owner: owner})
				.then( account => {
					account.savings -= monthTracker.monthly_savings
					account.loans += monthTracker.monthly_loan_payments
					account.monthTrackers.splice(account.monthTrackers.indexOf(monthTrackerId), 1)
					return account.save()
				})
			// delete the monthTracker ONLY IF the above didn't throw
			monthTracker.deleteOne()
		})
		// Delete all expenses for the monthTracker
		.then( () => Expense.deleteMany({monthTracker: monthTrackerId}))
		// Adjust total cashflow in account document
		.then( () => {
			adjustAccountTotalCashflow(req.user._id, next)
		})
		// send back 204 and no content if the deletion succeeded
		.then(() => res.sendStatus(204))
		// if an error occurs, pass it to the handler
		.catch(next)
})

/******************* EXPENSES ***********************/

// INDEX -> GET /monthTrackers/:monthTrackerId/expenses - to display expenses array in a monthTracker
router.get('/monthTrackers/:monthTrackerId/expenses', requireToken, (req, res, next) => {
    const monthTrackerId = req.params.monthTrackerId

    MonthTracker.findById(monthTrackerId)
		.populate('expenses')
		.then(handle404)
		.then( (monthTracker) => {
			requireOwnership(req, monthTracker)
			return monthTracker.expenses
		})
		.then( (expenses) => res.status(200).json({ expenses: expenses.toObject() }) )
        .catch(next)
})

// SHOW -> GET /monthTrackers/:monthTrackerID/:expenseId - to display a single expense for a monthTracker
router.get('/monthTrackers/:monthTrackerId/:expenseId', requireToken, (req, res, next) => {
	const expenseId = req.params.expenseId

	Expense.findById(expenseId)
		.then(handle404)
		.then( expense => {
			requireOwnership(req, expense)
			res.status(200).json({ expense: expense.toObject()})
		})
		.catch(next)
})

// CREATE -> POST /monthTrackers/:monthTrackerId/expenses 
// - to create a new expense add it to the expenses array in the current monthTracker document
router.post('/monthTrackers/:monthTrackerId/expense', requireToken, (req, res, next) => {
	const monthTrackerId = req.params.monthTrackerId
	req.body.expense.owner = req.user._id
	req.body.expense.monthTracker = monthTrackerId
	req.body.expense.amount = parseFloat(req.body.expense.amount)

	console.log('REQ.BODY.EXPENSEL ', req.body.expense)
	// Create the expense
	Expense.create(req.body.expense)
		.then( expense => {
				// requireOwnership(req, expense)
				// Add the new expense to the expenses array in the current monthTracker
				MonthTracker.findById(monthTrackerId)
					.populate('expenses')
					.then( monthTracker => {
						console.log('MONTRACKER IN CREATE ROUTE: ', monthTracker)
						monthTracker.expenses.push(expense)
						// If category is 'Savings', add amount to monthly savings and total savings in account
						if(expense.category === 'Savings')
						{
							monthTracker.monthly_savings += expense.amount
							Account.findOne({owner: req.user._id})
								.then( (account) => {
									account.savings += expense.amount
									return account.save()
								})
								.catch(next)
						}
						// If category is 'Loans', add amount to monthly savings and subtract from total loans in account
						else if(expense.category === 'Loans')
						{
							monthTracker.monthly_loan_payments += expense.amount
							Account.findOne({owner: req.user._id})
								.then( (account) => {
									account.loans -= expense.amount
									return account.save()
								})
								.catch(next)
						}
						// If category is 'Income', add amount to monthly income
						else if(expense.category === 'Income')
						{
							monthTracker.monthlyTakeHome += expense.amount
						}
						// Adjust monthly cashflow and totalExpenses
						// If category is 'Income', do not add amount to total expenses
						if(expense.category !== 'Income')
						{
							monthTracker.totalExpenses += expense.amount
						}
						monthTracker.monthly_cashflow = parseFloat(monthTracker.monthlyTakeHome) - parseFloat(monthTracker.totalExpenses)
						monthTracker.save()
						return expense
					})
					.catch(next)
				// return expense object after it is added to its monthTracker expenses array
				return expense
			})
		.then( expense => {
			if(expense.recurring)
			{
				Account.findOne({owner: req.user._id})
					.then( account => {
						delete req.body.expense.monthTracker
						// Anytime you create a recurring expense assign it a custom field and random number - called it recurringID
						req.body.expense.recurringId = Math.floor(Math.random() * 1000000).toString() + req.body.expense.name 
						account.recurrences.push(req.body.expense)
						return account.save()
					})
					.catch(next)
			}
			return expense
		})
		// Adjust total cashflow in account document
		.then( expense => {
			adjustAccountTotalCashflow(req.user._id, next)
			
			return expense
		})
		.then( (expense) => res.status(201).json({ expense: expense.toObject() }) )
		.catch(next)
})

// UPDATE/PATCH -> PATCH /monthTrackers/:monthTrackerID/:expenseId - to edit a single expense for a monthTracker
// If expense is in the Savings or Loans category, then update the savings or loans in the monthTracker and accounts documents to reflect the change
// Monthly cashflow will be adjusted
router.patch('/monthTrackers/:monthTrackerId/:expenseId', requireToken, removeBlanks, (req, res, next) => {
	const monthTrackerId = req.params.monthTrackerId
	const expenseId = req.params.expenseId

	delete req.body.expense.owner

	Expense.findById(expenseId)
		.then(handle404)
		.then( (expense) => {
			requireOwnership(req, expense)
			// console.log('EXPENSE RECURRING: ', expense.recurring)
			// console.log('RED.BODY.EXPENSE.RECURRING: ', req.body.expense.recurring)
			// console.log('req.body.expense.category: ', req.body.expense.category )
			// console.log('req.body.expense.category: ', req.body.expense.category === 'Savings')
			// console.log('expense.category: ', expense.category)
			// console.log('expense.category: ', expense.category === 'Savings')
			// console.log(req.body.expense.category === 'Savings' || expense.category === 'Savings')

			// To edit an expense that is changing its category from Savings to another category, except Loans
			if(expense.category === 'Savings' && req.body.expense.category !== 'Savings' && req.body.expense.category !== 'Loans')
			{
				console.log('ONE')
				updateMonthTracker_TakeHome = MonthTracker.findById(monthTrackerId)
					.populate('expenses')
					.then( monthTracker => {
						Account.findOne({owner: req.user._id})
							.then( account => {
								// Update total savings
								return account.updateOne({ savings: account.savings - parseFloat(expense.amount)})
							})
							.catch(next)
						
						// If req.body.expense.category is 'Income'
						if(req.body.expense.category === 'Income')
						{
							// Update monthlyTakeHome
							monthTracker.monthlyTakeHome += parseFloat(req.body.expense.amount)
							monthTracker.save()
						}						
						// Update savings for month tracker
						console.log('EXPENSE.AMOUNT: ', expense.amount)	
						return monthTracker.updateOne({monthly_savings: monthTracker.monthly_savings - parseFloat(expense.amount)}) 
					})
					.catch(next)
			}
			// To edit an expense that is changing its category from Loans to another category, except Savings
			else if(expense.category === 'Loans' && req.body.expense.category !== 'Loans' && req.body.expense.category !== 'Savings')
			{
				console.log('TWO')
				MonthTracker.findById(monthTrackerId)
					.then( monthTracker => {
						Account.findOne({owner: req.user._id})
							.then( account => {
								return account.updateOne({ loans: account.loans + parseFloat(expense.amount)})
							})
							.catch(next)

						// If req.body.expense.category is 'Income'
						if(req.body.expense.category === 'Income')
						{
							// Update monthlyTakeHome
							monthTracker.monthlyTakeHome += parseFloat(req.body.expense.amount)
							monthTracker.save()
						}
						// Update loan payments for month tracker
						return monthTracker.updateOne({monthly_loan_payments: monthTracker.monthly_loan_payments - parseFloat(expense.amount)}) 
					})
					.catch(next)
			}
			// To edit an expense that is changing its category to Savings, (The previos category cannot be Loans)
			else if(expense.category !== 'Savings' && req.body.expense.category === 'Savings' && expense.category !== 'Loans')
			{
				console.log('THREE')
				MonthTracker.findById(monthTrackerId)
					.then( monthTracker => {
						Account.findOne({owner: req.user._id})
							.then( account => {
								return account.updateOne({ savings: account.savings + parseFloat(req.body.expense.amount)})
							})
							.catch(next)

						// If expense.category is 'Income'
						if(expense.category === 'Income')
						{
							// Update monthlyTakeHome
							monthTracker.monthlyTakeHome -= parseFloat(expense.amount)
							console.log('MONTHLY TAKEHOME UPDATED: ', monthTracker.monthlyTakeHome, expense.amount)
							monthTracker.save()
						}
						// Update savings for month tracker
						return monthTracker.updateOne({monthly_savings: monthTracker.monthly_savings + parseFloat(req.body.expense.amount)}) 
					})
					.catch(next)
			}
			// To edit an expense that is changing its category to Loans, (The previos category cannot be Savings)
			else if(expense.category !== 'Loans' && req.body.expense.category === 'Loans' && expense.category !== 'Savings')
			{
				console.log('FOUR')
				MonthTracker.findById(monthTrackerId)
					.then( monthTracker => {
						Account.findOne({owner: req.user._id})
							.then( account => {
								return account.updateOne({ loans: account.loans - parseFloat(req.body.expense.amount)})
							})
							.catch(next)
						
						// If expense.category is 'Income'
						if(expense.category === 'Income')
						{
							// Update monthlyTakeHome
							monthTracker.monthlyTakeHome -= parseFloat(expense.amount)
							monthTracker.save()
						}
						// Update loans for month tracker
						return monthTracker.updateOne({monthly_loan_payments: monthTracker.monthly_loan_payments + parseFloat(req.body.expense.amount)}) 
					})
					.catch(next)
			}
			// To edit an expense that is changing its category from Savings to Loans
			else if(expense.category === 'Savings' && req.body.expense.category === 'Loans')
			{
				console.log('FIVE')
				console.log('SAVINGS TO LOANS')
				MonthTracker.findById(monthTrackerId)
					.then( monthTracker => {
						Account.findOne({owner: req.user._id})
							.then( account => {
								account.loans -= parseFloat(req.body.expense.amount)
								account.savings -= parseFloat(expense.amount)
								return account.save()
							})
							.catch(next)
						monthTracker.monthly_loan_payments += parseFloat(req.body.expense.amount)
						monthTracker.monthly_savings -= parseFloat(expense.amount)
						return monthTracker.save()
					})
					.catch(next)
			}
			// To edit an expense that is changing its category from Loans to Savings
			else if(expense.category === 'Loans' && req.body.expense.category === 'Savings')
			{
				console.log('SIX')
				console.log('LOANS TO SAVINGS')
				MonthTracker.findById(monthTrackerId)
					.then( monthTracker => {
						Account.findOne({owner: req.user._id})
							.then( account => {
								account.loans += parseFloat(expense.amount)
								account.savings += parseFloat(req.body.expense.amount)
								return account.save()
							})
							.catch(next)
						monthTracker.monthly_loan_payments -= parseFloat(expense.amount)
						monthTracker.monthly_savings += parseFloat(req.body.expense.amount)
						return monthTracker.save()
					})
					.catch(next)
			}
			// To edit an expense with the current category Savings
			else if(req.body.expense.category === 'Savings' || expense.category === 'Savings')
			{
				console.log('SEVEN')
				console.log('SAVINGS UPDATED')
				console.log('EXPENSE.AMOUNT: ', expense.amount)
				const updatedSavingsExpense = parseFloat(req.body.expense.amount)
				console.log('REQ.BODY.EXPENSE.AMOUNT: ', updatedSavingsExpense)
				MonthTracker.findById(monthTrackerId)
					.then( monthTracker => {
						console.log('MONTHTRACKER SAVINGS:', monthTracker.monthly_savings)
						Account.findOne({owner: req.user._id})
							.then( account => {
									console.log('ACCOUNT:', account)
									console.log('ACCOUNT SAVINGS:', account.savings)
									if(monthTracker.monthly_savings === 0)
									{
										return account.updateOne({ savings: (account.savings + updatedSavingsExpense) })
									}
									else
									{
										return account.updateOne({ savings: (account.savings - monthTracker.monthly_savings) + (monthTracker.monthly_savings - expense.amount + updatedSavingsExpense) })
									}
								})
							.catch(next)

						if(monthTracker.monthly_savings === 0)
						{
							return monthTracker.updateOne({ monthly_savings: updatedSavingsExpense })
						}
						else
						{
							return monthTracker.updateOne({ monthly_savings: monthTracker.monthly_savings - expense.amount + updatedSavingsExpense })
						}
					})
					.catch(next)
			}
			// To edit an expense with the current category Loans
			else if(expense.category === 'Loans' || req.body.expense.category === 'Loans')
			{
				console.log('EIGHT')
				console.log('LOANS UPDATED')
				
				MonthTracker.findById(monthTrackerId)
					.then( monthTracker => {
						Account.findOne({owner: req.user._id})
							.then( account => {
								console.log('ACCOUNT LOANS:', account.loans)
								console.log('MONTHTRACKER LOAN PAYMENTS:', monthTracker.monthly_loan_payments)
								console.log('EXPENSE.AMOUNT: ', expense.amount)
								console.log('REQ.BODY.EXPENSE.AMOUNT: ', parseFloat(req.body.expense.amount))

								if(monthTracker.monthly_loan_payments === 0)
								{
									return account.updateOne({ loans: (account.loans + parseFloat(req.body.expense.amount)) })
								}
								else
								{
									return account.updateOne({ loans: (account.loans + monthTracker.monthly_loan_payments) - (monthTracker.monthly_loan_payments - expense.amount + parseFloat(req.body.expense.amount)) })
								}
							})
							.catch(next)
						
						if(monthTracker.monthly_loan_payments === 0)
						{
							return monthTracker.updateOne({ monthly_loan_payments: parseFloat(req.body.expense.amount) })
						}
						else
						{
							return monthTracker.updateOne({ monthly_loan_payments: (monthTracker.monthly_loan_payments - expense.amount + parseFloat(req.body.expense.amount)) })
						}
					})
					.catch(next)
			}
			else if( expense.category === 'Income' && req.body.expense.category === 'Income' )
			{
				console.log('NINE')
				// monthTracker.monthlyTakeHome = (monthTracker.monthlyTakeHome - expense.amount) + parseFloat(req.body.expense.amount)
				MonthTracker.findById(monthTrackerId)
					.then( monthTracker => {
						return monthTracker.updateOne({ monthlyTakeHome: (monthTracker.monthlyTakeHome - expense.amount) + parseFloat(req.body.expense.amount)})
					})
					.catch(next)
			}
			// else if(expense.category === 'Income' && req.body.expense.category === 'Income')
			return expense
		})
		.then( expense => {
			// Update the expense, setTimeout() used to solve timing issue
			setTimeout( () => {
				console.log('EXPENSE UPDATED')
				expense.name = req.body.expense.name
				expense.amount = req.body.expense.amount
				expense.category = req.body.expense.category
				return expense.save()
			}, 60)
		})
		.catch(next)
		// .then( () => {
	
	// Re-calculate totalExpenses, monthly cashflow, and total cashflow
	// setTimeout() used to solve timing issue.
	setTimeout( () => {
		MonthTracker.findById(monthTrackerId)
			.populate('expenses')
			// Re-calculate total expenses
			.then( monthTracker => {
				console.log('MONTHTRACKER AFTER TAKEHOME UPDATE: ', monthTracker)
				// Update total expenses if transaction category isn't 'Income'
				let updatedTotalExpenses = 0
				monthTracker.expenses.forEach( expense => {
					console.log('EXPENSE: ', expense)
					if(expense.category !== 'Income')
					{
						updatedTotalExpenses += parseFloat(expense.amount)
					}
				})
				monthTracker.totalExpenses = updatedTotalExpenses

				console.log('UPDATED MONTHLY-TAKEHOME: ', monthTracker.monthlyTakeHome)
				return monthTracker.save()
			})
			// Re-calculate monthly cashflow
			.then( monthTracker => {
				// Update monthly cashflow
				console.log('UPDATED MONTHLY-TAKEHOME: ', monthTracker.monthlyTakeHome)
				console.log('UPDATED TOTAL EXPENSES - MONTHTRACKER: ', monthTracker.totalExpenses)
				monthTracker.monthly_cashflow = parseFloat(monthTracker.monthlyTakeHome) - parseFloat(monthTracker.totalExpenses)
				console.log('MONTHLY CASHFLOW: ', monthTracker.monthly_cashflow)
				return monthTracker.save()
			})
			// Re-calculate total cashflow
			.then( () => {
				adjustAccountTotalCashflow(req.user._id, next)
			})
			.then ( () => res.sendStatus(204))
			.catch(next)
	}, 110 )
})

// DESTROY -> DELETE /monthTrackers/:monthTrackerID/:expenseId - to delete a single expense for a monthTracker
// The expense must be removed from the expenses array in MonthTracker and delete the expense document
// Monthly cashflow will be adjusted
router.delete('/monthTrackers/:monthTrackerId/:expenseId', requireToken, (req, res, next) => {
	const monthTrackerId = req.params.monthTrackerId
	const expenseId = req.params.expenseId

	// This removes the expense from the expenses array in monthTracker
	MonthTracker.findById(monthTrackerId)
		.populate('expenses')
		.then( (monthTracker) => {
			requireOwnership(req, monthTracker)
			const expenses = monthTracker.expenses
			console.log('monthTracker in DELETE route', monthTracker)
			console.log('expenses in DELETE route', expenses)
			console.log('expenseId', expenseId)

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
						Account.findOne({owner: req.user._id})
							.then( account => {
								account.savings -= expenses[i].amount
								return account.save()
							})
							.then( () => {
								// Finally, remove the expense from the expenses array
								expenses.splice(index, 1)
								return monthTracker.save()
							})
							.catch(next)
					}
					// Decrement the monthly_loan_payments in monthTracker
					else if(expenses[i].category === 'Loans')
					{
						monthTracker.monthly_loan_payments -= expenses[i].amount
						Account.findOne({owner: req.user._id})
							.then( account => {
								account.loans += expenses[i].amount
								return account.save()
							})
							.then( () => {
								// Finally, remove the expense from the expenses array
								expenses.splice(index, 1)
								return monthTracker.save()
							})
							.catch(next)
					}
					// Adjust monthly takehome when income transaction is removed
					else if(expenses[i].category === 'Income')
					{
						// Remove the expense from the expenses array
						monthTracker.monthlyTakeHome -= expenses[i].amount
						expenses.splice(index, 1)
						return monthTracker.save()
					} 
					else
					{
						expenses.splice(index, 1)
						return monthTracker.save()
					}
				}
			}
			return monthTracker
		})
		// Adjust monthly_cashflow and totalExpenses when expense is deleted
		// Do not adjust totalExpenses if transaction category is 'Income'
		.then( monthTracker => {
			Expense.findById(expenseId)
				.then( expense => {
					if( expense.category !== 'Income')
					{
						monthTracker.totalExpenses -= expense.amount
					}
					monthTracker.monthly_cashflow = parseFloat(monthTracker.monthlyTakeHome) - parseFloat(monthTracker.totalExpenses)

					return monthTracker.save()
				})
				.catch(next)
		})
		// This deletes the expense document
		.then( () => {
			Expense.findById(expenseId)
				.then(handle404)
				.then( (expense) => {
					requireOwnership(req, expense)
					expense.deleteOne()
				})
				.then(() => res.sendStatus(204))
				.catch(next)
		})
		// Adjust total cashflow in account document
		.then( () => {
			adjustAccountTotalCashflow(req.user._id, next)
		})
		.catch(next)

})

module.exports = router
