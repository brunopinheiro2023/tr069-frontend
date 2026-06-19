const fs = require('fs');
const file = 'c:/Users/Bruno/Documents/nodejs/tr069-inova/src/server.js';
let content = fs.readFileSync(file, 'utf8');
const search = "const isProduction = process.env.NODE_ENV === 'production';";
const replace = search + `

// Configuração de CORS para a API REST
app.use(cors({
  origin: isProduction ? CORS_ORIGIN : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));`;

if (!content.includes('// Configuração de CORS para a API REST')) {
    content = content.replace(search, replace);
    fs.writeFileSync(file, content, 'utf8');
    console.log('CORS added successfully.');
} else {
    console.log('CORS already configured.');
}
