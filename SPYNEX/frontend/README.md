# SPYNEX Frontend

Interactive financial crime network visualization and investigation cockpit built with **React 19**, **TypeScript**, **Vite**, and **Cytoscape.js**.

---

## Features
- **Triage Queue & Case Management:** Sort and filter cases by heuristic priority score, severity, and typology pattern.
- **Interactive Evidence Graph:** Canvas powered by Cytoscape.js with directional edge flows, role color coding, and reactive zoom/pan.
- **Autonomous Investigation Cockpit:** Multi-turn ReAct agent interaction with live Server-Sent Events (SSE) streaming and anti-hallucination citation checks.
- **9-Pattern Detection Workspace:** Live execution of graph detection engines with responsive side-by-side evidence inspection.
- **Transaction Explorer:** Direct account neighborhood graph exploration with 1-3 hop ego network visualizer.

---

## Local Development

```powershell
# Install dependencies
npm install

# Start Vite development server (http://localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

---

## Deployment (Vercel)

1. Set the **Root Directory** to `SPYNEX/frontend`.
2. Framework Preset: **Vite**.
3. Build Command: `npm run build`
4. Output Directory: `dist`
5. Configure Environment Variables:
   - `VITE_API_URL`: Your deployed Railway backend API base (e.g. `https://your-backend.railway.app/api`).
