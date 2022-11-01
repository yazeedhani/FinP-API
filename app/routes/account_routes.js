const express = require('express')
const passport =  require('passport')

const Account = require('../models/account')

const customErrors = require('../../lib/custom_errors')
const handle404 = customErrors.handle404
const requireOwnership = customErrors.requireOwnership

const removeBlanks = require('../../lib/remove_blank_fields')
const user = require('../models/user')

const requireToken = passport.authenticate('bearer', {session: false})

const router = express.Router()

// SHOW -> GET /account/avklakt0909fa09f0a9ra09 - gets the account for the logged in user
router.get('/account/:userId', requireToken, async (req, res, next) => {
    try {
        const loggedInUserId = req.params.userId
        const userAccount = await Account.findOne({owner: loggedInUserId}).populate('recurrences').populate('monthTrackers')
        await handle404(userAccount)
        await requireOwnership(req, userAccount)
        res.status(200).json({ account: userAccount.toObject() })   
    }
    catch(err) {
        next(err)
    }
})

// CREATE -> POST /account/avklakt0909fa09f0a9ra09 - create a recurring expense
router.post('/account/:userId', requireToken, async (req, res, next) => {
    try {
        const loggedInUserId = req.params.userId
        const userAccount = await Account.findOne({owner: loggedInUserId})
        await handle404(userAccount)
        req.body.recurringTransaction.recurring = true
        req.body.recurringTransaction.owner = req.user._id
        // Anytime you create a recurring expense assign it a custom field and random number - called it recurringID
		req.body.recurringTransaction.recurringId = Math.floor(Math.random() * 1000000).toString() + req.body.recurringTransaction.name 
        console.log('Req.body.expense:', req.body.recurringTransaction)

        userAccount.recurrences.push(req.body.recurringTransaction)
        await userAccount.save()

        res.sendStatus(201)
    }
    catch(err) {
        next(err)
    }
})

// UPDATE -> PATCH /account/avklakt0909fa09f0a9ra09/recurringTrans/:transId - update a recurring transaction
router.patch('/account/:userId/recurringTrans/:transId', requireToken, async (req, res, next) => {
    try {
        const loggedInUserId = req.params.userId
        const recurringTransId = req.params.transId

        // Fetch recurring transactions in userAccount - returns an object
        const userAccountRecurrences = await Account.findOne({owner: loggedInUserId})
        await handle404(userAccountRecurrences)
        await requireOwnership(req, userAccountRecurrences)
        // // Update recurring transaction
        const recurringTransaction = userAccountRecurrences.recurrences.find( recurrence => recurrence.recurringId === recurringTransId)
        recurringTransaction.name = req.body.recurringTransaction.name
        recurringTransaction.category = req.body.recurringTransaction.category
        recurringTransaction.amount = req.body.recurringTransaction.amount

        userAccountRecurrences.markModified('recurrences');
        await userAccountRecurrences.save()
        res.sendStatus(204)
    }
    catch(err) {
        next(err)
    }
})

// UPDATE -> PATCH /account/avklakt0909fa09f0a9ra09 - update the logged in user's annual income and loans
router.patch('/account/:userId', requireToken, removeBlanks, async (req, res, next) => {
    try {
        const loggedInUserId = req.params.userId
        const userAccount = await Account.findOne({owner: loggedInUserId})
        await handle404(userAccount)
        await requireOwnership(req, userAccount)
        userAccount.income = req.body.account.income
        userAccount.loans = req.body.account.loans
        
        await userAccount.save()
        res.sendStatus(204)
    }
    catch(err) {
        next(err)
    }
})

// DESTROY -> DELETE /account/avklakt0909fa09f0a9ra09/ahdbgkeidnajka172839 - remove a recurring expense from recurrences array
router.delete('/account/:userId/:recurringId', requireToken, async (req, res, next) => {
    try {
        const loggedInUserId = req.params.userId
        const recurringId = req.params.recurringId

        const userAccount = await Account.findOne({owner: loggedInUserId})
        await handle404(userAccount)
        await requireOwnership(req, userAccount)
        let expenseIndex
        // const expenseIndex = account.recurrences.indexOf(recurringId)
        userAccount.recurrences.forEach( (recurrence, index) => {
            if(recurrence.recurringId === recurringId)
            {
                expenseIndex = index
            }
        })
        userAccount.recurrences.splice(expenseIndex, 1)

        await userAccount.save()
        res.sendStatus(204)
    }
    catch(err) {
        next(err)
    }
})

module.exports = router