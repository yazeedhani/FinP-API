const express = require('express')
const passport =  require('passport')

const Account = require('../models/account')
const Expense = require('../models/expense')

const customErrors = require('../../lib/custom_errors')
const handle404 = customErrors.handle404
const requireOwnership = customErrors.requireOwnership

const removeBlanks = require('../../lib/remove_blank_fields')
const expense = require('../models/expense')

const requireToken = passport.authenticate('bearer', {session: false})

const router = express.Router()

// SHOW -> GET /account/avklakt0909fa09f0a9ra09 - gets the account for the logged in user
router.get('/account/:userId', requireToken, async (req, res, next) => {
    try {
        const loggedInUserId = req.params.userId
        const userAccount = await Account.findOne({owner: loggedInUserId}).populate('recurrences').populate('monthTrackers')
        await handle404(userAccount)
        requireOwnership(req, userAccount)
        res.status(200).json({ account: userAccount.toObject() })   
    }
    catch(err) {
        next(err)
    }
})

// UPDATE -> PATCH /account/avklakt0909fa09f0a9ra09 - update the logged in user's annual income and loans
router.patch('/account/:userId', requireToken, removeBlanks, async (req, res, next) => {
    try {
        const loggedInUserId = req.params.userId
        await Account.findOneAndUpdate({owner: loggedInUserId}, {income: req.body.account.income, loans: req.body.account.loans})
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
        requireOwnership(req, userAccount)
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