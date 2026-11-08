import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes/api.js';
import './db.js'; // ensures schema is created on boot

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRouter);

app.listen(PORT, () => {
  console.log(`YouTube Summarizer running at http://localhost:${PORT}`);
});
