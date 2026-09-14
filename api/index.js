// Vercel (and any other serverless host) entry point.
//
// Vercel doesn't run `npm start`; it imports a handler. Without this file it
// would serve public/index.html as a static page and 404 every /api/ call, so
// the screen would load and nothing on it would work.
//
// dotenv is harmless here — on Vercel the values come from the project's
// environment settings, and there's no .env file to read.
require('dotenv').config();
module.exports = require('../src/app');
