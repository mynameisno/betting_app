const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 1000 },
  takenBets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bet' }], // הימורים שלקח
  clubs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Club' }], // מועדונים שהמשתמש חבר בהם
  createdBets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bet' }], // הימורים שיצר
  debts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Debt' }], // חובות (הפסיד)
  credits: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Debt' }], // זכויות (זכה)
  holds: {type: Number, default: 0} // סכום הכסף שהמשתמש "שם" בהימורים שעדיין לא נסגרו
});

const clubSchema = new mongoose.Schema({
  name: { type: String, required: true },
  inviteCode: { type: String, unique: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // חברי המועדון
  bets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bet' }]
});

const betSchema = new mongoose.Schema({
  eventName: String,   // זה השם המרכזי שנשתמש בו
  description: String, // לגיבוי
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  club: { type: mongoose.Schema.Types.ObjectId, ref: 'Club' },
  options: [{
    optionName: String,
    odds: Number,
    takers: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      amount: Number
    }]
  }],
  budget: Number, 
  remainingLiability: { type: Number, default: 0 }, // הוספה קריטית!
  status: { type: String, enum: ['open', 'taken', 'closed'], default: 'open' }
});

const debtSchema = new mongoose.Schema({
  debtor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // מי שחייב
  creditor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // מי שחייבים לו
  amount: Number,
  betOrigin: { type: mongoose.Schema.Types.ObjectId, ref: 'Bet' }, // מאיזה הימור זה הגיע
  isPaid: { type: Boolean, default: false }
});

const Bet = mongoose.model('Bet', betSchema);
const Debt = mongoose.model('Debt', debtSchema);
const User = mongoose.model('User', userSchema);
const Club = mongoose.model('Club', clubSchema);

module.exports = { User, Club, Bet, Debt };