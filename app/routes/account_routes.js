const express = require('express')
const passport =  require('passport')

const Account = require('../models/account')

const customErrors = require('../../lib/custom_errors')
const handle404 = customErrors.handle404
const requireOwnership = customErrors.requireOwnership

const removeBlanks = require('../../lib/remove_blank_fields')

const requireToken = passport.authenticate('bearer', {session: false})

const router = express.Router()

// SHOW -> GET /account/avklakt0909fa09f0a9ra09 - gets the account for the logged in user
router.get('/account/:userId', requireToken, (req, res, next) => {
    const loggedInUserId = req.params.userId

    Account.findOne({owner: loggedInUserId})
        .then(handle404)
        .then( account => {
            requireOwnership(req, account)
            res.status(200).json({ account: account.toObject() })
        })
})

// UPDATE -> PATCH /account/avklakt0909fa09f0a9ra09 - update the logged in user's annual income
router.patch('/account/:userId', requireToken, (req, res, next) => {
    const loggedInUserId = req.params.userId
    
    Account.findOneAndUpdate({owner: loggedInUserId}, {income: req.body.account.income})
        .then(() => res.sendStatus(204))
        .catch(next)
})

module.exports = router