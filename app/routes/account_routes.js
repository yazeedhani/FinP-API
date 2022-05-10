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
router.get('/account/:userId', requireToken, (req, res, next) => {
    const loggedInUserId = req.params.userId

    Account.findOne({owner: loggedInUserId})
        .populate('recurrences')
        .then(handle404)
        .then( account => {
            requireOwnership(req, account)
            console.log('ACCOUNT: ', account)
            res.status(200).json({ account: account.toObject() })
        })
})

// UPDATE -> PATCH /account/avklakt0909fa09f0a9ra09 - update the logged in user's annual income and loans
router.patch('/account/:userId', requireToken, removeBlanks, (req, res, next) => {
    const loggedInUserId = req.params.userId

    Account.findOneAndUpdate({owner: loggedInUserId}, {income: req.body.account.income, loans: req.body.account.loans})
        .then(() => res.sendStatus(204))
        .catch(next)
})

// DESTROY -> DELETE /account/avklakt0909fa09f0a9ra09/ahdbgkeidnajka172839 - remove a recurring expense from recurrences array
router.delete('/account/:userId/:recurringId', requireToken, (req, res, next) => {
    const loggedInUserId = req.params.userId
    const recurringId = req.params.recurringId
    
    // Anytime you create a recurring expense assign it a custom field and random number - called it recurringID

    Account.findOne({owner: loggedInUserId})
        // .populate('recurrences')
        .then( account => {
            requireOwnership(req, account)
            let expenseIndex
            // const expenseIndex = account.recurrences.indexOf(recurringId)
            account.recurrences.forEach( (recurrence, index) => {
                if(recurrence.recurringId === recurringId)
                {
                    expenseIndex = index
                }
            })
            console.log('EXPENSE._ID:', recurringId)
            console.log('EXPENSE INDEX: ', expenseIndex)
            console.log('account.recurrences.indexOf(expenseId): ', account.recurrences.indexOf(recurringId))
            console.log('account.recurrences: ', account.recurrences)
            account.recurrences.splice(expenseIndex, 1)

            delete account.recurrences[expenseIndex]

            // Expense.findOne({recurringId: recurringId})
            //     .then( expense => {
            //         return expense.updateOne({ recurring: false })
            //     })
            //     .catch(next)

            return account.save()
        })
        .then(() => res.sendStatus(204))
        .catch(next)
})

module.exports = router