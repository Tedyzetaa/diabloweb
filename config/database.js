const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'diablo_web';

async function connectDB() {
  if (cachedClient && cachedDb) {
    return cachedDb;
  }

  try {
    console.log('🔌 Conectando ao MongoDB Atlas...');
    
    const client = new MongoClient(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      tls: true,
      tlsAllowInvalidCertificates: false,
      retryWrites: true,
      w: 'majority',
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    });

    await client.connect();
    
    console.log('✅ MongoDB Atlas conectado com sucesso!');
    
    const db = client.db(DB_NAME);
    
    // Teste a conexão
    await db.command({ ping: 1 });
    console.log('📊 Ping no MongoDB realizado com sucesso');

    cachedClient = client;
    cachedDb = db;

    return db;
  } catch (error) {
    console.error('❌ ERRO de conexão MongoDB:', error.message);
    console.log('💡 Verifique:');
    console.log('   - String de conexão no Render');
    console.log('   - Usuário/senha do MongoDB Atlas');
    console.log('   - Network Access (0.0.0.0/0)');
    process.exit(1);
  }
}

module.exports = connectDB;