const mongoose = require('mongoose')

const accountSchema = new mongoose.Schema({
    savings: {
        type: Number,
        default: 0,
    },
    cashflow: {
        type: Number,
        default: 0,
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
})

module.exports = mongoose.model('Account', accountSchema)