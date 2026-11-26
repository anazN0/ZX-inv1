# Zolvex Docs (free hosting version)
Data is stored in a free Turso database, so it survives restarts and redeploys. The web app runs on Render's free plan. No card needed.
## 1. Database (Turso)
turso.tech > sign up with GitHub > Create database (any name, nearest region) > copy its URL (starts libsql://) > create a token (Read & Write) and copy it.
## 2. Code
Private GitHub repo with the contents of this folder at the top level (render.yaml must be on the first page). No node_modules, no .env.
## 3. Render
New > Blueprint > pick the repo. Enter: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, ADMIN_EMAIL, ADMIN_PASSWORD. If Blueprint asks for a card, use New > Web Service instead: build `npm install`, start `npm start`, Free plan, add the same env vars plus NODE_ENV=production and JWT_SECRET (long random).
## 4. First login
Open the Render link, log in, change the password in Settings, add the team, set the UPI ID.
Note: the free web service sleeps after 15 minutes without use; the first open then takes about a minute. 
Local test: npm install, set JWT_SECRET/ADMIN_*, npm start. npm test checks GST maths.
