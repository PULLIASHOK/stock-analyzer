const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Database = require('better-sqlite3');
const schedule = require('node-schedule');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Database setup
const db = new Database('trading.db');

// Initialize database tables
function initDb() {
    // Users table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            balance REAL DEFAULT 10000.0,
            loan_amount REAL DEFAULT 0.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Stocks table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS stocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            current_price REAL NOT NULL,
            available_quantity INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Stock price history
    db.prepare(`
        CREATE TABLE IF NOT EXISTS stock_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_id INTEGER NOT NULL,
            price REAL NOT NULL,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (stock_id) REFERENCES stocks(id)
        )
    `).run();

    // User transactions
    db.prepare(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            stock_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            type TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (stock_id) REFERENCES stocks(id)
        )
    `).run();

    // User holdings
    db.prepare(`
        CREATE TABLE IF NOT EXISTS holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            stock_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            average_buy_price REAL NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (stock_id) REFERENCES stocks(id),
            UNIQUE(user_id, stock_id)
        )
    `).run();
}

initDb();

// Helper functions
function updateStockPrices() {
    const stocks = db.prepare("SELECT id, current_price FROM stocks").all();
    
    for (const stock of stocks) {
        const currentPrice = stock.current_price;
        // Random price change between -5% and +5%
        const changeFactor = 1 + (Math.random() * 0.1 - 0.05);
        let newPrice = parseFloat((currentPrice * changeFactor).toFixed(2));
        
        // Ensure price stays between 1 and 100
        newPrice = Math.max(1.0, Math.min(100.0, newPrice));
        
        db.prepare(
            "UPDATE stocks SET current_price = ? WHERE id = ?"
        ).run(newPrice, stock.id);
        
        // Record price history
        db.prepare(
            "INSERT INTO stock_history (stock_id, price) VALUES (?, ?)"
        ).run(stock.id, newPrice);
    }
    
    console.log("Stock prices updated at", new Date());
}

// Schedule stock price updates every 5 minutes
const priceUpdateJob = schedule.scheduleJob('*/5 * * * *', updateStockPrices);

// API Endpoints

/**
 * @swagger
 * /stocks/register:
 *   post:
 *     summary: Register a new stock
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               symbol:
 *                 type: string
 *               name:
 *                 type: string
 *               current_price:
 *                 type: number
 *               available_quantity:
 *                 type: integer
 *     responses:
 *       200:
 *         description: The created stock
 */
app.post('/stocks/register', (req, res) => {
    const { symbol, name, current_price, available_quantity } = req.body;
    
    try {
        const result = db.prepare(
            "INSERT INTO stocks (symbol, name, current_price, available_quantity) VALUES (?, ?, ?, ?)"
        ).run(symbol, name, current_price, available_quantity);
        
        const stockId = result.lastInsertRowid;
        
        // Record initial price in history
        db.prepare(
            "INSERT INTO stock_history (stock_id, price) VALUES (?, ?)"
        ).run(stockId, current_price);
        
        const newStock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stockId);
        res.json(newStock);
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            res.status(400).json({ error: "Stock symbol already exists" });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

/**
 * @swagger
 * /stocks/history/{stock_id}:
 *   get:
 *     summary: Get price history for a stock
 *     parameters:
 *       - in: path
 *         name: stock_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of price history records
 */
app.get('/stocks/history/:stock_id', (req, res) => {
    const { stock_id } = req.params;
    const limit = req.query.limit || 100;
    
    const history = db.prepare(
        "SELECT * FROM stock_history WHERE stock_id = ? ORDER BY recorded_at DESC LIMIT ?"
    ).all(stock_id, limit);
    
    res.json(history);
});

/**
 * @swagger
 * /users/create:
 *   post:
 *     summary: Create a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *     responses:
 *       200:
 *         description: The created user
 */
app.post('/users/create', (req, res) => {
    const { username } = req.body;
    
    try {
        const result = db.prepare(
            "INSERT INTO users (username) VALUES (?)"
        ).run(username);
        
        const userId = result.lastInsertRowid;
        const newUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
        res.json(newUser);
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            res.status(400).json({ error: "Username already exists" });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

/**
 * @swagger
 * /users/loan:
 *   post:
 *     summary: Take a loan
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               user_id:
 *                 type: integer
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Updated user information
 */
app.post('/users/loan', (req, res) => {
    const { user_id, amount } = req.body;
    
    // Get current user data
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(user_id);
    
    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }
    
    // Check if loan amount is valid
    if (amount <= 0) {
        return res.status(400).json({ error: "Loan amount must be positive" });
    }
    
    if (user.loan_amount + amount > 100000) {
        return res.status(400).json({ error: "Total loan cannot exceed 100,000" });
    }
    
    // Update user balance and loan amount
    const newBalance = user.balance + amount;
    const newLoanAmount = user.loan_amount + amount;
    
    db.prepare(
        "UPDATE users SET balance = ?, loan_amount = ? WHERE id = ?"
    ).run(newBalance, newLoanAmount, user_id);
    
    const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(user_id);
    res.json(updatedUser);
});

/**
 * @swagger
 * /users/buy:
 *   post:
 *     summary: Buy stocks
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               user_id:
 *                 type: integer
 *               stock_id:
 *                 type: integer
 *               quantity:
 *                 type: integer
 *     responses:
 *       200:
 *         description: The transaction record
 */
app.post('/users/buy', (req, res) => {
    const { user_id, stock_id, quantity } = req.body;
    
    try {
        // Start transaction
        db.prepare("BEGIN").run();
        
        // Get user and stock data
        const user = db.prepare("SELECT * FROM users WHERE id = ?").get(user_id);
        const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock_id);
        
        if (!user || !stock) {
            throw new Error("User or stock not found");
        }
        
        if (quantity <= 0) {
            throw new Error("Quantity must be positive");
        }
        
        if (stock.available_quantity < quantity) {
            throw new Error("Not enough stock available");
        }
        
        const totalCost = stock.current_price * quantity;
        
        if (user.balance < totalCost) {
            throw new Error("Insufficient funds");
        }
        
        // Update user balance
        db.prepare(
            "UPDATE users SET balance = balance - ? WHERE id = ?"
        ).run(totalCost, user_id);
        
        // Update stock available quantity
        db.prepare(
            "UPDATE stocks SET available_quantity = available_quantity - ? WHERE id = ?"
        ).run(quantity, stock_id);
        
        // Record transaction
        const result = db.prepare(
            "INSERT INTO transactions (user_id, stock_id, quantity, price, type) VALUES (?, ?, ?, ?, ?)"
        ).run(user_id, stock_id, quantity, stock.current_price, 'buy');
        
        const transactionId = result.lastInsertRowid;
        
        // Update or create holding
        const holding = db.prepare(
            "SELECT * FROM holdings WHERE user_id = ? AND stock_id = ?"
        ).get(user_id, stock_id);
        
        if (holding) {
            const newQuantity = holding.quantity + quantity;
            const newAvgPrice = ((holding.average_buy_price * holding.quantity) + 
                               (stock.current_price * quantity)) / newQuantity;
            
            db.prepare(
                "UPDATE holdings SET quantity = ?, average_buy_price = ? WHERE id = ?"
            ).run(newQuantity, newAvgPrice, holding.id);
        } else {
            db.prepare(
                "INSERT INTO holdings (user_id, stock_id, quantity, average_buy_price) VALUES (?, ?, ?, ?)"
            ).run(user_id, stock_id, quantity, stock.current_price);
        }
        
        db.prepare("COMMIT").run();
        
        const transaction = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId);
        res.json(transaction);
    } catch (err) {
        db.prepare("ROLLBACK").run();
        res.status(400).json({ error: err.message });
    }
});

/**
 * @swagger
 * /users/sell:
 *   post:
 *     summary: Sell stocks
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               user_id:
 *                 type: integer
 *               stock_id:
 *                 type: integer
 *               quantity:
 *                 type: integer
 *     responses:
 *       200:
 *         description: The transaction record
 */
app.post('/users/sell', (req, res) => {
    const { user_id, stock_id, quantity } = req.body;
    
    try {
        // Start transaction
        db.prepare("BEGIN").run();
        
        // Get user and stock data
        const user = db.prepare("SELECT * FROM users WHERE id = ?").get(user_id);
        const stock = db.prepare("SELECT * FROM stocks WHERE id = ?").get(stock_id);
        
        if (!user || !stock) {
            throw new Error("User or stock not found");
        }
        
        if (quantity <= 0) {
            throw new Error("Quantity must be positive");
        }
        
        // Check if user has enough shares to sell
        const holding = db.prepare(
            "SELECT * FROM holdings WHERE user_id = ? AND stock_id = ?"
        ).get(user_id, stock_id);
        
        if (!holding || holding.quantity < quantity) {
            throw new Error("Not enough shares to sell");
        }
        
        const totalValue = stock.current_price * quantity;
        
        // Update user balance
        db.prepare(
            "UPDATE users SET balance = balance + ? WHERE id = ?"
        ).run(totalValue, user_id);
        
        // Update stock available quantity
        db.prepare(
            "UPDATE stocks SET available_quantity = available_quantity + ? WHERE id = ?"
        ).run(quantity, stock_id);
        
        // Record transaction
        const result = db.prepare(
            "INSERT INTO transactions (user_id, stock_id, quantity, price, type) VALUES (?, ?, ?, ?, ?)"
        ).run(user_id, stock_id, quantity, stock.current_price, 'sell');
        
        const transactionId = result.lastInsertRowid;
        
        // Update holding
        const newQuantity = holding.quantity - quantity;
        
        if (newQuantity === 0) {
            db.prepare(
                "DELETE FROM holdings WHERE id = ?"
            ).run(holding.id);
        } else {
            db.prepare(
                "UPDATE holdings SET quantity = ? WHERE id = ?"
            ).run(newQuantity, holding.id);
        }
        
        db.prepare("COMMIT").run();
        
        const transaction = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transactionId);
        res.json(transaction);
    } catch (err) {
        db.prepare("ROLLBACK").run();
        res.status(400).json({ error: err.message });
    }
});

/**
 * @swagger
 * /users/report/{user_id}:
 *   get:
 *     summary: Get user profit/loss report
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User report
 */
app.get('/users/report/:user_id', (req, res) => {
    const { user_id } = req.params;
    
    // Get user data
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(user_id);
    
    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }
    
    // Get user holdings with current prices
    const holdings = db.prepare(`
        SELECT h.*, s.current_price 
        FROM holdings h
        JOIN stocks s ON h.stock_id = s.id
        WHERE h.user_id = ?
    `).all(user_id);
    
    // Calculate portfolio value and P&L
    let portfolioValue = 0.0;
    let totalProfitLoss = 0.0;
    
    for (const holding of holdings) {
        const currentValue = holding.current_price * holding.quantity;
        const costBasis = holding.average_buy_price * holding.quantity;
        const profitLoss = currentValue - costBasis;
        
        portfolioValue += currentValue;
        totalProfitLoss += profitLoss;
    }
    
    // Calculate P&L percentage
    const initialBalance = 10000.0;  // Starting balance
    const currentBalance = user.balance + portfolioValue - user.loan_amount;
    const profitLossPercentage = ((currentBalance - initialBalance) / initialBalance) * 100;
    
    res.json({
        user_id: parseInt(user_id),
        username: user.username,
        initial_balance: initialBalance,
        current_balance: user.balance,
        loan_amount: user.loan_amount,
        portfolio_value: portfolioValue,
        total_profit_loss: totalProfitLoss,
        profit_loss_percentage: profitLossPercentage
    });
});

/**
 * @swagger
 * /stocks/report:
 *   get:
 *     summary: Get stock performance report
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of stock reports
 */
app.get('/stocks/report', (req, res) => {
    const limit = req.query.limit || 10;
    
    // Get all stocks with their first and current price
    const stocks = db.prepare(`
        SELECT s.id, s.symbol, s.name, s.current_price,
               (SELECT sh.price FROM stock_history sh 
                WHERE sh.stock_id = s.id 
                ORDER BY sh.recorded_at ASC LIMIT 1) as start_price,
               (SELECT COUNT(*) FROM transactions t 
                WHERE t.stock_id = s.id) as total_volume
        FROM stocks s
        ORDER BY s.id DESC
        LIMIT ?
    `).all(limit);
    
    const reports = stocks.map(stock => {
        const priceChange = stock.current_price - stock.start_price;
        const priceChangePercentage = (priceChange / stock.start_price) * 100;
        
        return {
            stock_id: stock.id,
            symbol: stock.symbol,
            name: stock.name,
            start_price: stock.start_price,
            current_price: stock.current_price,
            price_change: priceChange,
            price_change_percentage: priceChangePercentage,
            total_volume: stock.total_volume
        };
    });
    
    res.json(reports);
});

/**
 * @swagger
 * /users/top:
 *   get:
 *     summary: Get top performing users
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of top users
 */
app.get('/users/top', (req, res) => {
    const limit = req.query.limit || 5;
    
    // Get all users with their reports
    const userIds = db.prepare("SELECT id FROM users").all().map(row => row.id);
    
    const reports = userIds.map(userId => {
        const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
        
        // Get user holdings with current prices
        const holdings = db.prepare(`
            SELECT h.*, s.current_price 
            FROM holdings h
            JOIN stocks s ON h.stock_id = s.id
            WHERE h.user_id = ?
        `).all(userId);
        
        // Calculate portfolio value and P&L
        let portfolioValue = 0.0;
        let totalProfitLoss = 0.0;
        
        for (const holding of holdings) {
            const currentValue = holding.current_price * holding.quantity;
            const costBasis = holding.average_buy_price * holding.quantity;
            const profitLoss = currentValue - costBasis;
            
            portfolioValue += currentValue;
            totalProfitLoss += profitLoss;
        }
        
        // Calculate P&L percentage
        const initialBalance = 10000.0;
        const currentBalance = user.balance + portfolioValue - user.loan_amount;
        const profitLossPercentage = ((currentBalance - initialBalance) / initialBalance) * 100;
        
        return {
            user_id: userId,
            username: user.username,
            initial_balance: initialBalance,
            current_balance: user.balance,
            loan_amount: user.loan_amount,
            portfolio_value: portfolioValue,
            total_profit_loss: totalProfitLoss,
            profit_loss_percentage: profitLossPercentage
        };
    });
    
    // Sort by profit_loss_percentage descending
    reports.sort((a, b) => b.profit_loss_percentage - a.profit_loss_percentage);
    
    res.json(reports.slice(0, limit));
});

/**
 * @swagger
 * /stocks/top:
 *   get:
 *     summary: Get top performing stocks
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of top stocks
 */
app.get('/stocks/top', (req, res) => {
    const limit = req.query.limit || 5;
    
    // Get stock reports
    const reports = db.prepare(`
        SELECT s.id, s.symbol, s.name, s.current_price,
               (SELECT sh.price FROM stock_history sh 
                WHERE sh.stock_id = s.id 
                ORDER BY sh.recorded_at ASC LIMIT 1) as start_price
        FROM stocks s
    `).all().map(stock => {
        const priceChange = stock.current_price - stock.start_price;
        const priceChangePercentage = (priceChange / stock.start_price) * 100;
        
        return {
            stock_id: stock.id,
            symbol: stock.symbol,
            name: stock.name,
            start_price: stock.start_price,
            current_price: stock.current_price,
            price_change: priceChange,
            price_change_percentage: priceChangePercentage
        };
    });
    
    // Sort by price_change_percentage descending
    reports.sort((a, b) => b.price_change_percentage - a.price_change_percentage);
    
    res.json(reports.slice(0, limit));
});

/**
 * @swagger
 * /simulate/trading:
 *   get:
 *     summary: Simulate users trading
 *     parameters:
 *       - in: query
 *         name: num_users
 *         schema:
 *           type: integer
 *       - in: query
 *         name: num_trades
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Simulation started message
 */
app.get('/simulate/trading', (req, res) => {
    const numUsers = parseInt(req.query.num_users) || 5;
    const numTrades = parseInt(req.query.num_trades) || 10;
    
    // Run simulation in the background
    setTimeout(() => simulateUsersTrading(numUsers, numTrades), 0);
    
    res.json({ 
        message: `Simulation started with ${numUsers} users making ${numTrades} trades each` 
    });
});

// Test function to simulate users trading
function simulateUsersTrading(numUsers = 5, numTrades = 10) {
    // Create test users if they don't exist
    const users = [];
    for (let i = 0; i < numUsers; i++) {
        const username = `trader_${i+1}`;
        try {
            const result = db.prepare(
                "INSERT INTO users (username) VALUES (?)"
            ).run(username);
            users.push(result.lastInsertRowid);
        } catch (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
                users.push(user.id);
            }
        }
    }
    
    // Get all stocks
    let stocks = db.prepare("SELECT id, current_price, available_quantity FROM stocks").all();
    
    if (stocks.length === 0) {
        // Create some test stocks if none exist
        const testStocks = [
            ["AAPL", "Apple Inc.", 150.0, 1000],
            ["GOOGL", "Alphabet Inc.", 2800.0, 500],
            ["MSFT", "Microsoft Corp.", 300.0, 800],
            ["AMZN", "Amazon.com Inc.", 3300.0, 300],
            ["TSLA", "Tesla Inc.", 700.0, 600]
        ];
        
        for (const [symbol, name, price, quantity] of testStocks) {
            const result = db.prepare(
                "INSERT INTO stocks (symbol, name, current_price, available_quantity) VALUES (?, ?, ?, ?)"
            ).run(symbol, name, price, quantity);
            
            const stockId = result.lastInsertRowid;
            db.prepare(
                "INSERT INTO stock_history (stock_id, price) VALUES (?, ?)"
            ).run(stockId, price);
        }
        
        stocks = db.prepare("SELECT id, current_price, available_quantity FROM stocks").all();
    }
    
    // Simulate trades
    for (let i = 0; i < numTrades; i++) {
        for (const userId of users) {
            try {
                // Randomly decide to buy or sell (70% buy, 30% sell)
                if (Math.random() < 0.7) {
                    // Buy
                    const stock = stocks[Math.floor(Math.random() * stocks.length)];
                    const maxAffordable = Math.floor((10000 * 5) / stock.current_price); // Assume users have up to 5x initial balance
                    const quantity = Math.floor(Math.random() * Math.min(10, maxAffordable, stock.available_quantity)) + 1;
                    
                    if (quantity > 0 && stock.available_quantity >= quantity) {
                        // Execute buy
                        const totalCost = stock.current_price * quantity;
                        
                        db.prepare("BEGIN").run();
                        
                        const updateUser = db.prepare(
                            "UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?"
                        ).run(totalCost, userId, totalCost);
                        
                        if (updateUser.changes > 0) {
                            db.prepare(
                                "UPDATE stocks SET available_quantity = available_quantity - ? WHERE id = ?"
                            ).run(quantity, stock.id);
                            
                            db.prepare(
                                "INSERT INTO transactions (user_id, stock_id, quantity, price, type) VALUES (?, ?, ?, ?, ?)"
                            ).run(userId, stock.id, quantity, stock.current_price, 'buy');
                            
                            // Update holdings
                            const holding = db.prepare(
                                "SELECT * FROM holdings WHERE user_id = ? AND stock_id = ?"
                            ).get(userId, stock.id);
                            
                            if (holding) {
                                const newQuantity = holding.quantity + quantity;
                                const newAvgPrice = ((holding.average_buy_price * holding.quantity) + 
                                                   (stock.current_price * quantity)) / newQuantity;
                                
                                db.prepare(
                                    "UPDATE holdings SET quantity = ?, average_buy_price = ? WHERE id = ?"
                                ).run(newQuantity, newAvgPrice, holding.id);
                            } else {
                                db.prepare(
                                    "INSERT INTO holdings (user_id, stock_id, quantity, average_buy_price) VALUES (?, ?, ?, ?)"
                                ).run(userId, stock.id, quantity, stock.current_price);
                            }
                        }
                        
                        db.prepare("COMMIT").run();
                    }
                } else {
                    // Sell
                    db.prepare("BEGIN").run();
                    
                    const holdings = db.prepare(
                        "SELECT h.*, s.current_price FROM holdings h JOIN stocks s ON h.stock_id = s.id WHERE h.user_id = ?"
                    ).all(userId);
                    
                    if (holdings.length > 0) {
                        const holding = holdings[Math.floor(Math.random() * holdings.length)];
                        const quantity = Math.floor(Math.random() * holding.quantity) + 1;
                        
                        // Execute sell
                        const totalValue = holding.current_price * quantity;
                        
                        db.prepare(
                            "UPDATE users SET balance = balance + ? WHERE id = ?"
                        ).run(totalValue, userId);
                        
                        db.prepare(
                            "UPDATE stocks SET available_quantity = available_quantity + ? WHERE id = ?"
                        ).run(quantity, holding.stock_id);
                        
                        db.prepare(
                            "INSERT INTO transactions (user_id, stock_id, quantity, price, type) VALUES (?, ?, ?, ?, ?)"
                        ).run(userId, holding.stock_id, quantity, holding.current_price, 'sell');
                        
                        // Update holding
                        const newQuantity = holding.quantity - quantity;
                        
                        if (newQuantity === 0) {
                            db.prepare(
                                "DELETE FROM holdings WHERE id = ?"
                            ).run(holding.id);
                        } else {
                            db.prepare(
                                "UPDATE holdings SET quantity = ? WHERE id = ?"
                            ).run(newQuantity, holding.id);
                        }
                    }
                    
                    db.prepare("COMMIT").run();
                }
            } catch (err) {
                db.prepare("ROLLBACK").run();
                console.error(`Error in trade simulation: ${err.message}`);
            }
        }
    }
}

// Create swagger.json file
const fs = require('fs');
const swaggerJson = {
    openapi: "3.0.0",
    info: {
        title: "Stock Trading Simulation API",
        version: "1.0.0",
        description: "API for simulating stock trading with multiple users"
    },
    servers: [
        {
            url: `http://localhost:${PORT}`
        }
    ],
    paths: {
        "/stocks/register": {
            post: {
                summary: "Register a new stock",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    symbol: { type: "string" },
                                    name: { type: "string" },
                                    current_price: { type: "number" },
                                    available_quantity: { type: "integer" }
                                }
                            }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "The created stock"
                    }
                }
            }
        },
        "/stocks/history/{stock_id}": {
            get: {
                summary: "Get price history for a stock",
                parameters: [
                    {
                        in: "path",
                        name: "stock_id",
                        required: true,
                        schema: { type: "integer" }
                    }
                ],
                responses: {
                    "200": {
                        description: "List of price history records"
                    }
                }
            }
        },
        "/users/create": {
            post: {
                summary: "Create a new user",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    username: { type: "string" }
                                }
                            }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "The created user"
                    }
                }
            }
        },
        "/users/loan": {
            post: {
                summary: "Take a loan",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    user_id: { type: "integer" },
                                    amount: { type: "number" }
                                }
                            }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "Updated user information"
                    }
                }
            }
        },
        "/users/buy": {
            post: {
                summary: "Buy stocks",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    user_id: { type: "integer" },
                                    stock_id: { type: "integer" },
                                    quantity: { type: "integer" }
                                }
                            }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "The transaction record"
                    }
                }
            }
        },
        "/users/sell": {
            post: {
                summary: "Sell stocks",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    user_id: { type: "integer" },
                                    stock_id: { type: "integer" },
                                    quantity: { type: "integer" }
                                }
                            }
                        }
                    }
                },
                responses: {
                    "200": {
                        description: "The transaction record"
                    }
                }
            }
        },
        "/users/report/{user_id}": {
            get: {
                summary: "Get user profit/loss report",
                parameters: [
                    {
                        in: "path",
                        name: "user_id",
                        required: true,
                        schema: { type: "integer" }
                    }
                ],
                responses: {
                    "200": {
                        description: "User report"
                    }
                }
            }
        },
        "/stocks/report": {
            get: {
                summary: "Get stock performance report",
                parameters: [
                    {
                        in: "query",
                        name: "limit",
                        schema: { type: "integer" }
                    }
                ],
                responses: {
                    "200": {
                        description: "List of stock reports"
                    }
                }
            }
        },
        "/users/top": {
            get: {
                summary: "Get top performing users",
                parameters: [
                    {
                        in: "query",
                        name: "limit",
                        schema: { type: "integer" }
                    }
                ],
                responses: {
                    "200": {
                        description: "List of top users"
                    }
                }
            }
        },
        "/stocks/top": {
            get: {
                summary: "Get top performing stocks",
                parameters: [
                    {
                        in: "query",
                        name: "limit",
                        schema: { type: "integer" }
                    }
                ],
                responses: {
                    "200": {
                        description: "List of top stocks"
                    }
                }
            }
        },
        "/simulate/trading": {
            get: {
                summary: "Simulate users trading",
                parameters: [
                    {
                        in: "query",
                        name: "num_users",
                        schema: { type: "integer" }
                    },
                    {
                        in: "query",
                        name: "num_trades",
                        schema: { type: "integer" }
                    }
                ],
                responses: {
                    "200": {
                        description: "Simulation started message"
                    }
                }
            }
        }
    }
};

fs.writeFileSync(path.join(__dirname, 'swagger.json'), JSON.stringify(swaggerJson, null, 2));

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API documentation available at http://localhost:${PORT}/api-docs`);
});