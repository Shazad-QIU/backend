const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

// Allowed frontend origins for CORS
const ALLOWED_ORIGINS = [
  "https://shazaddev.netlify.app",
  "https://glittery-centaur-9e0116.netlify.app",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

// Data file paths
const DATA_DIR = path.join(__dirname, "data");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const KEYS_FILE = path.join(DATA_DIR, "keys.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(path.join(__dirname, "uploads"))) fs.mkdirSync(path.join(__dirname, "uploads"));
if (!fs.existsSync(path.join(__dirname, "uploads/previews"))) fs.mkdirSync(path.join(__dirname, "uploads/previews"), { recursive: true });
if (!fs.existsSync(path.join(__dirname, "uploads/products"))) fs.mkdirSync(path.join(__dirname, "uploads/products"), { recursive: true });

// Helper functions to read/write JSON
function readJSON(file) {
  try {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return []; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Initialize data files if they don't exist
if (!fs.existsSync(PRODUCTS_FILE)) writeJSON(PRODUCTS_FILE, []);
if (!fs.existsSync(KEYS_FILE)) writeJSON(KEYS_FILE, []);
if (!fs.existsSync(USERS_FILE)) writeJSON(USERS_FILE, [{ username: "admin", password: "admin123" }]);

// CORS configuration - MUST be before other middleware
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    console.log("[CORS] Blocked origin:", origin);
    return callback(new Error("Not allowed by CORS"), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
}));

// Handle preflight requests
app.options("*", cors());

// Trust proxy for Railway (required for secure cookies behind proxy)
app.set("trust proxy", 1);

app.use(express.json());

// Session configuration
app.use(session({
  secret: "edustore-secret-key-2024-very-long-random-string",
  resave: true,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: true,
    sameSite: "none",
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    path: "/"
  }
}));

// Auth middleware
function requireAuth(req, res, next) {
  console.log("[AUTH MIDDLEWARE] Checking session for:", req.path);
  console.log("[AUTH MIDDLEWARE] Session ID:", req.sessionID);
  console.log("[AUTH MIDDLEWARE] Session user:", req.session?.user);
  
  if (req.session && req.session.user && req.session.admin) {
    console.log("[AUTH MIDDLEWARE] Authorized");
    next();
  } else {
    console.log("[AUTH MIDDLEWARE] Unauthorized - no valid session");
    res.status(401).json({ error: "Unauthorized" });
  }
}

// Serve uploaded files only (images)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = file.fieldname === "previewImage" ? "uploads/previews" : "uploads/products";
    cb(null, path.join(__dirname, folder));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// =============== API Routes ===============

// Test route
app.get("/api/test", (req, res) => {
  res.json({ message: "Server is working!" });
});

// Get all products
app.get("/api/products", (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  res.json(products);
});

// Get single product
app.get("/api/products/:id", (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  const product = products.find(p => p.id === parseInt(req.params.id));
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
});

// Add new product
app.post("/api/products", requireAuth, upload.fields([
  { name: "previewImage", maxCount: 1 },
  { name: "productImage", maxCount: 1 }
]), (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  const newProduct = {
    id: Date.now(),
    title: req.body.title,
    description: req.body.description,
    price: parseFloat(req.body.price),
    stock: parseInt(req.body.stock) || 10,
    previewImage: req.files.previewImage ? "/uploads/previews/" + req.files.previewImage[0].filename : null,
    productImage: req.files.productImage ? "/uploads/products/" + req.files.productImage[0].filename : null,
    createdAt: new Date().toISOString()
  };
  products.push(newProduct);
  writeJSON(PRODUCTS_FILE, products);
  res.json(newProduct);
});

// Delete product
app.delete("/api/products/:id", requireAuth, (req, res) => {
  let products = readJSON(PRODUCTS_FILE);
  const id = parseInt(req.params.id);
  products = products.filter(p => p.id !== id);
  writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true });
});

// Get all keys
app.get("/api/keys", (req, res) => {
  const keys = readJSON(KEYS_FILE);
  res.json(keys);
});

// Generate keys for a product
app.post("/api/keys/generate", (req, res) => {
  const { productId, count } = req.body;
  const products = readJSON(PRODUCTS_FILE);
  const product = products.find(p => p.id === productId);
  
  if (!product) return res.status(404).json({ error: "Product not found" });
  
  const keys = readJSON(KEYS_FILE);
  const newKeys = [];
  
  for (let i = 0; i < (count || 1); i++) {
    const key = crypto.randomBytes(16).toString("hex").toUpperCase()
      .match(/.{4}/g).join("-");
    newKeys.push({
      key,
      productId,
      productTitle: product.title,
      status: "unused",
      createdAt: new Date().toISOString(),
      usedAt: null,
      usedBy: null
    });
  }
  
  keys.push(...newKeys);
  writeJSON(KEYS_FILE, keys);
  res.json(newKeys);
});

// Unlock product with key
app.post("/api/unlock", (req, res) => {
  const { key } = req.body;
  const keys = readJSON(KEYS_FILE);
  const products = readJSON(PRODUCTS_FILE);
  
  const keyIndex = keys.findIndex(k => k.key === key && k.status === "unused");
  
  if (keyIndex === -1) {
    return res.status(400).json({ error: "Invalid or already used key" });
  }
  
  const keyData = keys[keyIndex];
  const productIndex = products.findIndex(p => p.id === keyData.productId);
  
  if (productIndex === -1) {
    return res.status(404).json({ error: "Product not found" });
  }
  
  const product = products[productIndex];
  
  // Mark key as used
  keys[keyIndex].status = "used";
  keys[keyIndex].usedAt = new Date().toISOString();
  keys[keyIndex].usedBy = req.ip;
  writeJSON(KEYS_FILE, keys);
  
  // Decrease product stock
  if (products[productIndex].stock > 0) {
    products[productIndex].stock -= 1;
    writeJSON(PRODUCTS_FILE, products);
  }
  
  res.json({ 
    success: true, 
    product: {
      title: product.title,
      description: product.description,
      productImage: product.productImage
    }
  });
});

// Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  console.log("[LOGIN] Attempt for user:", username);
  
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.username === username && u.password === password);
  
  if (!user) {
    console.log("[LOGIN] Failed - invalid credentials");
    return res.status(401).json({ error: "Invalid credentials" });
  }
  
  // Set session data
  req.session.user = { username: user.username };
  req.session.admin = true;
  
  // Force session save before responding
  req.session.save((err) => {
    if (err) {
      console.log("[LOGIN] Session save error:", err);
      return res.status(500).json({ error: "Session error" });
    }
    console.log("[LOGIN] Success for user:", username);
    console.log("[LOGIN] Session ID:", req.sessionID);
    console.log("[LOGIN] Session data:", req.session);
    res.json({ success: true, username: user.username });
  });
});

// Check auth
app.get("/api/check-auth", (req, res) => {
  console.log("[CHECK-AUTH] Session ID:", req.sessionID);
  console.log("[CHECK-AUTH] Session data:", req.session);
  console.log("[CHECK-AUTH] Cookies:", req.headers.cookie);
  
  if (req.session && req.session.user && req.session.admin) {
    console.log("[CHECK-AUTH] Authenticated as:", req.session.user.username);
    res.json({ authenticated: true, user: req.session.user });
  } else {
    console.log("[CHECK-AUTH] Not authenticated");
    res.json({ authenticated: false });
  }
});

// Logout
app.post("/api/logout", (req, res) => {
  console.log("[LOGOUT] Destroying session:", req.sessionID);
  req.session.destroy((err) => {
    if (err) {
      console.log("[LOGOUT] Error:", err);
    }
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// =============== Admin Routes ===============

// Admin stats
app.get("/api/admin/stats", requireAuth, (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  const keys = readJSON(KEYS_FILE);
  const totalStock = products.reduce((sum, p) => sum + (p.stock || 0), 0);
  
  res.json({
    totalProducts: products.length,
    totalKeys: keys.length,
    usedKeys: keys.filter(k => k.status === "used").length,
    unusedKeys: keys.filter(k => k.status === "unused").length,
    totalStock
  });
});

// Admin get products
app.get("/api/admin/products", requireAuth, (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  res.json(products);
});

// Admin add product
app.post("/api/admin/products", requireAuth, upload.fields([
  { name: "previewImage", maxCount: 1 },
  { name: "productImage", maxCount: 1 }
]), (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  const newProduct = {
    id: Date.now(),
    title: req.body.title,
    description: req.body.description,
    price: parseFloat(req.body.price),
    stock: parseInt(req.body.stock) || 10,
    previewImage: req.files && req.files.previewImage ? "/uploads/previews/" + req.files.previewImage[0].filename : null,
    productImage: req.files && req.files.productImage ? "/uploads/products/" + req.files.productImage[0].filename : null,
    createdAt: new Date().toISOString()
  };
  products.push(newProduct);
  writeJSON(PRODUCTS_FILE, products);
  res.json(newProduct);
});

// Admin delete product
app.delete("/api/admin/products/:id", requireAuth, (req, res) => {
  let products = readJSON(PRODUCTS_FILE);
  const id = parseInt(req.params.id);
  products = products.filter(p => p.id !== id);
  writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true });
});

// Admin edit product
app.put("/api/admin/products/:id", requireAuth, upload.fields([
  { name: "previewImage", maxCount: 1 },
  { name: "productImage", maxCount: 1 }
]), (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  const id = parseInt(req.params.id);
  const index = products.findIndex(p => p.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Product not found" });
  }

  const existing = products[index];
  const updatedProduct = {
    ...existing,
    title: req.body.title ?? existing.title,
    description: req.body.description ?? existing.description,
    price: req.body.price !== undefined ? parseFloat(req.body.price) : existing.price,
    stock: req.body.stock !== undefined ? parseInt(req.body.stock) : existing.stock,
    previewImage: req.files && req.files.previewImage
      ? "/uploads/previews/" + req.files.previewImage[0].filename
      : existing.previewImage,
    productImage: req.files && req.files.productImage
      ? "/uploads/products/" + req.files.productImage[0].filename
      : existing.productImage
  };

  products[index] = updatedProduct;
  writeJSON(PRODUCTS_FILE, products);
  res.json(updatedProduct);
});

// Admin get keys
app.get("/api/admin/keys", requireAuth, (req, res) => {
  const keys = readJSON(KEYS_FILE);
  res.json(keys);
});

// Admin generate keys
app.post("/api/admin/keys/generate", requireAuth, (req, res) => {
  const { productId, quantity } = req.body;
  const products = readJSON(PRODUCTS_FILE);
  const product = products.find(p => p.id === parseInt(productId));
  
  if (!product) return res.status(404).json({ error: "Product not found" });
  
  const keys = readJSON(KEYS_FILE);
  const newKeys = [];
  const count = parseInt(quantity) || 1;
  
  for (let i = 0; i < count; i++) {
    const key = crypto.randomBytes(16).toString("hex").toUpperCase()
      .match(/.{4}/g).join("-");
    newKeys.push({
      key,
      productId: parseInt(productId),
      productTitle: product.title,
      status: "unused",
      createdAt: new Date().toISOString(),
      usedAt: null,
      usedBy: null
    });
  }
  
  keys.push(...newKeys);
  writeJSON(KEYS_FILE, keys);
  res.json(newKeys);
});

// Admin delete key
app.delete("/api/admin/keys/:key", requireAuth, (req, res) => {
  let keys = readJSON(KEYS_FILE);
  const keyToDelete = keys.find(k => k.key === req.params.key);
  
  // If deleting an unused key, increase product stock back
  if (keyToDelete && keyToDelete.status === "unused") {
    const products = readJSON(PRODUCTS_FILE);
    const productIndex = products.findIndex(p => p.id === keyToDelete.productId);
    if (productIndex !== -1) {
      products[productIndex].stock += 1;
      writeJSON(PRODUCTS_FILE, products);
    }
  }
  
  keys = keys.filter(k => k.key !== req.params.key);
  writeJSON(KEYS_FILE, keys);
  res.json({ success: true });
});

// Stats for admin (public version)
app.get("/api/stats", (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  const keys = readJSON(KEYS_FILE);
  
  res.json({
    totalProducts: products.length,
    totalKeys: keys.length,
    usedKeys: keys.filter(k => k.status === "used").length,
    unusedKeys: keys.filter(k => k.status === "unused").length
  });
});

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`API Server running on http://localhost:${PORT}`);
});
