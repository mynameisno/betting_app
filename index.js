require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');

const { User, Club, Bet, Debt} = require('./models');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error("FATAL ERROR: MONGODB_URI is not defined in .env file");
    process.exit(1); // עוצר את השרת כי אי אפשר לעבוד בלי DB
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log("Connected to MongoDB Atlas"))
  .catch(err => console.error("Could not connect to MongoDB", err));

const app = express();
app.use(cors()); // מאפשר גישה לשרת מכל מקור (למשל האפליקציה שלנו)
app.use(express.json()); // מאפשר לשרת לקרוא JSON שנשלח מהאפליקציה

// --- נתיבים (Routes) ---

// 1. יצירת משתמש חדש
app.post('/api/users', async (req, res) => {
    try {
        const newUser = new User({
            username: req.body.username,
            balance: 1000 // יתרת פתיחה
        });

        const savedUser = await newUser.save();
        return res.status(201).json(savedUser);

    } catch (error) {
        console.log("Error detected:", error.message);
        return res.status(400).json({
            success: false,
            message: "Username already exists or invalid",
            details: error.message
        });
    }
});

// 2. יצירת מועדון חדש
app.post('/api/clubs', async (req, res) => {
  try {
    const { name, creatorId } = req.body;
    
    // 1. יצירת קוד הזמנה
    const inviteCode = Math.random().toString(36).substring(2, 7).toUpperCase();

    // 2. יצירת המועדון כשיוצרו הוא החבר הראשון
    const newClub = new Club({
      name: name,
      creator: creatorId,
      inviteCode: inviteCode,
      members: [creatorId], // הוספת היוצר למועדון
      bets: []
    });

    const savedClub = await newClub.save();

    // 3. עדכון המשתמש - הוספת ה-ID של המועדון החדש לרשימת המועדונים שלו
    await User.findByIdAndUpdate(creatorId, {
      $push: { clubs: savedClub._id }
    });

    res.status(201).json(savedClub);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.post('/api/create-bet', async (req, res) => {
    const { creatorId, clubId, eventName, budget, options } = req.body;
    try {
        const user = await User.findById(creatorId);
        // בדיקה שהיתרה פחות מה שנעול מספיקה
        if (!user || (user.balance - user.holds) < budget) {
            return res.status(400).json({ error: "אין מספיק יתרה פנויה" });
        }

        user.holds += budget; 
        await user.save();

        const newBet = new Bet({
            creator: creatorId,
            club: clubId,
            eventName: eventName,
            budget: budget,
            remainingLiability: budget,
            options: options,
            status: 'open'
        });

        await newBet.save();
        await Club.findByIdAndUpdate(clubId, { $push: { bets: newBet._id } });
        await User.findByIdAndUpdate(creatorId, { $push: { createdBets: newBet._id } });

        res.status(201).json(newBet);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/clubs/join', async (req, res) => {
  try {
    const { inviteCode, userId } = req.body;

    // 1. מצא את המועדון לפי הקוד
    const club = await Club.findOne({ inviteCode });
    if (!club) return res.status(404).json({ message: "מועדון לא נמצא" });

    // 2. בדוק אם המשתמש כבר חבר
    if (club.members.includes(userId)) {
      return res.status(400).json({ message: "אתה כבר חבר במועדון זה" });
    }

    // 3. עדכן את המועדון (הוסף חבר)
    club.members.push(userId);
    await club.save();

    // 4. עדכן את המשתמש (הוסף מועדון)
    await User.findByIdAndUpdate(userId, {
      $push: { clubs: club._id }
    });

    res.status(200).json(club);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
app.get('/api/clubs/:clubId/bets', async (req, res) => {
    try {
        const club = await Club.findById(req.params.clubId).populate('bets');
        res.json(club.bets); // מחזיר מערך של אובייקטים מלאים
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/take-bet', async (req, res) => {
    const { betId, takerId, optionIndex, amount } = req.body; // amount = Stake (כמה המהמר שם)

    try {
        const bet = await Bet.findById(betId);
        const taker = await User.findById(takerId);
        const option = bet.options[optionIndex];

        // חישוב החשיפה: כמה היוצר מסכן מול ההימור הספציפי הזה
        // נוסחה: Stake * (Odds - 1)
        const liability = amount * (option.odds - 1);

        if (liability > bet.remainingLiability) {
            return res.status(400).json({ error: "הסכום גבוה מדי ליחס הנוכחי (חשיפת יתר)" });
        }

        if (taker.balance - taker.holds < amount) {
            return res.status(400).json({ error: "אין לך מספיק יתרה" });
        }

        // עדכון: יורדת החשיפה מהתקציב, לא ה-amount!
        bet.remainingLiability -= liability;
        taker.holds += amount; // "נועל" את הסכום שהמהמר שם עד שההימור ייסגר
        await taker.save();

        option.takers.push({
            user: takerId,
            amount: amount // אנחנו שומרים את הקרן של המהמר
        });

        if (bet.remainingLiability <= 0.1) { // הגנה ממספרים עשרוניים
            bet.status = 'taken';
        }
        
        await bet.save();

        // המהמר נפרד מהקרן שלו
        taker.takenBets.push(betId);
        await taker.save();

        res.json({ message: "Success", remaining: bet.remainingLiability });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/users/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .populate('clubs')
            .populate('createdBets')
            .populate({ 
                path: 'debts',
                populate: { path: 'creditor', select: 'username' }
             })
            .populate( {path: 'credits',
                populate: { path: 'debtor', select: 'username' }
            })
            .populate({
                path: 'takenBets',
                populate: { path: 'creator', select: 'username' }
            });

        if (!user) return res.status(404).json({ error: "User not found" });

        const userData = user.toObject();

        // 1. עיבוד ה-Stake האישי לכל הימור שלקחתי
        userData.takenBets = userData.takenBets.map(bet => {
            let myPersonalStake = 0;
            let mySelectedOptionName = "";
            let mySelectedOptionOdds = 0;

            bet.options.forEach(opt => {
                const myBetOnThisOption = opt.takers.find(t => t.user.toString() === req.params.id);
                if (myBetOnThisOption) {
                    myPersonalStake += myBetOnThisOption.amount;
                    mySelectedOptionName = opt.name;
                    mySelectedOptionOdds = opt.odds; // שומרים את היחס של האופציה שנבחרה
                }
            });

            return {
                ...bet,
                myStake: myPersonalStake,
                myOptionName: mySelectedOptionName,
                // חישוב זכייה פוטנציאלית: כמה המשתמש יקבל אם ינצח (קרן + רווח)
                potentialPayout: myPersonalStake * mySelectedOptionOdds 
            };
        });

        // 2. חישוב כסף "נעול" (Locked Amount) לתצוגה
        // א. מה שהיוצר שריין להימורים שפתח (התקציב המקורי שטרם נוצל)
        const lockedInCreated = user.createdBets
            .filter(bet => bet.status === 'open')
            .reduce((sum, bet) => sum + (bet.remainingLiability || 0), 0);

        // ב. מה שהמשתמש שם כמהמר (הסכומים שהוא השקיע ב-takenBets)
        const lockedInTaken = userData.takenBets
            .filter(bet => bet.status === 'open' || bet.status === 'taken')
            .reduce((sum, bet) => sum + (bet.myStake || 0), 0);

        // 3. הזרקת הנתונים ל-Response
        userData.lockedAmount = lockedInCreated + lockedInTaken; // לתצוגה גרפית ב-UI
        userData.balance = user.balance; // היתרה הנומינלית
        userData.holds = user.holds;     // הסכום שחסום בפועל ב-DB
        
        // יתרה נזילה (מה שאפשר להמר איתו עכשיו)
        userData.availableBalance = user.balance - user.holds;

        res.json(userData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/close-bet', async (req, res) => {
    const { betId, winningOptionIndex } = req.body;

    try {
        const bet = await Bet.findById(betId).populate('creator');
        const creator = bet.creator;
        
        let creatorProfitLoss = 0;

        for (let i = 0; i < bet.options.length; i++) {
            const option = bet.options[i];
            const isWinner = (i === winningOptionIndex);

            for (const takerInfo of option.takers) {
                const taker = await User.findById(takerInfo.user);
                
                if (isWinner) {
                    // המהמר ניצח: היוצר חייב לו את הרווח
                    const profit = takerInfo.amount * (option.odds - 1);
                    taker.balance += profit;
                    creatorProfitLoss -= profit;

                    // יצירת רישום חוב: היוצר (Debtor) חייב למהמר (Creditor)
                    const newDebt = new Debt({
                        debtor: creator._id,
                        creditor: taker._id,
                        amount: profit,
                        betOrigin: bet._id,
                        isPaid: true // מכיוון שהכסף עובר אוטומטית ב-balance
                    });
                    const savedDebt = await newDebt.save();
                    
                    // עדכון המערכים במודל User
                    taker.credits.push(savedDebt._id);
                    creator.debts.push(savedDebt._id);

                } else {
                    // המהמר הפסיד: המהמר חייב ליוצר את הקרן
                    taker.balance -= takerInfo.amount;
                    creatorProfitLoss += takerInfo.amount;

                    // יצירת רישום חוב: המהמר (Debtor) חייב ליוצר (Creditor)
                    const newDebt = new Debt({
                        debtor: taker._id,
                        creditor: creator._id,
                        amount: takerInfo.amount,
                        betOrigin: bet._id,
                        isPaid: true
                    });
                    const savedDebt = await newDebt.save();

                    taker.debts.push(savedDebt._id);
                    creator.credits.push(savedDebt._id);
                }
                
                taker.holds -= takerInfo.amount;
                await taker.save();
            }
        }

        creator.balance += creatorProfitLoss;
        creator.holds -= bet.budget;
        await creator.save();

        bet.status = 'closed';
        await bet.save();

        res.json({ message: "ההימור נסגר, הכספים חולקו והחובות נרשמו" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- הרשמה פשוטה ---
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const existing = await User.findOne({ username });
        if (existing) return res.status(400).json({ message: "שם המשתמש כבר תפוס" });

        const newUser = new User({
            username,
            password, // נשמר כטקסט רגיל
            balance: 1000,
            holds: 0
        });

        await newUser.save();
        res.status(201).json(newUser);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- התחברות פשוטה ---
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username, password }); // מחפש התאמה מדויקת
        
        if (!user) {
            return res.status(401).json({ message: "שם משתמש או סיסמה שגויים" });
        }

        // מחזירים את כל נתוני המשתמש כפי שעשינו ב-Get User
        // (מומלץ לקרוא לפונקציית ה-populate כאן או פשוט להחזיר את האובייקט)
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});