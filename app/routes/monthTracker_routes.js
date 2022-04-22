// Express docs: http://expressjs.com/en/api.html
const express = require('express')
// Passport docs: http://www.passportjs.org/docs/
const passport = require('passport')

// pull in Mongoose model for examples
const MonthTracker = require('../models/monthTracker')
const User = require('../models/user')

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

// INDEX
// GET /monthTrackers
router.get('/monthTrackers', requireToken, (req, res, next) => {
	MonthTracker.find()
		.then((monthTrackers) => {
			// `monthTrackers` will be an array of Mongoose documents
			// we want to convert each one to a POJO, so we use `.map` to
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
		.then((monthTracker) => res.status(200).json({ monthTracker: monthTracker.toObject() }))
		// if an error occurs, pass it to the handler
		.catch(next)
})

// CREATE
// POST /monthTrackers
router.post('/monthTrackers', requireToken, (req, res, next) => {
	// set owner of new example to be current user
	console.log('req.user:', req.user)
	console.log('req.body.monthTracker:', req.body.monthTracker)
	req.body.monthTracker.owner = req.user._id
	req.body.monthTracker.annualTakeHome = req.user.income
	req.body.monthTracker.monthlyTakeHome = req.user.income / 12

	MonthTracker.create(req.body.monthTracker)
		// respond to succesful `create` with status 201 and JSON of new "example"
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
	delete req.body.example.owner

	MonthTracker.findById(req.params.id)
		.then(handle404)
		.then((example) => {
			// pass the `req` object and the Mongoose record to `requireOwnership`
			// it will throw an error if the current user isn't the owner
			requireOwnership(req, example)

			// pass the result of Mongoose's `.update` to the next `.then`
			return example.updateOne(req.body.example)
		})
		// if that succeeded, return 204 and no JSON
		.then(() => res.sendStatus(204))
		// if an error occurs, pass it to the handler
		.catch(next)
})

// DESTROY
// DELETE /monthTrackers/5a7db6c74d55bc51bdf39793
router.delete('/monthTrackers/:id', requireToken, (req, res, next) => {
	MonthTracker.findById(req.params.id)
		.then(handle404)
		.then((example) => {
			// throw an error if current user doesn't own `example`
			requireOwnership(req, example)
			// delete the example ONLY IF the above didn't throw
			example.deleteOne()
		})
		// send back 204 and no content if the deletion succeeded
		.then(() => res.sendStatus(204))
		// if an error occurs, pass it to the handler
		.catch(next)
})

module.exports = router
