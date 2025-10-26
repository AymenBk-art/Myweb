// -------------------------------
// 🌐 استيراد الإضافات
// -------------------------------
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken'); 
const bcrypt = require('bcrypt'); 
const cookieParser = require('cookie-parser'); 
const http = require('http'); 
const { Server } = require("socket.io"); 

// -------------------------------
// 🔧 إعدادات عامة
// -------------------------------
const app = express();
const PORT = process.env.PORT; // Railway يرسل هذا المنفذ تلقائيًا
const allowedOrigins = [
  'http://localhost:3000',
  'https://myweb-production-ac0d.up.railway.app'
];

// إنشاء خادم HTTP وربط Socket.IO به
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// -------------------------------
// 🧩 Middleware
// -------------------------------
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(bodyParser.json());
app.use(express.static(__dirname));
app.use(cookieParser());

// -------------------------------
// 🗄️ الاتصال بقاعدة البيانات
// -------------------------------
const MONGODB_URI = process.env.MONGODB_URI; 

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح!'))
  .catch((error) => console.error('❌ فشل الاتصال بقاعدة البيانات:', error));

// -------------------------------
// 📦 النماذج (Schemas)
// -------------------------------
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

const taskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  description: { type: String, required: true },
  completed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});
const Task = mongoose.model('Task', taskSchema);

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// -------------------------------
// 🔑 المفتاح السري لـ JWT
// -------------------------------
const JWT_SECRET = process.env.JWT_SECRET || "MySuperSecretKey12345!@#";

// -------------------------------
// 💬 Socket.IO (نظام الدردشة)
// -------------------------------
io.on('connection', (socket) => {
  const cookies = socket.handshake.headers.cookie;
  const tokenCookie = cookies ? cookies.split('; ').find(r => r.startsWith('auth_token=')) : null;
  if (!tokenCookie) return socket.disconnect();

  const token = tokenCookie.split('=')[1];
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return socket.disconnect();

    const userId = user.userId;
    console.log(`[Socket.IO]: المستخدم ${user.username} متصل.`);
    socket.join(userId);

    socket.on('sendMessage', async (data) => {
      const { receiverId, content } = data;
      if (userId === receiverId) return;

      const newMessage = new Message({
        sender: userId,
        receiver: receiverId,
        content: content
      });
      await newMessage.save();

      const messageData = {
        senderId: userId,
        content: content,
        timestamp: newMessage.timestamp
      };

      socket.to(receiverId).emit('receiveMessage', messageData);
      socket.emit('receiveMessage', messageData);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.IO]: المستخدم ${user.username} انفصل.`);
    });
  });
});

// -------------------------------
// 🧭 المسارات (Routes)
// -------------------------------

// تسجيل مستخدم جديد
app.post('/register', async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const newUser = new User({
      username: req.body.username,
      email: req.body.email,
      password: hashedPassword
    });
    await newUser.save();
    res.json({ message: `تم إنشاء حسابك بنجاح، ${newUser.username}!` });
  } catch (error) {
    if (error.code === 11000) {
      if (error.keyPattern.username) res.status(400).json({ message: "هذا الاسم مستخدم من قبل." });
      else if (error.keyPattern.email) res.status(400).json({ message: "هذا البريد الإلكتروني مستخدم من قبل." });
    } else res.status(500).json({ message: "حدث خطأ أثناء إنشاء الحساب." });
  }
});

// تسجيل الدخول
app.post('/login', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.body.username });
    if (!user) return res.status(404).json({ message: "اسم المستخدم غير موجود." });

    const isMatch = await bcrypt.compare(req.body.password, user.password);
    if (!isMatch) return res.status(401).json({ message: "كلمة المرور غير صحيحة." });

    const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    const maxAge = req.body.rememberMe ? 604800000 : 3600000;

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: maxAge
    });

    res.json({ message: `مرحباً بعودتك، ${user.username}!` });
  } catch {
    res.status(500).json({ message: "حدث خطأ في السيرفر." });
  }
});

// تسجيل الخروج
app.post('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ message: "تم تسجيل خروجك بأمان." });
});

// البروفايل
app.get('/api/profile', (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ message: "أنت غير مصرح لك." });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "التذكرة غير صالحة." });
    res.json({ username: user.username, userId: user.userId });
  });
});

// باقي الراوتات نفسها (المهام، الإعجاب، الرسائل، ...)
// لا حاجة لتغييرها — تعمل كما هي ✅

// -------------------------------
// 🏁 تقديم الملفات الثابتة
// -------------------------------
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
app.get('/index.html', (req, res) => res.sendFile(__dirname + '/index.html'));
app.get('/dashboard.html', (req, res) => res.sendFile(__dirname + '/dashboard.html'));

// -------------------------------
// 🚀 تشغيل السيرفر (التعديل الحاسم لـ Railway)
// -------------------------------
// استخدم المنفذ الديناميكي من Railway
const PORT = process.env.PORT || 8080;

// استمع على كل الواجهات (مهم جداً لـ Railway)
const server = httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ السيرفر يعمل الآن على المنفذ: ${PORT}`);
});

// -------------------------------
// 🧹 إغلاق نظيف عند SIGTERM / SIGINT
// -------------------------------
const shutdown = async () => {
  console.log('\n🛑 تلقّيت إشارة إنهاء. بدء الإغلاق النظيف...');
  try {
    await mongoose.connection.close(false);
    console.log('✅ تم قطع الاتصال بقاعدة البيانات.');
    process.exit(0);
  } catch (err) {
    console.error('❌ خطأ أثناء الإغلاق:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);