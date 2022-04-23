const express = require('express')
const passport = require('passport')

const MonthTracker = require('../models/monthTracker')
const Expense = require('../models/expense')

const customErrors = require('../../lib/custom_errors')
const handle404 = customErrors.handle404
const requireOwnership = customErrors.requireOwnership

const removeBlanks = require('../../lib/remove_blank_fields')

const requireToken = passport.authenticate('bearer', {session: false})

const router = express.Router()

// INDEX -> GET /monthTrackers/:monthTrackerId/expenses
router.get('/monthTracker/:monthTrackerId/expenses', requireToken, (req, res) => {
    const monthTrackerId = req.params.monthTrackerId
    console.log('req.params.monthTrackerId: ', monthTrackerId)
    MonthTracker.findById(monthTrackerId)
        .then( monthTracker => {
            console.log('Month tracker from expese_routes: ', monthTracker)
        })
        .catch(next)
})

module.exports = router