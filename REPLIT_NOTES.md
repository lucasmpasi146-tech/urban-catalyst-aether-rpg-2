# Replit deployment notes

This repository is a Node.js web service, not a static-only site. Use `npm start` as the run/deploy command and connect a PostgreSQL database.

Required Secrets / Environment variables:
- `NODE_ENV=production`
- `DATABASE_URL` = private PostgreSQL connection string
- `SESSION_SECRET` = long random secret, 32+ characters
- `REGISTRATION_CODE` = private signup code, 12+ characters (32+ recommended)
- `SINGLE_PLAYER_MODE=true` = allow only one account to register, for private play
- `PORT` is usually provided by the platform; the app reads it automatically.

The app listens on `0.0.0.0` and uses `/api/health` as its health endpoint. Do not put database credentials, session secrets, or the registration code in `public/index.html`.
