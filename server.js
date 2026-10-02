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
        return null;
      });
  }
  cached.conn = await cached.promise;
  return cached.conn;
};

connectWithRetry();

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

// Catch-all route to redirect back to index.html for unrecognized routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Express server locally
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));
}

module.exports = app;