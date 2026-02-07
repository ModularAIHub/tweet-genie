
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve('server/.env') });
console.log('CWD:', process.cwd());
console.log('GOOGLE_AI_API_KEY:', process.env.GOOGLE_AI_API_KEY ? '[SET]' : '[NOT SET]');
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GOOGLE_AI_API_KEY;
if (!apiKey) {
  console.error('GOOGLE_AI_API_KEY not set in environment.');
  process.exit(1);
}

const genai = new GoogleGenAI({ apiKey });

async function listModels() {
  try {
    const response = await genai.models.list();
    if (response.models && response.models.length > 0) {
      console.log('Available Gemini models:');
      response.models.forEach(model => {
        console.log(`- ${model.name} (description: ${model.description || 'n/a'})`);
      });
    } else {
      console.log('No models found for your API key.');
    }
  } catch (err) {
    console.error('Error listing Gemini models:', err.message || err);
  }
}

listModels();