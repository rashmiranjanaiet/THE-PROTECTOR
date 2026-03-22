# THE PROTECTOR

Full-stack real-time intelligence dashboard with:
- Login/register page
- 9 dashboard modules (Flight, ISRO, News, Disaster, Secure Message, Relief, Cloud Notes, Aryan AI, Live War)
- Floating `Aryan AI` assistant with voice input/output
- One-time secure message sharing with 16-digit code and optional image
- MongoDB persistence for users, notes, and secure message payloads
- Render-ready deployment config

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Create environment file:
```bash
copy .env.example .env
```

3. Fill `.env` values:
- `MONGODB_URI`
- `JWT_SECRET`
- `HF_API_KEY`
- API keys for flight/news/isro as needed
- SMTP credentials if you want secure-code email sending

4. Run:
```bash
npm start
```

Open `http://localhost:10000`

## Render Deployment

- `render.yaml` is included.
- In Render, set all secret environment variables marked with `sync: false`.
- Deploy as a Node web service.

## Notes On External Feeds

- Disaster feed (`menu 4`) is integrated with NASA EONET (`https://eonet.gsfc.nasa.gov/api/v3/events`).
- Relief feed (`menu 6`) is integrated with ReliefWeb.
- War feed (`menu 9`) scrapes marker-like coordinates from the configured LiveUAmap page and falls back gracefully if unavailable.
- Flight/ISRO/News endpoints support configurable provider URLs and API keys through environment variables.
- Flight module uses AirLabs live flight API when `AIRLABS_API_KEY` is set.

## Security

- Do not hardcode secrets in source code.
- Use Render environment variables in production.
- Rotate API keys if they were ever shared publicly.
