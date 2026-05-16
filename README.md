# Backend Evaluation Submission

This repository contains:

- reusable logging middleware
- vehicle maintenance scheduler
- campus notification design notes
- priority inbox implementation

## Setup

Create a root `.env` file and add:

```text
AUTH_TOKEN=your_bearer_token
```

Install dependencies:

```powershell
npm --prefix logging_middleware ci
npm --prefix vehicle_maintence_scheduler ci
npm --prefix notification_app_be ci
```

## Commands

Run all checks:

```powershell
npm run check
```

Run the scheduler:

```powershell
npm run scheduler
```

Run the priority inbox:

```powershell
npm run inbox -- 10
```
