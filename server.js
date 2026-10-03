const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'cashvista_jwt_secret_key_123_456';

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files (HTML, CSS, JS, assets) from the project root
app.use(express.static(__dirname));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Database connection state
let useInMemory = false;
let db = {
  users: [],
  transactions: [],
  budgets: [],
  accounts: []
};

// ----------------------------------------------------
// MONGOOSE SCHEMAS (If MongoDB is available)
// ----------------------------------------------------
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  currency: { type: String, default: '₹' },
  theme: { type: String, default: 'light' },
  notifications: { type: Array, default: [] }
}, { timestamps: true });

const TransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['income', 'expense'], required: true },
  category: { type: String, required: true },
  amount: { type: Number, required: true },
  date: { type: Date, required: true },
  account: { type: String, required: true },
  description: { type: String, default: '' },
  notes: { type: String, default: '' },
  status: { type: String, default: 'Completed' }
}, { timestamps: true });

const BudgetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category: { type: String, required: true },
  amount: { type: Number, required: true },
  month: { type: String, required: true } // format YYYY-MM
}, { timestamps: true });

const AccountSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:     { type: String, required: true },
  type:     { type: String, required: true }, // Bank, Credit Card, Cash, Investment
  balance:  { type: Number, default: 0 },
  currency: { type: String, default: 'INR' }  // ISO 4217 currency code
}, { timestamps: true });

const GoalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  targetAmount: { type: Number, required: true },
  currentAmount: { type: Number, default: 0 },
  targetDate: { type: Date, required: true },
  category: { type: String, default: '' },
  icon: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  completed: { type: Boolean, default: false }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const Budget = mongoose.model('Budget', BudgetSchema);
const Account = mongoose.model('Account', AccountSchema);
const Goal = mongoose.model('Goal', GoalSchema);

// Connect to MongoDB with a fast-fail timeout
let cached = global.mongoCache;
if (!cached) {
  cached = global.mongoCache = { conn: null, promise: null };
}

const connectWithRetry = async () => {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/cashvista', {
      serverSelectionTimeoutMS: 3000,
    })
      .then(() => {
        console.log('>>> MongoDB Connected Successfully.');
        seedDatabase();
        return mongoose;
      })
      .catch(err => {
        console.warn('\n======================================================');
        console.warn('WARNING: MongoDB connection failed!');
        console.warn('Error details:', err.message);
        console.warn('FALLING BACK TO IN-MEMORY DATABASE MODE.');
        console.warn('Data will not persist after server restarts.');
        console.warn('======================================================\n');
        useInMemory = true;
        seedInMemoryDatabase();
        cached.promise = null;
        return null;
      });
  }
  cached.conn = await cached.promise;
  return cached.conn;
};

connectWithRetry();

// Ensure DB connection is active and cached across serverless invocations
app.use(async (req, res, next) => {
  await connectWithRetry();
  next();
});

// ----------------------------------------------------
// DATABASE OPERATION ABSTRACTION LAYER
// ----------------------------------------------------
const dbService = {
  findUserByEmail: async (email) => {
    if (useInMemory) {
      return db.users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
    }
    return await User.findOne({ email: new RegExp(`^${email}$`, 'i') });
  },
  findUserById: async (id) => {
    if (useInMemory) {
      return db.users.find(u => u._id === id.toString()) || null;
    }
    return await User.findById(id);
  },
  createUser: async (userData) => {
    if (useInMemory) {
      const newUser = {
        _id: new mongoose.Types.ObjectId().toString(),
        currency: '₹',
        theme: 'light',
        notifications: [],
        createdAt: new Date(),
        ...userData
      };
      db.users.push(newUser);
      return newUser;
    }
    const newUser = new User(userData);
    return await newUser.save();
  },
  updateUser: async (id, updateData) => {
    if (useInMemory) {
      const idx = db.users.findIndex(u => u._id === id.toString());
      if (idx !== -1) {
        db.users[idx] = { ...db.users[idx], ...updateData };
        return db.users[idx];
      }
      return null;
    }
    return await User.findByIdAndUpdate(id, { $set: updateData }, { new: true });
  },
  getTransactions: async (userId, filter = {}) => {
    if (useInMemory) {
      let txs = db.transactions.filter(t => t.userId === userId.toString());
      if (filter.type) txs = txs.filter(t => t.type === filter.type);
      if (filter.category) txs = txs.filter(t => t.category === filter.category);
      if (filter.account) txs = txs.filter(t => t.account === filter.account);
      return txs.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    let query = { userId };
    if (filter.type) query.type = filter.type;
    if (filter.category) query.category = filter.category;
    if (filter.account) query.account = filter.account;
    return await Transaction.find(query).sort({ date: -1 });
  },
  getTransactionById: async (id) => {
    if (useInMemory) {
      return db.transactions.find(t => t._id === id.toString()) || null;
    }
    return await Transaction.findById(id);
  },
  createTransaction: async (userId, txData) => {
    if (useInMemory) {
      const newTx = {
        _id: new mongoose.Types.ObjectId().toString(),
        userId: userId.toString(),
        status: 'Completed',
        createdAt: new Date(),
        ...txData,
        date: new Date(txData.date),
        amount: Number(txData.amount)
      };
      db.transactions.push(newTx);
      return newTx;
    }
    const newTx = new Transaction({ ...txData, userId });
    return await newTx.save();
  },
  updateTransaction: async (id, updateData) => {
    if (useInMemory) {
      const idx = db.transactions.findIndex(t => t._id === id.toString());
      if (idx !== -1) {
        db.transactions[idx] = {
          ...db.transactions[idx],
          ...updateData,
          amount: updateData.amount ? Number(updateData.amount) : db.transactions[idx].amount,
          date: updateData.date ? new Date(updateData.date) : db.transactions[idx].date
        };
        return db.transactions[idx];
      }
      return null;
    }
    return await Transaction.findByIdAndUpdate(id, { $set: updateData }, { new: true });
  },
  deleteTransaction: async (id) => {
    if (useInMemory) {
      const idx = db.transactions.findIndex(t => t._id === id.toString());
      if (idx !== -1) {
        return db.transactions.splice(idx, 1)[0];
      }
      return null;
    }
    return await Transaction.findByIdAndDelete(id);
  },
  getBudgets: async (userId) => {
    if (useInMemory) {
      return db.budgets.filter(b => b.userId === userId.toString());
    }
    return await Budget.find({ userId });
  },
  createOrUpdateBudget: async (userId, budgetData) => {
    const { category, amount, month } = budgetData;
    const numAmount = Number(amount);
    if (useInMemory) {
      let b = db.budgets.find(b => b.userId === userId.toString() && b.category === category && b.month === month);
      if (b) {
        b.amount = numAmount;
      } else {
        b = {
          _id: new mongoose.Types.ObjectId().toString(),
          userId: userId.toString(),
          category,
          amount: numAmount,
          month,
          createdAt: new Date()
        };
        db.budgets.push(b);
      }
      return b;
    }
    return await Budget.findOneAndUpdate(
      { userId, category, month },
      { amount: numAmount },
      { upsert: true, new: true }
    );
  },
  getAccounts: async (userId) => {
    if (useInMemory) {
      return db.accounts.filter(a => a.userId === userId.toString());
    }
    return await Account.find({ userId });
  },
  createAccount: async (userId, accountData) => {
    if (useInMemory) {
      const newAcc = {
        _id: new mongoose.Types.ObjectId().toString(),
        userId: userId.toString(),
        currency: 'INR',
        createdAt: new Date(),
        ...accountData,
        balance: Number(accountData.balance || 0)
      };
      db.accounts.push(newAcc);
      return newAcc;
    }
    const newAcc = new Account({ ...accountData, userId });
    return await newAcc.save();
  },
  updateAccountBalance: async (userId, name, amountChange) => {
    if (useInMemory) {
      const acc = db.accounts.find(a => a.userId === userId.toString() && a.name.toLowerCase() === name.toLowerCase());
      if (acc) {
        acc.balance += Number(amountChange);
        return acc;
      }
      return null;
    }
    return await Account.findOneAndUpdate(
      { userId, name: new RegExp(`^${name}$`, 'i') },
      { $inc: { balance: Number(amountChange) } },
      { new: true }
    );
  }
};

// ----------------------------------------------------
// DATABASE SEED DATA
// ----------------------------------------------------
const SEED_USER_EMAIL = 'demo@cashvista.com';
const SEED_USER_PASS = 'password123';

function getSeedData(userId) {
  const accounts = [
    { name: 'Savings Account', type: 'Bank', balance: 14250, currency: 'INR' },
    { name: 'Credit Card', type: 'Credit Card', balance: -840, currency: 'INR' },
    { name: 'Cash Wallet', type: 'Cash', balance: 350, currency: 'INR' },
    { name: 'USD Investment', type: 'Investment', balance: 1200, currency: 'USD' }
  ];

  const budgets = [
    { category: 'Housing', amount: 1500, month: '2026-06' },
    { category: 'Food', amount: 600, month: '2026-06' },
    { category: 'Transportation', amount: 250, month: '2026-06' },
    { category: 'Entertainment', amount: 300, month: '2026-06' },
    { category: 'Utilities', amount: 200, month: '2026-06' },
    { category: 'Others', amount: 200, month: '2026-06' }
  ];

  const transactions = [];
  const now = new Date();
  const randomDatePastDays = (daysAgo) => {
    const d = new Date();
    d.setDate(now.getDate() - daysAgo);
    d.setHours(Math.floor(Math.random() * 12) + 8, Math.floor(Math.random() * 60), 0);
    return d;
  };

  transactions.push({
    userId,
    type: 'income',
    category: 'Salary',
    description: 'Monthly Direct Deposit Salary',
    amount: 4200,
    date: randomDatePastDays(30),
    account: 'Savings Account',
    notes: 'Primary payroll deposition',
    status: 'Completed'
  });

  return { accounts: accounts.map(a => ({ ...a, userId })), budgets: budgets.map(b => ({ ...b, userId })), transactions };
}

async function seedDatabase() {
  try {
    const userCount = await User.countDocuments();
    if (userCount > 0) return;
    const hashedPassword = await bcrypt.hash(SEED_USER_PASS, 10);
    const user = await User.create({
      username: 'Demo User',
      email: SEED_USER_EMAIL,
      password: hashedPassword,
      currency: '₹',
      theme: 'light',
      notifications: []
    });
    const seeds = getSeedData(user._id);
    await Account.insertMany(seeds.accounts);
    await Budget.insertMany(seeds.budgets);
    await Transaction.insertMany(seeds.transactions);
  } catch (error) {
    console.error('>>> Seeding MongoDB failed:', error.message);
  }
}

async function seedInMemoryDatabase() {
  try {
    const hashedPassword = await bcrypt.hash(SEED_USER_PASS, 10);
    const mockUserId = '507f1f77bcf86cd799439011';
    db.users.push({
      _id: mockUserId,
      username: 'Demo User',
      email: SEED_USER_EMAIL,
      password: hashedPassword,
      currency: '₹',
      theme: 'light',
      notifications: [],
      createdAt: new Date()
    });
    const seeds = getSeedData(mockUserId);
    db.accounts = seeds.accounts.map((a, idx) => ({ ...a, _id: `acc00${idx + 1}` }));
    db.budgets = seeds.budgets.map((b, idx) => ({ ...b, _id: `bud00${idx + 1}` }));
    db.transactions = seeds.transactions.map((t, idx) => ({ ...t, _id: `tx00${idx + 1}` }));
  } catch (error) {
    console.error('>>> Seeding In-Memory failed:', error.message);
  }
}

// ----------------------------------------------------
// AUTH CHECK & VALIDATION
// ----------------------------------------------------
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. Token missing.' });

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    const user = await dbService.findUserById(verified.id);
    if (!user) return res.status(404).json({ error: 'User account not found.' });
    req.user = user;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired auth token.' });
  }
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!\%*?&]{8,}$/;
const EMAIL_TYPO_MAP = {
  'gmail.in': 'gmail.com', 'gmal.com': 'gmail.com', 'gmial.com': 'gmail.com',
  'gmil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'yahooo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'hotmil.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'otlook.com': 'outlook.com'
};

function validateRegistrationInput(username, email, password) {
  if (!username || username.trim().length < 2) return 'Username must be at least 2 characters.';
  if (!EMAIL_REGEX.test(email)) return 'Please enter a valid email address.';
  const domain = email.split('@')[1]?.toLowerCase();
  if (domain && EMAIL_TYPO_MAP[domain]) return `Did you mean @${EMAIL_TYPO_MAP[domain]}? Please correct your email domain.`;
  if (!PASSWORD_REGEX.test(password)) return 'Password must be 8+ characters and include uppercase, lowercase, a number, and a special character (@$!%*?&).';
  return null;
}

// ----------------------------------------------------
// AUTH ROUTES
// ----------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required.' });
    }
    const validationError = validateRegistrationInput(username, email.trim(), password);
    if (validationError) return res.status(400).json({ error: validationError });

    const existingUser = await dbService.findUserByEmail(email.trim().toLowerCase());
    if (existingUser) return res.status(400).json({ error: 'Email address already registered.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await dbService.createUser({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      currency: '₹',
      theme: 'light',
      notifications: [{ id: Date.now().toString(), title: 'Registration Successful!', message: 'Welcome to Cashvista.', timestamp: new Date(), type: 'info', read: false }]
    });

    await dbService.createAccount(user._id, { name: 'Savings Account', type: 'Bank', balance: 0 });
    await dbService.createAccount(user._id, { name: 'Cash Wallet', type: 'Cash', balance: 0 });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: user._id, username: user.username, email: user.email, currency: user.currency, theme: user.theme }
    });
  } catch (error) {
    res.status(500).json({ error: 'Register failed: ' + error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const user = await dbService.findUserByEmail(email);
    if (!user) return res.status(400).json({ error: 'Invalid email or password.' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid email or password.' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email, currency: user.currency, theme: user.theme }
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed: ' + error.message });
  }
});

app.get('/api/user/profile', authenticateToken, async (req, res) => {
  const { _id, username, email, currency, theme, notifications } = req.user;
  res.json({ id: _id, username, email, currency, theme, notifications });
});

app.put('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const { currency, theme, notifications } = req.body;
    const update = {};
    if (currency) update.currency = currency;
    if (theme) update.theme = theme;
    if (notifications) update.notifications = notifications;

    const updatedUser = await dbService.updateUser(req.user._id, update);
    res.json({
      id: updatedUser._id,
      username: updatedUser.username,
      email: updatedUser.email,
      currency: updatedUser.currency,
      theme: updatedUser.theme,
      notifications: updatedUser.notifications
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings profile.' });
  }
});

// ----------------------------------------------------
// TRANSACTION ROUTES
// ----------------------------------------------------
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { type, category, account } = req.query;
    const txs = await dbService.getTransactions(req.user._id, { type, category, account });
    res.json(txs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch transactions.' });
  }
});

app.post('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { type, category, amount, date, account, description, notes } = req.body;
    if (!type || !category || !amount || !date || !account) {
      return res.status(400).json({ error: 'Required fields: type, category, amount, date, account.' });
    }

    const tx = await dbService.createTransaction(req.user._id, {
      type, category, amount: Number(amount), date: new Date(date), account, description, notes
    });

    const balanceChange = type === 'income' ? amount : -amount;
    await dbService.updateAccountBalance(req.user._id, account, balanceChange);
    res.status(201).json(tx);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create transaction: ' + error.message });
  }
});

app.put('/api/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { type, category, amount, date, account, description, notes } = req.body;

    const oldTx = await dbService.getTransactionById(id);
    if (!oldTx || oldTx.userId.toString() !== req.user._id.toString()) {
      return res.status(404).json({ error: 'Transaction not found.' });
    }

    const oldBalanceChange = oldTx.type === 'income' ? -oldTx.amount : oldTx.amount;
    await dbService.updateAccountBalance(req.user._id, oldTx.account, oldBalanceChange);

    const updatedTx = await dbService.updateTransaction(id, {
      type, category, amount: Number(amount), date: new Date(date), account, description, notes
    });

    const newBalanceChange = type === 'income' ? amount : -amount;
    await dbService.updateAccountBalance(req.user._id, account, newBalanceChange);
    res.json(updatedTx);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update transaction: ' + error.message });
  }
});

app.delete('/api/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const oldTx = await dbService.getTransactionById(id);
    if (!oldTx || oldTx.userId.toString() !== req.user._id.toString()) {
      return res.status(404).json({ error: 'Transaction not found.' });
    }

    await dbService.deleteTransaction(id);
    const revertChange = oldTx.type === 'income' ? -oldTx.amount : oldTx.amount;
    await dbService.updateAccountBalance(req.user._id, oldTx.account, revertChange);
    res.json({ message: 'Transaction deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete transaction.' });
  }
});

// ----------------------------------------------------
// BUDGET & ACCOUNTS & REPORTS ROUTES
// ----------------------------------------------------
app.get('/api/budgets', authenticateToken, async (req, res) => {
  try {
    const budgets = await dbService.getBudgets(req.user._id);
    res.json(budgets);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch budgets: ' + error.message });
  }
});

app.post('/api/budgets', authenticateToken, async (req, res) => {
  try {
    const { category, amount, month } = req.body;
    const budget = await dbService.createOrUpdateBudget(req.user._id, { category, amount, month });
    res.json(budget);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save budget.' });
  }
});

app.get('/api/accounts', authenticateToken, async (req, res) => {
  try {
    const accounts = await dbService.getAccounts(req.user._id);
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch accounts.' });
  }
});

app.post('/api/accounts', authenticateToken, async (req, res) => {
  try {
    const { name, type, balance, currency } = req.body;
    const account = await dbService.createAccount(req.user._id, { name, type, balance: Number(balance || 0), currency: currency || 'INR' });
    res.status(201).json(account);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create account.' });
  }
});

app.post('/api/accounts/transfer', authenticateToken, async (req, res) => {
  try {
    const { fromAccount, toAccount, amount, description } = req.body;
    const numAmount = Number(amount);
    await dbService.updateAccountBalance(req.user._id, fromAccount, -numAmount);
    await dbService.updateAccountBalance(req.user._id, toAccount, numAmount);
    res.json({ message: 'Transfer processed successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Transfer failed: ' + error.message });
  }
});

app.get('/api/reports/monthly', authenticateToken, async (req, res) => {
  try {
    const txs = await dbService.getTransactions(req.user._id);
    const monthlyData = {};
    txs.forEach(t => {
      const monthKey = new Date(t.date).toISOString().substring(0, 7);
      if (!monthlyData[monthKey]) monthlyData[monthKey] = { month: monthKey, income: 0, expenses: 0 };
      if (t.type === 'income') monthlyData[monthKey].income += t.amount;
      else monthlyData[monthKey].expenses += t.amount;
    });
    res.json(Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month)));
  } catch (error) {
    res.status(500).json({ error: 'Failed to compile monthly reports.' });
  }
});

app.get('/api/reports/yearly', authenticateToken, async (req, res) => {
  try {
    const txs = await dbService.getTransactions(req.user._id);
    const yearlyData = {};
    txs.forEach(t => {
      const yearKey = new Date(t.date).getFullYear().toString();
      if (!yearlyData[yearKey]) yearlyData[yearKey] = { year: yearKey, income: 0, expenses: 0 };
      if (t.type === 'income') yearlyData[yearKey].income += t.amount;
      else yearlyData[yearKey].expenses += t.amount;
    });
    res.json(Object.values(yearlyData).sort((a, b) => a.year.localeCompare(b.year)));
  } catch (error) {
    res.status(500).json({ error: 'Failed to compile yearly reports.' });
  }
});

// ----------------------------------------------------
// FRONTEND STATIC PAGE SERVING
// ----------------------------------------------------
const pages = [
  'account', 'audits', 'budget', 'dashboard',
  'expense', 'income', 'login', 'reports', 'settings'
];

// Serve explicit HTML routes (e.g. /login or /login.html)
pages.forEach(p => {
  app.get(`/${p}`, (req, res) => res.sendFile(path.join(__dirname, `${p}.html`)));
  app.get(`/${p}.html`, (req, res) => res.sendFile(path.join(__dirname, `${p}.html`)));
});

// Serve root homepage index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ----------------------------------------------------
// AI CHATBOT ROUTE  (context-aware financial advisor)
// ----------------------------------------------------
app.post('/api/chatbot/ask', authenticateToken, async (req, res) => {
  try {
    const { question, history } = req.body;

    // Accept 'question' (primary) or legacy 'prompt'
    const userMessage = (typeof question === 'string' && question.trim())
      || (typeof req.body.prompt === 'string' && req.body.prompt.trim());

    if (!userMessage) {
      return res.status(400).json({ error: 'question is required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === '' || apiKey === 'YOUR_GEMINI_API_KEY') {
      const msg = 'Gemini API key is not configured. Please set GEMINI_API_KEY in your .env file.';
      return res.json({ answer: msg, reply: msg });
    }

    // ── Fetch user's live financial data ─────────────────────────
    const userId = req.user._id;
    const userCurrencySymbol = req.user.currency || '₹';

    // Map legacy symbol → ISO code for display
    const symbolToCode = { '₹': 'INR', '$': 'USD', '€': 'EUR', '£': 'GBP' };
    const currencyCode = symbolToCode[userCurrencySymbol] || userCurrencySymbol;

    const [transactions, accounts, budgets] = await Promise.all([
      dbService.getTransactions(userId),
      dbService.getAccounts(userId),
      dbService.getBudgets(userId)
    ]);

    // Limit to most recent 75 transactions to stay within prompt token limits
    const recentTxs = transactions.slice(0, 75);

    // ── Compute summary figures ───────────────────────────────────
    const totalIncome   = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const netCashFlow   = totalIncome - totalExpenses;
    const totalBalance  = accounts.reduce((s, a) => s + (a.balance || 0), 0);

    const fmt = (n) => `${userCurrencySymbol}${Number(n).toFixed(2)}`;

    // ── Format accounts summary ───────────────────────────────────
    const accountsSummary = accounts.length
      ? accounts.map(a =>
          `  • ${a.name} (${a.type}): ${a.currency || currencyCode} ${Number(a.balance || 0).toFixed(2)}`
        ).join('\n')
      : '  No accounts on record.';

    // ── Format recent transactions (latest 8 for fast prompt processing) ──────
    const txDisplay = recentTxs.slice(0, 8);
    const recentTransactionsSummary = txDisplay.length
      ? txDisplay.map(t => {
          const d = new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
          return `  • [${d}] ${t.type.toUpperCase()} | ${t.category} | ${t.description || '—'} | ${fmt(t.amount)} | ${t.account}`;
        }).join('\n')
      : '  No transactions recorded.';

    // ── Format budgets summary ────────────────────────────────────
    const currentMonth = new Date().toISOString().substring(0, 7);
    const activeBudgets = budgets.filter(b => b.month === currentMonth);
    const budgetsSummary = activeBudgets.length
      ? activeBudgets.map(b => {
          const spent = transactions
            .filter(t => t.type === 'expense' && t.category === b.category
                      && new Date(t.date).toISOString().substring(0, 7) === currentMonth)
            .reduce((s, t) => s + t.amount, 0);
          const pct  = b.amount > 0 ? Math.round((spent / b.amount) * 100) : 0;
          const left = Math.max(0, b.amount - spent);
          return `  • ${b.category}: limit ${fmt(b.amount)}, spent ${fmt(spent)} (${pct}%), remaining ${fmt(left)}`;
        }).join('\n')
      : '  No budgets set for the current month.';

    // ── Category breakdown (top 5 expense categories) ────────────
    const catMap = {};
    transactions.filter(t => t.type === 'expense').forEach(t => {
      catMap[t.category] = (catMap[t.category] || 0) + t.amount;
    });
    const topCategories = Object.entries(catMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat, amt]) => `  • ${cat}: ${fmt(amt)}`)
      .join('\n') || '  None.';

    // ── System context prompt ─────────────────────────────────────
    const financialContext = `You are Cashvista AI, a smart and friendly personal financial advisor integrated directly into the user's finance dashboard. You have FULL access to the user's real financial records below. Answer every question using ONLY their actual data — never say you lack access to their information.

══════════════════════════════════════════
USER FINANCIAL SNAPSHOT  (as of ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})
══════════════════════════════════════════
Currency       : ${currencyCode} (${userCurrencySymbol})
Total Balance  : ${fmt(totalBalance)}  (sum of all accounts)
Total Income   : ${fmt(totalIncome)}
Total Expenses : ${fmt(totalExpenses)}
Net Cash Flow  : ${fmt(netCashFlow)}  (${netCashFlow >= 0 ? 'surplus ✅' : 'deficit ⚠️'})

ACCOUNTS:
${accountsSummary}

TOP EXPENSE CATEGORIES (all time):
${topCategories}

CURRENT MONTH BUDGETS (${currentMonth}):
${budgetsSummary}

RECENT TRANSACTIONS (latest 8 of ${transactions.length} total):
${recentTransactionsSummary}
══════════════════════════════════════════

GUIDELINES:
- Always reference the user's actual figures and currency above.
- Be concise, direct, and professional. Use bullet points for lists.
- Highlight concerns (overspending, budget breaches, negative cash flow) with actionable advice.
- If asked about specific transactions, reference exact dates, categories, and amounts.
- Do NOT mention that you are an AI or that you are "analysing" — just answer directly.`;

    // ── Sanitise conversation history ─────────────────────────────
    const rawHistory = Array.isArray(history) ? history : [];
    const sanitised  = [];
    for (const h of rawHistory) {
      if (!h) continue;
      const role = (h.role === 'model' || h.role === 'bot') ? 'model' : 'user';
      const text = typeof h.parts === 'string'
        ? h.parts
        : (Array.isArray(h.parts) ? (h.parts[0]?.text || '') : (h.message || h.text || ''));
      if (!text.trim()) continue;
      if (sanitised.length > 0 && sanitised[sanitised.length - 1].role === role) continue;
      sanitised.push({ role, parts: [{ text }] });
    }
    while (sanitised.length > 0 && sanitised[0].role !== 'user') sanitised.shift();

    // Keep history lean (last 4 items = 2 conversation turns) to minimize latency
    const trimmedHistory = sanitised.slice(-4);

    // ── Generate response with fallback model chain ───────────────
    const genAI = new GoogleGenerativeAI(apiKey);
    // Prioritize fast, stable production endpoints to avoid 503 overloads
    const MODEL_NAMES = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-flash-latest'];
    const generationConfig = {
      maxOutputTokens: 350,
      temperature: 0.4
    };

    // Helper timeout to fail fast (6s per attempt) instead of hanging the user
    const withTimeout = (promise, ms = 6000) => {
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
      });
      return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
    };

    // Combine system context + user question into a single user message
    // so the context is always re-injected regardless of session history
    const fullUserMessage = `${financialContext}\n\nUser Question: ${userMessage}`;

    let text = '';
    let generated = false;

    for (const modelName of MODEL_NAMES) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName, generationConfig });
        // Inject context in a chat with existing history
        const chat   = model.startChat({ history: trimmedHistory });
        const result = await withTimeout(chat.sendMessage(fullUserMessage), 6000);
        text      = result.response.text();
        generated = true;
        break;
      } catch (e) {
        console.warn(`[Chatbot] Model ${modelName} failed or timed out: ${e.message}`);
      }
    }

    if (!generated) {
      // Last-resort: plain generateContent with no chat history
      for (const modelName of MODEL_NAMES) {
        try {
          const model  = genAI.getGenerativeModel({ model: modelName, generationConfig });
          const result = await withTimeout(model.generateContent(fullUserMessage), 6000);
          text      = result.response.text();
          generated = true;
          break;
        } catch (_) { /* try next */ }
      }
    }

    if (!generated) throw new Error('All Gemini models unavailable.');

    return res.json({ answer: text, reply: text });

  } catch (error) {
    console.error('[Chatbot] Error:', error.message || error);
    const msg = `Unable to generate AI response: ${error.message || 'Check your API key or quota.'}`;
    return res.status(200).json({ answer: msg, reply: msg });
  }
});

// Catch-all route to redirect back to index.html for unrecognized routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}
module.exports = app;