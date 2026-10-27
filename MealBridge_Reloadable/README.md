# MealBridge Reloadable Starter

This is a fresh, simple frontend + backend starter for MealBridge, with Customer, Restaurant, and Delivery Partner sections. The care-center donation form is in the Restaurant section.

## Requirements
- Node.js 18 or newer
- npm
- Python (only used to serve the static frontend; alternatively use VS Code Live Server)

## Start backend (Terminal 1)
```powershell
cd backend
npm install
npm start
```
API runs at http://localhost:4000. Check http://localhost:4000/api/health.

## Start frontend (Terminal 2)
From the project root:
```powershell
cd frontend
python -m http.server 5173
```
Open http://localhost:5173.

## Features
- Three navigation sections: Customer, Restaurant, Delivery Partner
- Restaurant can create a standard food listing
- Restaurant can submit extra-food donations for orphanages, nurseries/childcare centers, children's NGOs, or food banks
- SQLite persistence for listings and care donations
- Donation records can be refreshed from the API
- Basic server-side validation for required fields, positive quantities, and expiry after preparation
- Delivery Partner section has a clearly labeled demo task/status selector

## API endpoints
- `GET /api/health`
- `GET /api/listings`
- `POST /api/listings`
- `GET /api/care-donations`
- `POST /api/care-donations`
- `PATCH /api/care-donations/:id/status`

## Important limitations
This is a starter demo, not production-ready. It does not include secure authentication, recipient verification, automated matching, live GPS, or real delivery partner assignment. Demo listings in Customer are sample data. Do not submit real recipient personal information until proper access controls and security are added. Only donate food that meets applicable food-safety requirements; the app cannot certify safety.
