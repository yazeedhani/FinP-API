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
// passing this as a second argument to `router.<verb>` will make it
// so that a token MUST be passed for that route to be available
// it will also set `req.user`
const requireToken = passport.authenticate('bearer', { session: false })

// instantiate a router (mini app that only handles routes)
const router = express.Router()

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
			// console.log('TOtal expenses', monthTracker.totalExpenses)
			res.status(200).json({ monthTracker: monthTracker.toObject() })
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
	const monthTrackerRecurringExpenses = []
	let updatedRecurrences
	Account.findOne({owner: req.user._id})
		.then( account => {
			console.log('ACCOUNT:', account)

			income = account.income
			req.body.monthTracker.owner = req.user._id
			req.body.monthTracker.year = parseInt(req.body.monthTracker.year)
			req.body.monthTracker.annualTakeHome = income
			req.body.monthTracker.monthlyTakeHome = parseFloat(income / 12)
			req.body.monthTracker.budget = parseFloat(req.body.monthTracker.budget)
			// req.body.monthTracker.expenses = account.recurrences	
			
			
			
			// updatedRecurrences = account.recurrences.map( recurrence => {
			// 	return recurrence.monthTracker = monthTrackerId
			// })

			// console.log('UPDATED RECURRENCES: ', account.recurrences)
			// First, create the monthTracker
			const newMonthTracker = MonthTracker.create(req.body.monthTracker)
				.then( monthTracker => {
					console.log('NEW MONTHTRACKER: ', monthTracker)
					monthTrackerId = monthTracker._id
					console.log('MONTHTRACKER ID : ', monthTrackerId)
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

					// Fourth, then assign each expense the new monthTrackerId
					for(let i = 0; i < expenses.length; i++)
					{
						console.log(`EXPENSES${[i]} : `, expenses[i])
						expenses[i].monthTracker = monthTracker._id
						// expenses[i].updateOne({ monthTracker: monthTracker._id})
						expenses[i].save()
					}

					console.log('UPDATED EXPENSES: ', expenses)

					return [expenses, monthTracker]
				})
				// Fifth, add the expenses with the new monthTracker's ID to its expenses array in monthTracker
				.then( response => {
					const expenses = response[0]
					const monthTracker = response[1]
					console.log('RESPONSE: ', response)
					// console.log('monthTracker.updateOne({ expenses: expenses}) :', monthTracker.updateOne({ expenses: expenses}))
					// return monthTracker.updateOne({ expenses: expenses})
					monthTracker.expenses = expenses
					return monthTracker.save()
				})
				.then( monthTracker => {
					res.status(201).json({ monthTracker: monthTracker.toObject() })
				})
				.catch(next)

			// MonthTracker.create(req.body.monthTracker)
			// 	.then( monthTracker => {
			// 		// First, add a monthTracker ID to each object in account.recurrences array
			// 		// Second, create Expense documents using the expense objects in the account.recurrences array
			// 		// When creating each Expense document, give each a monthTrackerID

			// 		// First, loop through account.recurrences and assign each expense the current monthTrackerID
			// 		// Second, 
			// 		monthTrackerId = monthTracker._id
			// 		// console.log('monthTracker: ', monthTrackerId)
			// 		for(let i = 0; i < account.recurrences.length; i++)
			// 		{	
			// 			// console.log('ACCOUNT.RECURRENCES[i] : ', account.recurrences[i])
			// 			// account.recurrences[i].monthTracker = monthTracker._id					
			// 			Expense.create(account.recurrences[i])
			// 				.then( recurringExpense => {
			// 					// req.body.monthTracker.expenses = recurringExpenses
			// 					recurringExpense.monthTracker = monthTracker._id
								
			// 					console.log('RECURRING EXPENSE: ', recurringExpense)
			// 					// monthTracker.expenses.push(recurringExpense)
			// 					// monthTracker.updateOne({ $push: { expenses : recurringExpense }})
			// 					// console.log('MONTHTRACKER: ', monthTracker)
			// 					return recurringExpense.save()
			// 				})
			// 				.then( recurringExpense => {
			// 					console.log('PUSH EXPENSE')
			// 					monthTrackerRecurringExpenses.push(recurringExpense)
			// 					console.log('monthTrackerRecurringExpenses: ', monthTrackerRecurringExpenses)
			// 				})
			// 				// .then( (recurringExpense) => {
			// 				// 	monthTracker.updateOne({ $push: { expenses : recurringExpense }})
			// 				// 	return monthTracker.save()
			// 				// })
			// 				// monthTracker.save()
			// 				.catch(next)
			// 		}
			// 		return monthTracker
			// 	})
			// 	.then( monthTracker => {
			// 		MonthTracker.findById(monthTrackerId)
			// 			.then( monthTracker => {
			// 				console.log('MONTHTRACKER EXPENSES: ', monthTracker)
			// 				monthTracker.expenses = [...monthTracker.expenses, ...monthTrackerRecurringExpenses]
			// 				return monthTracker.save()
			// 			})
			// 			.then((monthTracker) => {
			// 				res.status(201).json({ monthTracker: monthTracker.toObject() })
			// 			})
			// 			.catch(next)
			// 	})


				// .then( monthTracker => {
				// 	MonthTracker.findById(monthTrackerId)
				// 		.then( monthTracker => {
				// 			console.log('MONTHTRACKER EXPENSES: ', monthTracker)
				// 			monthTracker.expenses = [...monthTracker.expenses, ...monthTrackerRecurringExpenses]
				// 			return monthTracker.save()
				// 		})
				// 		.then((monthTracker) => {
				// 			res.status(201).json({ monthTracker: monthTracker.toObject() })
				// 		})
				// 		.catch(next)
				// })
				// .then( monthTracker => {
				// 	MonthTracker.findByIdAndUpdate(monthTracker._id, monthTrackerRecurringExpenses)
				// 		.then( monthTracker => {
				// 			console.log('MONTHTRACKER UPDATED EXPENSES: ', monthTracker)
				// 		})
				// 		.catch(next)
				// 	return monthTracker
				// })
				// respond to succesful `create` with status 201 and JSON of new "monthTracker"
				// .then((monthTracker) => {
				// 	res.status(201).json({ monthTracker: monthTracker.toObject() })
				// })
				// if an error occurs, pass it off to our error handler
				// the error handler needs the error message and the `res` object so that it
				// can send an error message back to the client

				
				// .catch(next)
				})

			// MonthTracker.create(req.body.monthTracker)
			// 	// respond to succesful `create` with status 201 and JSON of new "monthTracker"
			// 	.then((monthTracker) => {
			// 		res.status(201).json({ monthTracker: monthTracker.toObject() })
			// 	})
			// 	// if an error occurs, pass it off to our error handler
			// 	// the error handler needs the error message and the `res` object so that it
			// 	// can send an error message back to the client
			// 	.catch(next)
			// 	})
		.catch(next)
})

// UPDATE -> PATCH /monthTrackers/5a7db6c74d55bc51bdf39793
router.patch('/monthTrackers/:id', requireToken, removeBlanks, (req, res, next) => {
	// if the client attempts to change the `owner` property by including a new
	// owner, prevent that by deleting that key/value pair
	delete req.body.monthTracker.owner
	req.body.monthTracker.monthlyTakeHome = req.body.monthTracker.annualTakeHome / 12

	MonthTracker.findById(req.params.id)
		.then(handle404)
		.then((monthTracker) => {
			// pass the `req` object and the Mongoose record to `requireOwnership`
			// it will throw an error if the current user isn't the owner
			requireOwnership(req, monthTracker)
			console.log('req.body.monthtracker: ', req.body.monthTracker)
			console.log('Month Tracker: ', monthTracker)
			// pass the result of Mongoose's `.update` to the next `.then`
			return monthTracker.updateOne(req.body.monthTracker)
		})
		// if that succeeded, return 204 and no JSON
		.then(() => res.sendStatus(204))
		// if an error occurs, pass it to the handler
		.catch(next)
})

// DESTROY -> DELETE /monthTrackers/5a7db6c74d55bc51bdf39793 - deletes a monthTracker along with all of its expenses
router.delete('/monthTrackers/:monthTrackerId', requireToken, (req, res, next) => {
	const owner = req.user._id
	const monthTrackerId = req.params.monthTrackerId
	MonthTracker.findById(monthTrackerId)
		.then(handle404)
		.then((monthTracker) => {
			// throw an error if current user doesn't own `monthTracker`
			requireOwnership(req, monthTracker)
			// delete the monthTracker ONLY IF the above didn't throw
			monthTracker.deleteOne()
		})
		.then( () => Expense.deleteMany({monthTracker: monthTrackerId}))
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
					.then( monthTracker => {
						monthTracker.expenses.push(expense)
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
						account.recurrences.push(req.body.expense)
						return account.save()
					})
					.catch(next)
			}
			return expense
		})
		// .then( expense => {
		// 	if(expense.recurring)
		// 	{
		// 		Account.findOne({owner: req.user._id})
		// 			.then( account => {
		// 				account.recurrences.push(expense)
		// 				return account.save()
		// 			})
		// 			.catch(next)
		// 	}
		// 	return expense
		// })
		.then( (expense) => res.status(201).json({ expense: expense.toObject() }) )
		.catch(next)
})

// UPDATE/PATCH -> PATCH /monthTrackers/:monthTrackerID/:expenseId - to edit a single expense for a monthTracker
// If expense is in the Savings category, then update the savings in the monthTracker and accounts documents to reflect the change
router.patch('/monthTrackers/:monthTrackerId/:expenseId', requireToken, removeBlanks, (req, res, next) => {
	const monthTrackerId = req.params.monthTrackerId
	const expenseId = req.params.expenseId

	delete req.body.expense.owner

	Expense.findById(expenseId)
		.then(handle404)
		.then( (expense) => {
			requireOwnership(req, expense)
			console.log('EXPENSE RECURRING: ', expense.recurring)
			console.log('RED.BODY.EXPENSE.RECURRING: ', req.body.expense.recurring)
			// if(!expense.recurring || expense.recurring === true)
			if(req.body.expense.recurring === true)
			{
				Account.findOne({owner: req.user._id})
					.then( account => {
						if( !account.recurrences.includes(req.body.expense._id) )
						{
							account.recurrences.push(expense)
							return account.save()
						}
					})
					.catch(next)
			}
			else
			{
				Account.findOne({owner: req.user._id})
					.then( account => {
						const expenseIndex = account.recurrences.indexOf(expense._id)
						account.recurrences.splice(expenseIndex, 1)
						return account.save()
					})
					.catch(next)
			}

			if(expense.category === 'Savings')
			{
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
									return account.updateOne({ savings: (account.savings - monthTracker.monthly_savings) + (monthTracker.monthly_savings - expense.amount + updatedSavingsExpense) })
								})
							.catch(next)
						return monthTracker.updateOne({ monthly_savings: monthTracker.monthly_savings - expense.amount + updatedSavingsExpense })
					})
					.catch(next)
			}
			else if(expense.category === 'Loans')
			{
				console.log('LOANS UPDATED')
				
				MonthTracker.findById(monthTrackerId)
					.then( monthTracker => {
						Account.findOne({owner: req.user._id})
							.then( account => {
								console.log('ACCOUNT LOANS:', account.loans)
								console.log('MONTHTRACKER LOAN PAYMENTS:', monthTracker.monthly_loan_payments)
								console.log('EXPENSE.AMOUNT: ', expense.amount)
								console.log('REQ.BODY.EXPENSE.AMOUNT: ', parseFloat(req.body.expense.amount))
								return account.updateOne({ loans: (account.loans + monthTracker.monthly_loan_payments) - (monthTracker.monthly_loan_payments - expense.amount + parseFloat(req.body.expense.amount)) })
							})
							.catch(next)
						return monthTracker.updateOne({ monthly_loan_payments: (monthTracker.monthly_loan_payments - expense.amount + parseFloat(req.body.expense.amount)) })
					})
					.catch(next)
			}
			return expense.updateOne(req.body.expense)
		})
		// .then( (expense) => {
		// 	console.log('EXPENSE: ', expense)
		// 	if(expense.recurring)
		// 	{
		// 		Account.findOne({owner: req.user._id})
		// 			.then( account => {
		// 				account.recurrences.push(expense)
		// 				return account.save()
		// 			})
		// 			.catch(next)
		// 	}
		// 	return expense
		// })
		.then ( () => res.sendStatus(204))
		.catch(next)
})

// DESTROY -> DELETE /monthTrackers/:monthTrackerID/:expenseId - to delete a single expense for a monthTracker
// The expense must be removed from the expenses array in MonthTracker and delete the expense document
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
					if(expenses[i].category === 'Savings')
					{
						// Decrement the monthly_savings in monthTracker
						monthTracker.monthly_savings -= expenses[i].amount
						Account.findOne({owner: req.user._id})
							.then( account => {
								console.log('ACCOUNT: ', account)
								console.log('I : ', i)
								console.log('EXPENSE: ', expenses)
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
					else if(expenses[i].category === 'Loans')
					{
						// Decrement the monthly_savings in monthTracker
						monthTracker.monthly_loan_payments -= expenses[i].amount
						Account.findOne({owner: req.user._id})
							.then( account => {
								console.log('ACCOUNT: ', account)
								console.log('I : ', i)
								console.log('EXPENSE: ', expenses)
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
					else
					{
						expenses.splice(index, 1)
						return monthTracker.save()
					}
					
				}
			}
		})
		.then( () => {
			// This deletes the expense document
			Expense.findById(expenseId)
				.then(handle404)
				.then( (expense) => {
					requireOwnership(req, expense)
					expense.deleteOne()
				})
				.then(() => res.sendStatus(204))
				.catch(next)
		})
		.catch(next)

})

module.exports = router
