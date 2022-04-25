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

// INDEX
// GET /monthTrackers - get monthTrackers only for the logged in user
router.get('/monthTrackers', requireToken, (req, res, next) => {
	const userId = req.user._id
	MonthTracker.find({owner: userId})
		// To prevent access to a user who does not own the monthTrackers
		.then( monthTrackers => {
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

// SHOW
// GET /monthTrackers/5a7db6c74d55bc51bdf39793
router.get('/monthTrackers/:id', requireToken, (req, res, next) => {
	// req.params.id will be set based on the `:id` in the route
	MonthTracker.findById(req.params.id)
		.then(handle404)
		// if `findById` is succesful, respond with 200 and "monthTracker" JSON
		.then((monthTracker) => {
			requireOwnership(req, monthTracker)
			res.status(200).json({ monthTracker: monthTracker.toObject() })
		})
		// if an error occurs, pass it to the handler
		.catch(next)
})

// CREATE
// POST /monthTrackers
router.post('/monthTrackers', requireToken, (req, res, next) => {
	// set owner, annualTakeHome, and monthlyTakeHome of new monthTracker to be current user
	console.log('req.user:', req.user)
	console.log('req.body.monthTracker:', req.body.monthTracker)
	req.body.monthTracker.owner = req.user._id
	req.body.monthTracker.annualTakeHome = req.user.income
	req.body.monthTracker.monthlyTakeHome = req.user.income / 12

	MonthTracker.create(req.body.monthTracker)
		// respond to succesful `create` with status 201 and JSON of new "monthTracker"
		.then((monthTracker) => {
			res.status(201).json({ monthTracker: monthTracker.toObject() })
		})
		// if an error occurs, pass it off to our error handler
		// the error handler needs the error message and the `res` object so that it
		// can send an error message back to the client
		.catch(next)
})

// UPDATE
// PATCH /monthTrackers/5a7db6c74d55bc51bdf39793
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

// DESTROY
// DELETE /monthTrackers/5a7db6c74d55bc51bdf39793 - deletes a monthTracker along with all of its expenses
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
 
/***** EXPENSE CATEGORIES *****/

// INDEX - Category: Entertainment -> GET /monthTrackers/:monthTrackerId/expenses/entertainment 
// - To display expenses in the entertainment category ONLY in a monthTracker
router.get('/monthTrackers/:monthTrackerId/expenses/entertainment', requireToken, (req, res, next) => {
    const monthTrackerId = req.params.monthTrackerId

    MonthTracker.findById(monthTrackerId)
		.populate('expenses')
		.then(handle404)
		.then( (monthTracker) => {
			requireOwnership(req, monthTracker)
			return monthTracker.expenses
		})
		.then( (expenses) => {
			entertainmentExpenses = expenses.filter(expense => {
				return expense.category === 'Entertainment'
			})
			return entertainmentExpenses
		})
		.then( (expenses) => res.status(200).json({ expenses: expenses }) )
        .catch(next)
})

// INDEX - Category: Housing -> GET /monthTrackers/:monthTrackerId/expenses/housing 
// - To display expenses in the housing category ONLY in a monthTracker
router.get('/monthTrackers/:monthTrackerId/expenses/housing', requireToken, (req, res, next) => {
    const monthTrackerId = req.params.monthTrackerId

    MonthTracker.findById(monthTrackerId)
		.populate('expenses')
		.then(handle404)
		.then( (monthTracker) => {
			requireOwnership(req, monthTracker)
			return monthTracker.expenses
		})
		.then( (expenses) => {
			entertainmentExpenses = expenses.filter(expense => {
				return expense.category === 'Housing'
			})
			return entertainmentExpenses
		})
		.then( (expenses) => res.status(200).json({ expenses: expenses }) )
        .catch(next)
})

// INDEX - Category: Food -> GET /monthTrackers/:monthTrackerId/expenses/food 
// - To display expenses in the food category ONLY in a monthTracker
router.get('/monthTrackers/:monthTrackerId/expenses/housing', requireToken, (req, res, next) => {
    const monthTrackerId = req.params.monthTrackerId

    MonthTracker.findById(monthTrackerId)
		.populate('expenses')
		.then(handle404)
		.then( (monthTracker) => {
			requireOwnership(req, monthTracker)
			return monthTracker.expenses
		})
		.then( (expenses) => {
			entertainmentExpenses = expenses.filter(expense => {
				return expense.category === 'Food'
			})
			return entertainmentExpenses
		})
		.then( (expenses) => res.status(200).json({ expenses: expenses }) )
        .catch(next)
})

// INDEX - Category: Auto -> GET /monthTrackers/:monthTrackerId/expenses/auto 
// - To display expenses in the food category ONLY in a monthTracker
router.get('/monthTrackers/:monthTrackerId/expenses/housing', requireToken, (req, res, next) => {
    const monthTrackerId = req.params.monthTrackerId

    MonthTracker.findById(monthTrackerId)
		.populate('expenses')
		.then(handle404)
		.then( (monthTracker) => {
			requireOwnership(req, monthTracker)
			return monthTracker.expenses
		})
		.then( (expenses) => {
			entertainmentExpenses = expenses.filter(expense => {
				return expense.category === 'Auto'
			})
			return entertainmentExpenses
		})
		.then( (expenses) => res.status(200).json({ expenses: expenses }) )
        .catch(next)
})

// INDEX - Category: Health -> GET /monthTrackers/:monthTrackerId/expenses/health 
// - To display health in the food category ONLY in a monthTracker
router.get('/monthTrackers/:monthTrackerId/expenses/housing', requireToken, (req, res, next) => {
    const monthTrackerId = req.params.monthTrackerId

    MonthTracker.findById(monthTrackerId)
		.populate('expenses')
		.then(handle404)
		.then( (monthTracker) => {
			requireOwnership(req, monthTracker)
			return monthTracker.expenses
		})
		.then( (expenses) => {
			entertainmentExpenses = expenses.filter(expense => {
				return expense.category === 'Health'
			})
			return entertainmentExpenses
		})
		.then( (expenses) => res.status(200).json({ expenses: expenses }) )
        .catch(next)
})

// INDEX - Category: Shopping -> GET /monthTrackers/:monthTrackerId/expenses/shopping 
// - To display health in the shopping category ONLY in a monthTracker
router.get('/monthTrackers/:monthTrackerId/expenses/shopping', requireToken, (req, res, next) => {
    const monthTrackerId = req.params.monthTrackerId

    MonthTracker.findById(monthTrackerId)
		.populate('expenses')
		.then(handle404)
		.then( (monthTracker) => {
			requireOwnership(req, monthTracker)
			return monthTracker.expenses
		})
		.then( (expenses) => {
			entertainmentExpenses = expenses.filter(expense => {
				return expense.category === 'Shopping'
			})
			return entertainmentExpenses
		})
		.then( (expenses) => res.status(200).json({ expenses: expenses }) )
        .catch(next)
})

// INDEX - Category: Restaurant -> GET /monthTrackers/:monthTrackerId/expenses/restaurant 
// - To display restaurant in the shopping category ONLY in a monthTracker
router.get('/monthTrackers/:monthTrackerId/expenses/shopping', requireToken, (req, res, next) => {
    const monthTrackerId = req.params.monthTrackerId

    MonthTracker.findById(monthTrackerId)
		.populate('expenses')
		.then(handle404)
		.then( (monthTracker) => {
			requireOwnership(req, monthTracker)
			return monthTracker.expenses
		})
		.then( (expenses) => {
			entertainmentExpenses = expenses.filter(expense => {
				return expense.category === 'Restaurant'
			})
			return entertainmentExpenses
		})
		.then( (expenses) => res.status(200).json({ expenses: expenses }) )
        .catch(next)
})

// INDEX - Category: Loans -> GET /monthTrackers/:monthTrackerId/expenses/Loans 
// - To display loans in the shopping category ONLY in a monthTracker
router.get('/monthTrackers/:monthTrackerId/expenses/loans', requireToken, (req, res, next) => {
    const monthTrackerId = req.params.monthTrackerId

    MonthTracker.findById(monthTrackerId)
		.populate('expenses')
		.then(handle404)
		.then( (monthTracker) => {
			requireOwnership(req, monthTracker)
			return monthTracker.expenses
		})
		.then( (expenses) => {
			entertainmentExpenses = expenses.filter(expense => {
				return expense.category === 'Loans'
			})
			return entertainmentExpenses
		})
		.then( (expenses) => res.status(200).json({ expenses: expenses }) )
        .catch(next)
})

// INDEX - Category: Other -> GET /monthTrackers/:monthTrackerId/expenses/other 
// - To display other in the shopping category ONLY in a monthTracker
router.get('/monthTrackers/:monthTrackerId/expenses/shopping', requireToken, (req, res, next) => {
    const monthTrackerId = req.params.monthTrackerId

    MonthTracker.findById(monthTrackerId)
		.populate('expenses')
		.then(handle404)
		.then( (monthTracker) => {
			requireOwnership(req, monthTracker)
			return monthTracker.expenses
		})
		.then( (expenses) => {
			entertainmentExpenses = expenses.filter(expense => {
				return expense.category === 'Other'
			})
			return entertainmentExpenses
		})
		.then( (expenses) => res.status(200).json({ expenses: expenses }) )
        .catch(next)
})

/***********************/

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

// CREATE -> POST /monthTrackers/:monthTrackerId/expenses - to add an expense to the expenses array in a monthTracker
router.post('/monthTrackers/:monthTrackerId/expenses', requireToken, (req, res, next) => {
	const monthTrackerId = req.params.monthTrackerId
	req.body.expense.owner = req.user._id
	req.body.expense.monthTracker = monthTrackerId
	// Create the expense
	Expense.create(req.body.expense)
		.then( expense => {
			// Add the new expense to its monthTracker
			MonthTracker.findById(monthTrackerId)
			.then( monthTracker => {
				// console.log('EXPENSES: ', monthTracker)
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
				monthTracker.save()
				return expense
			})
			.catch(next)
			// return expense object after it is added to its monthTracker
			return expense
		})
		.then( (expense) => res.status(201).json({ expense: expense.toObject() }) )
		.catch(next)
})

// UPDATE/PATCH -> PATCH /monthTrackers/:monthTrackerID/:expenseId - to edit a single expense for a monthTracker
router.patch('/monthTrackers/:monthTrackerId/:expenseId', requireToken, removeBlanks, (req, res, next) => {
	const monthTrackerId = req.params.monthTrackerId
	const expenseId = req.params.expenseId

	delete req.body.expense.owner

	Expense.findById(expenseId)
		.then(handle404)
		.then( (expense) => {
			requireOwnership(req, expense)
			return expense.updateOne(req.body.expense)
		})
		.then ( () => res.sendStatus(204))
		.catch(next)
})

// DESTROY -> DELETE /monthTrackers/:monthTrackerID/:expenseId - to delete a single expense for a monthTracker
// The expense must be removed from the expenses array in MonthTracker and delete the expense 
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
					// Finally, remove the expense from the expenses array
					expenses.splice(index, 1)
					return monthTracker.save()
				}
			}
		})
		.then( () => {
			// This deletes the expense
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

/******************* SAVINGS ***********************/
// INDEX -> GET /monthTrackers/:monthTrackerId/savings - to display expenses array in a monthTracker
// router.get('/monthTrackers/:monthTrackerId/savings', requireToken, (req, res, next) => {
//     const monthTrackerId = req.params.monthTrackerId

//     MonthTracker.findById(monthTrackerId)
// 		.then(handle404)
// 		.then( (monthTracker) => {
// 			requireOwnership(req, monthTracker)
// 			return monthTracker.expenses
// 		})
// 		.then( (expenses) => res.status(200).json({ expenses: expenses.toObject() }) )
//         .catch(next)
// })

module.exports = router
