# AI Voice Agent - Frontend

React + TypeScript + Vite frontend for the AI Voice Agent appointment booking system.

## Quick Start

```bash
npm install
npm run dev
```

Frontend runs on http://localhost:5173

## Environment Variables

```bash
VITE_API_URL=http://localhost:5000  # Backend URL
```

For production, update `VITE_API_URL` to your deployed backend URL.

## Build

```bash
npm run build
```

Output: `dist/` folder

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Connect repo to Vercel
3. Framework: Vite
4. Set `VITE_API_URL` environment variable to your backend URL
5. Deploy

### Netlify

1. Push to GitHub
2. Connect repo to Netlify
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Add `VITE_API_URL` environment variable
6. Deploy

## License

MIT
