# 🏗️ Vercel-Like Deployment Architecture — Deep Dive
### How a Modern Cloud Deployment Platform Works Under the Hood
> *"Understanding how Vercel works internally is one of the most impressive things you can explain in a system design interview. It combines cloud infrastructure, real-time communication, containerisation, and distributed systems — all in one elegant flow."*

---

## 📌 Table of Contents

1. [The Big Picture — What Are We Building?](#-the-big-picture--what-are-we-building)
2. [Architecture Overview — All Components](#-architecture-overview--all-components)
3. [Component 1 — Next.js (The Client)](#-component-1--nextjs-the-client)
4. [Component 2 — API Server (Port 9000)](#-component-2--api-server-port-9000)
5. [Component 3 — GitHub Integration](#-component-3--github-integration)
6. [Component 4 — AWS ECS + ECR (Build Servers)](#-component-4--aws-ecs--ecr-build-servers)
7. [Component 5 — Redis / Pub-Sub (Log Streaming)](#-component-5--redis--pub-sub-log-streaming)
8. [Component 6 — Socket Server (Real-Time Logs)](#-component-6--socket-server-real-time-logs)
9. [Component 7 — AWS S3 (Static File Storage)](#-component-7--aws-s3-static-file-storage)
10. [Component 8 — Users (The Browser)](#-component-8--users-the-browser)
11. [End-to-End Flow — Step by Step](#-end-to-end-flow--step-by-step)
12. [Why Each Technology Was Chosen](#-why-each-technology-was-chosen)
13. [Interview Questions & Answers on This Architecture](#-interview-questions--answers-on-this-architecture)
14. [Key System Design Concepts This Architecture Demonstrates](#-key-system-design-concepts-this-architecture-demonstrates)

---

## 🌐 The Big Picture — What Are We Building?

> **In one sentence:** A self-hosted, Vercel-like deployment platform that takes a Git repository URL, builds the project inside an isolated Docker container, streams build logs in real time to the user's browser, and serves the final static output from AWS S3.

Think about what happens every time you push code to Vercel:

1. Vercel detects your push
2. Spins up a build environment
3. Runs your build command (`npm run build`)
4. Shows you live build logs in the dashboard
5. Deploys your files to a CDN
6. Gives you a public URL

**This architecture replicates all of that** — using AWS ECS, Redis, WebSockets, and S3 instead of Vercel's proprietary infrastructure.

---

### 🧠 Why This Matters in Interviews

> *"If an interviewer asks you to design a CI/CD deployment pipeline, a build system, or a real-time logging service — this architecture answers all three simultaneously. Knowing this end-to-end flow demonstrates expertise in distributed systems, containerisation, pub-sub messaging, and real-time communication."*

---

## 🗺️ Architecture Overview — All Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER                              │
│                     (Next.js Frontend)                              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Submits GitHub URL
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   API SERVER (Node.js : 9000)                       │
│           Receives request, triggers ECS task                       │
└─────┬────────────────────────────────────────────────────┬──────────┘
      │ Pulls Builder Image                                │ Subscribes
      ▼                                                    ▼
┌──────────────┐                                ┌──────────────────────┐
│   AWS ECR    │                                │       REDIS          │
│ (Docker      │                                │   (Pub/Sub Channel)  │
│  Registry)   │                                └──────────┬───────────┘
└──────┬───────┘                                           │ Publishes logs
       │ Image pulled                                      │
       ▼                                                   ▼
┌──────────────────────┐                       ┌──────────────────────┐
│      AWS ECS         │   Pushes logs ──────► │   SOCKET SERVER      │
│  (Build Containers)  │                       │   (Node.js)          │
│                      │                       └──────────┬───────────┘
│  Container 1 ──┐     │                                  │ WebSocket
│  Container 2 ──┤─────┼──── Pushes built files ──►       │
│  Container 3 ──┘     │         to S3                    ▼
└──────────────────────┘                       ┌──────────────────────┐
          │                                    │       USERS          │
          │ Static files                       │ (See live logs +     │
          ▼                                    │  deployed URL)       │
┌──────────────────────┐                       └──────────────────────┘
│       AWS S3         │
│ (HTML, CSS, JS files)│──────► Object URL ──► Users access the site
└──────────────────────┘
```

---

## 📦 Component 1 — Next.js (The Client)

### What It Is

The **frontend of the deployment platform** — what the developer (user) interacts with. Built in Next.js.

### What It Does

- Provides a UI where users can paste a GitHub repository URL
- Submits the URL to the API Server to trigger a build
- Opens a WebSocket connection to the Socket Server to receive real-time build logs
- Displays the final deployed URL once the build is complete

### Real-World Analogy

> *"This is the Vercel Dashboard you see in your browser. You paste your repo URL, click 'Deploy', and watch the logs stream in. That's exactly what this Next.js frontend does."*

### Code Example — Submitting a Deploy Request

```javascript
// pages/index.tsx — User submits a GitHub URL to deploy
async function handleDeploy(githubUrl) {
  const response = await fetch('http://localhost:9000/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl: githubUrl })
  });

  const { deploymentId } = await response.json();

  // Now connect to Socket Server to receive live logs
  connectToLogs(deploymentId);
}
```

```javascript
// Connecting to Socket Server for live build logs
import { io } from 'socket.io-client';

function connectToLogs(deploymentId) {
  const socket = io('http://localhost:8080');

  socket.emit('subscribe', deploymentId); // Subscribe to this deployment's channel

  socket.on('log', (message) => {
    appendLogToUI(message); // Render each log line as it arrives
  });

  socket.on('build-complete', ({ url }) => {
    showDeployedUrl(url); // Show the S3 URL when done
  });
}
```

### Interview Talking Point

> *"The frontend is deliberately thin — it doesn't know about build logic, Docker, or S3. It just submits a URL and listens for events. This separation of concerns is what makes the system scalable — you can replace the frontend entirely without touching the build infrastructure."*

---

## ⚙️ Component 2 — API Server (Port 9000)

### What It Is

A **Node.js HTTP server** — the orchestrator of the entire deployment pipeline. It is the entry point that receives a GitHub URL and kicks off the entire build process.

### What It Does

1. Receives `POST /deploy` with a GitHub repo URL
2. Generates a unique deployment ID
3. Spins up a new ECS task (container) with the Builder Image
4. Passes the GitHub URL and deployment ID to the container as environment variables
5. Returns the deployment ID to the frontend immediately
6. Does NOT wait for the build to finish — it's fire-and-forget

### Why Port 9000?

> *"Port 9000 is a common convention for internal API servers. It separates this service from the Socket Server (which typically runs on 8080) and avoids conflict with common ports like 3000 (React) or 80 (HTTP). In production, a reverse proxy like Nginx sits in front and routes traffic to the right port."*

### Code Example — API Server

```javascript
// api-server/index.js
const express = require('express');
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs');

const app = express();
app.use(express.json());

const ecsClient = new ECSClient({ region: 'eu-north-1' });

app.post('/deploy', async (req, res) => {
  const { repoUrl } = req.body;

  // Generate a unique deployment ID
  const deploymentId = generateId(); // e.g., "acceptable-late-energy"

  // Spin up an ECS task with the Builder Image
  const command = new RunTaskCommand({
    cluster: 'builder-cluster',
    taskDefinition: 'builder-task',
    launchType: 'FARGATE',
    overrides: {
      containerOverrides: [{
        name: 'builder-image',
        environment: [
          { name: 'GIT_REPOSITORY_URL', value: repoUrl },
          { name: 'DEPLOYMENT_ID',      value: deploymentId }
        ]
      }]
    },
    networkConfiguration: { /* VPC config */ }
  });

  await ecsClient.send(command);

  // Return immediately — build happens asynchronously
  res.json({ deploymentId, status: 'queued' });
});

app.listen(9000, () => console.log('API Server running on :9000'));
```

### Key Design Decision — Why Return Immediately?

> *"The API server returns the deployment ID instantly, before the build starts. This is an asynchronous design — the build might take 2 minutes, and you can't keep an HTTP connection open that long. Instead, the frontend uses WebSockets to receive updates. This is the correct pattern for long-running operations."*

---

## 🔗 Component 3 — GitHub Integration

### What It Is

GitHub is the **source of truth** — the repository whose code needs to be built and deployed.

### What Happens

1. User provides a GitHub URL (e.g., `https://github.com/rashmi/my-nextjs-app`)
2. API Server passes this URL to the ECS container
3. The build container runs `git clone <URL>` to pull the code
4. The build then runs `npm install && npm run build`

### Why Git Clone Instead of GitHub Webhooks?

> *"In this architecture, the user manually triggers deploys by submitting a URL. A more advanced version would use GitHub Webhooks — GitHub calls your API Server automatically on every push. Vercel uses webhooks. For this MVP architecture, manual URL submission is simpler and still demonstrates the full build pipeline."*

### Code Inside the Builder Container

```bash
# What happens inside the Docker container after it starts

# 1. Clone the repository
git clone $GIT_REPOSITORY_URL /home/app

# 2. Move into the project
cd /home/app

# 3. Install dependencies
npm install

# 4. Build the project
npm run build

# 5. Upload built files to S3
aws s3 sync ./dist s3://vercel-app-output/$DEPLOYMENT_ID/
```

---

## 🐳 Component 4 — AWS ECS + ECR (Build Servers)

> *"This is the heart of the architecture — the isolated, scalable build environment."*

---

### AWS ECR — Elastic Container Registry

#### What It Is

ECR is **AWS's private Docker image registry** — like Docker Hub, but private and integrated with AWS services.

#### What It Does in This Architecture

Stores the **Builder Image** — a pre-built Docker image that contains everything needed to build a web application:
- Node.js runtime
- npm / yarn
- AWS CLI (to upload to S3)
- Git (to clone the repo)
- The build script

#### Why ECR and Not Docker Hub?

> *"Docker Hub is public and has rate limits. ECR is private (your builder image may contain proprietary tooling), integrated with AWS IAM for access control, and has no pull rate limits. Since ECS runs inside AWS, pulling from ECR is also faster — same network, no egress charges."*

```bash
# Pushing the Builder Image to ECR
docker build -t builder-image .
docker tag builder-image:latest 123456789.dkr.ecr.eu-north-1.amazonaws.com/builder-image:latest
docker push 123456789.dkr.ecr.eu-north-1.amazonaws.com/builder-image:latest
```

---

### AWS ECS — Elastic Container Service

#### What It Is

ECS is **AWS's container orchestration service** — it runs Docker containers at scale without you managing servers.

#### The Key Concept — One Container Per Build

> *"Every deployment gets its own isolated container. If 100 users deploy simultaneously, 100 containers spin up in parallel. Each is completely isolated — one build can't interfere with another. This is the same principle Vercel uses."*

```
User A deploys ──► ECS spins up Container A ──► Builds Repo A ──► Uploads to S3/A
User B deploys ──► ECS spins up Container B ──► Builds Repo B ──► Uploads to S3/B
User C deploys ──► ECS spins up Container C ──► Builds Repo C ──► Uploads to S3/C
       All three run in PARALLEL — completely isolated
```

#### ECS vs EC2 — Why Not Just Use a Server?

| | EC2 (Single Server) | ECS (Containers) |
|--|--------------------|--------------------|
| **Isolation** | Builds share the same OS | Each build is fully isolated |
| **Scalability** | Limited by server capacity | Spins up containers on demand |
| **Cost** | Pay 24/7 even when idle | Pay only when a build runs |
| **Failure** | One crash affects all builds | One container crash is isolated |
| **Cleanup** | Manual | Container destroyed after build |

#### The Builder Image — What's Inside the Dockerfile

```dockerfile
# Dockerfile for Builder Image (stored in ECR)
FROM node:18-alpine

# Install required tools
RUN apk add --no-cache git aws-cli

# Set working directory
WORKDIR /home/app

# Copy the build script into the image
COPY build.sh /home/app/build.sh
RUN chmod +x /home/app/build.sh

# Entry point — runs when container starts
CMD ["/bin/sh", "/home/app/build.sh"]
```

```bash
# build.sh — runs inside every container on startup
#!/bin/bash

echo "Starting build for deployment: $DEPLOYMENT_ID"

# Publish log to Redis
publish_log() {
  redis-cli -h $REDIS_HOST PUBLISH $DEPLOYMENT_ID "$1"
}

publish_log "Cloning repository..."
git clone $GIT_REPOSITORY_URL /home/app/repo

cd /home/app/repo
publish_log "Installing dependencies..."
npm install 2>&1 | while read line; do publish_log "$line"; done

publish_log "Building project..."
npm run build 2>&1 | while read line; do publish_log "$line"; done

publish_log "Uploading to S3..."
aws s3 sync ./dist s3://vercel-app-output/$DEPLOYMENT_ID/

publish_log "Build complete!"
publish_log "DONE:https://vercel-app-output.s3.eu-north-1.amazonaws.com/__outputs/$DEPLOYMENT_ID/index.html"
```

---

## 📡 Component 5 — Redis / Pub-Sub (Log Streaming)

> *"This is the most architecturally interesting part — how do build logs travel from an isolated container to the user's browser in real time?"*

### The Problem It Solves

The ECS container is running in AWS. The user is in their browser. How do the logs get from the container to the user in real time?

**Option A — Direct WebSocket from container to browser:**
❌ Containers are ephemeral and don't have stable addresses. You can't connect to them directly.

**Option B — Write logs to a database, frontend polls:**
❌ Polling creates delay and unnecessary database load.

**Option C — Redis Pub/Sub:**
✅ Container publishes logs to Redis. Socket Server subscribes and forwards to browser via WebSocket. Decoupled, real-time, scalable.

---

### How Redis Pub/Sub Works

```
Publisher                    Redis Channel              Subscriber
(ECS Container)              "deployment-123"           (Socket Server)

publish("Starting build") ──► Channel ──────────────► receives message
publish("npm install...") ──► Channel ──────────────► receives message
publish("Build complete") ──► Channel ──────────────► receives message
```

> *"Redis Pub/Sub is fire-and-forget — the publisher doesn't know who's subscribed, and doesn't care. This is the definition of decoupled architecture. You can add more subscribers (analytics, Slack notifications, email) without touching the container code."*

### Code — Publishing Logs From the Container

```javascript
// Inside the build container — publishing logs to Redis
const { createClient } = require('redis');

const publisher = createClient({ url: process.env.REDIS_URL });
await publisher.connect();

async function publishLog(deploymentId, message) {
  await publisher.publish(`logs:${deploymentId}`, JSON.stringify({
    timestamp: new Date().toISOString(),
    message,
    deploymentId
  }));
}

// Used throughout the build script:
await publishLog(deploymentId, 'Cloning repository...');
await publishLog(deploymentId, 'Running npm install...');
await publishLog(deploymentId, `Error: ${stderr}`);
await publishLog(deploymentId, 'Build complete!');
```

### Why Not Kafka Instead of Redis?

> *"Great interview question. Kafka is better for high-volume, persistent event streams where you need replay capability. Redis Pub/Sub is ephemeral — if nobody is subscribed when a message is published, it's lost. For build logs, this is acceptable — if the user disconnects and reconnects, they might miss some logs but they'll get the final result. If you needed guaranteed delivery or log history, you'd use Kafka or store logs in a database. Redis is simpler and faster for this real-time, ephemeral use case."*

---

## 🔌 Component 6 — Socket Server (Real-Time Logs)

### What It Is

A **Node.js server running Socket.io** — the bridge between Redis and the user's browser.

### What It Does

1. Accepts WebSocket connections from browsers
2. When a browser subscribes to a `deploymentId`, it subscribes to that Redis channel
3. Every message Redis publishes on that channel gets forwarded to the browser via WebSocket
4. When the build completes, it emits the S3 URL to the browser

### Why a Separate Server for Sockets?

> *"The API Server and Socket Server are deliberately separate. WebSocket connections are long-lived — a user might hold a connection for 3 minutes while their build runs. HTTP servers are optimised for short request-response cycles. Mixing long-lived WebSocket connections with the API server would reduce the API server's ability to handle many simultaneous HTTP requests. Separation of concerns at the infrastructure level."*

### Code — Socket Server

```javascript
// socket-server/index.js
const { Server } = require('socket.io');
const { createClient } = require('redis');
const http = require('http');

const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const redisSubscriber = createClient({ url: process.env.REDIS_URL });
await redisSubscriber.connect();

io.on('connection', (socket) => {
  console.log('Browser connected:', socket.id);

  // Browser sends: "subscribe to deployment ABC123"
  socket.on('subscribe', async (deploymentId) => {
    console.log(`Socket ${socket.id} subscribing to logs:${deploymentId}`);

    // Subscribe to the Redis channel for this deployment
    await redisSubscriber.subscribe(`logs:${deploymentId}`, (message) => {
      const parsed = JSON.parse(message);

      // Check if this is the "build complete" message
      if (parsed.message.startsWith('DONE:')) {
        const url = parsed.message.replace('DONE:', '');
        socket.emit('build-complete', { url });
        return;
      }

      // Forward log line to the browser
      socket.emit('log', parsed.message);
    });
  });

  socket.on('disconnect', () => {
    console.log('Browser disconnected:', socket.id);
    // Redis subscription auto-cleans up
  });
});

httpServer.listen(8080, () => console.log('Socket Server on :8080'));
```

### The Real-Time Flow Visualised

```
ECS Container                Redis                Socket Server           Browser
     │                         │                        │                    │
     │── publish("Installing") ►│                        │                    │
     │                         │── message received ────►│                    │
     │                         │                        │── socket.emit() ──►│
     │                         │                        │   "Installing"     │ ◄ User sees this
     │── publish("Building...") ►│                        │                    │
     │                         │── message received ────►│                    │
     │                         │                        │── socket.emit() ──►│
     │                         │                        │   "Building..."    │ ◄ User sees this
     │── publish("DONE:url") ──►│                        │                    │
     │                         │── message received ────►│                    │
     │                         │                        │── build-complete ─►│
     │                         │                        │   { url: "..." }   │ ◄ URL shown
```

---

## 🗄️ Component 7 — AWS S3 (Static File Storage)

### What It Is

**Amazon S3 (Simple Storage Service)** — object storage that hosts the built static files (HTML, CSS, JS) and serves them publicly via a URL.

### What Gets Stored

After `npm run build`, the build container uploads the output directory to S3:

```
s3://vercel-app-output/
  └── __outputs/
        └── acceptable-late-energy/    ← deployment ID as folder
              ├── index.html
              ├── assets/
              │     ├── main.js
              │     ├── main.css
              │     └── images/
              └── _next/               ← Next.js specific chunks
```

### The Resulting URL Pattern

```
https://vercel-app-output.s3.eu-north-1.amazonaws.com/__outputs/acceptable-late-energy/index.html
```

> *"Notice the deployment ID in the URL — 'acceptable-late-energy'. Every deployment gets a unique ID, which means every deployment gets its own folder in S3. This gives you deployment history — you can access any previous deployment by its ID. This is exactly how Vercel's preview deployments work."*

### S3 Bucket Configuration for Public Access

```javascript
// Setting up S3 bucket for static website hosting
const s3Config = {
  Bucket: 'vercel-app-output',
  WebsiteConfiguration: {
    IndexDocument: { Suffix: 'index.html' },
    ErrorDocument: { Key: 'index.html' } // SPA routing — all routes to index.html
  }
};

// Bucket policy — public read access
const bucketPolicy = {
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: '*',
    Action: 's3:GetObject',
    Resource: 'arn:aws:s3:::vercel-app-output/*'
  }]
};
```

### Why S3 and Not a Regular Server?

> *"S3 is infinitely scalable, globally redundant, and extremely cheap for static files — about $0.023 per GB per month. A regular server has a fixed capacity and requires maintenance. For static files that don't change after each build, S3 is the correct choice. Optionally, you'd put CloudFront (AWS's CDN) in front of S3 to cache files at edge locations globally — reducing latency for users worldwide."*

---

## 👥 Component 8 — Users (The Browser)

### The User's Full Journey

```
1. Opens the Next.js frontend
2. Pastes GitHub URL and clicks "Deploy"
3. Frontend sends POST to API Server → receives deploymentId
4. Frontend connects WebSocket to Socket Server with deploymentId
5. Watches logs stream in real time:
      ✓ "Cloning repository..."
      ✓ "Installing dependencies..."
      ✓ "Building project..."
      ✓ "Uploading to S3..."
      ✓ "Build complete!"
6. Receives the S3 URL
7. Clicks the URL → sees their live deployed site
```

### What the User Sees

```
┌─────────────────────────────────────────────────┐
│  🚀 Deploy Your Project                         │
│                                                 │
│  GitHub URL: [github.com/rashmi/my-app    ]     │
│                                                 │
│  [ Deploy ]                                     │
├─────────────────────────────────────────────────┤
│  📋 Build Logs                    ● Live        │
│                                                 │
│  [12:01:03] Cloning repository...               │
│  [12:01:05] Installing dependencies...          │
│  [12:01:18] added 847 packages                  │
│  [12:01:19] Building project...                 │
│  [12:01:34] ✓ Compiled successfully             │
│  [12:01:35] Uploading to S3...                  │
│  [12:01:36] Build complete! 🎉                  │
│                                                 │
│  🔗 Your site is live:                          │
│  https://vercel-app-output.s3.amazonaws.com/    │
│  __outputs/acceptable-late-energy/index.html    │
└─────────────────────────────────────────────────┘
```

---

## 🔄 End-to-End Flow — Step by Step

> *"If an interviewer asks you to walk through the complete flow, use this."*

---

### Step 1 — User Submits GitHub URL

```
User types: https://github.com/rashmi/portfolio
Clicks "Deploy"
Next.js frontend sends: POST http://localhost:9000/deploy
Body: { repoUrl: "https://github.com/rashmi/portfolio" }
```

---

### Step 2 — API Server Generates Deployment ID and Triggers ECS

```
API Server receives request
Generates deploymentId: "acceptable-late-energy"
Calls ECS RunTask API:
  - Task definition: builder-task
  - Environment variables:
      GIT_REPOSITORY_URL = "https://github.com/rashmi/portfolio"
      DEPLOYMENT_ID      = "acceptable-late-energy"
      REDIS_URL          = "redis://internal-redis:6379"
      S3_BUCKET          = "vercel-app-output"
Returns: { deploymentId: "acceptable-late-energy", status: "queued" }
```

---

### Step 3 — Frontend Subscribes to Live Logs

```
Frontend receives deploymentId: "acceptable-late-energy"
Opens WebSocket to Socket Server:
  socket.connect("http://localhost:8080")
  socket.emit("subscribe", "acceptable-late-energy")
Socket Server subscribes to Redis channel: "logs:acceptable-late-energy"
```

---

### Step 4 — ECS Pulls Builder Image and Starts Container

```
ECS pulls builder image from ECR
Container starts
build.sh executes:
  1. git clone https://github.com/rashmi/portfolio /home/app/repo
  2. cd /home/app/repo
  3. npm install
  4. npm run build
  5. aws s3 sync ./dist s3://vercel-app-output/acceptable-late-energy/
```

---

### Step 5 — Build Logs Stream via Redis → Socket → Browser

```
Container publishes to Redis: "logs:acceptable-late-energy" → "Cloning..."
Redis delivers to Socket Server subscriber
Socket Server emits to browser: socket.emit("log", "Cloning...")
Browser appends to log UI

[REPEATS for every log line]
```

---

### Step 6 — Build Completes, Files Go to S3

```
npm run build completes
dist/ folder created
aws s3 sync uploads:
  → index.html
  → assets/main.js
  → assets/main.css
Container publishes: "DONE:https://...s3.amazonaws.com/__outputs/acceptable-late-energy/index.html"
Socket Server emits: build-complete event with URL
Browser shows the deployed URL
Container shuts down (ephemeral — no cleanup needed)
```

---

### Step 7 — User Accesses the Deployed Site

```
User clicks the URL
Browser makes GET request to S3
S3 serves index.html
User sees their deployed site
Deployment complete ✅
```

---

## 🧰 Why Each Technology Was Chosen

| Technology | Why This and Not Something Else |
|-----------|--------------------------------|
| **AWS ECS** | Managed container orchestration — no server management, auto-scales, pay per use |
| **AWS ECR** | Private Docker registry inside AWS — fast pulls from ECS, IAM-secured |
| **AWS S3** | Infinitely scalable static file hosting — zero maintenance, cheap, globally available |
| **Redis Pub/Sub** | Real-time, low-latency message passing — perfect for ephemeral log streaming |
| **Socket.io** | WebSocket abstraction with automatic fallback — handles browser compatibility |
| **Node.js API** | Non-blocking I/O — ideal for a server that mostly coordinates async operations |
| **Next.js Frontend** | SSR capabilities + React ecosystem — production-ready frontend with routing |
| **Docker Containers** | Complete isolation per build — security, reproducibility, no dependency conflicts |

---

## 🎤 Interview Questions & Answers on This Architecture

---

### Q1: "Why use separate containers for each build instead of a shared build server?"

> *"Three reasons: isolation, scalability, and security.*
> *Isolation means one broken build doesn't affect others. If someone's package.json has a buggy postinstall script that crashes the process, only their container is affected.*
> *Scalability means you can run 1 build or 1000 builds simultaneously — ECS spins up containers on demand.*
> *Security means each build runs with its own filesystem and environment variables. One user's secrets can't be accessed by another user's build process.*
> *This is the same reason Vercel, Netlify, and GitHub Actions all use isolated containers per job."*

---

### Q2: "Why Redis Pub/Sub for log streaming instead of storing logs in a database and polling?"

> *"Polling introduces two problems: latency (you only see new logs as fast as your poll interval) and load (100 simultaneous builds means 100 clients polling constantly, multiplying your database reads).*
> *Redis Pub/Sub is push-based — logs appear in the browser the instant the container publishes them, with sub-millisecond latency. There's no polling overhead.*
> *The trade-off: Redis Pub/Sub is ephemeral — missed messages are gone. For this use case, that's acceptable. If you needed log history or replay, you'd additionally write logs to a database like PostgreSQL or a service like CloudWatch."*

---

### Q3: "What happens if the Socket Server goes down mid-build?"

> *"The user loses their live log feed, but the build continues — ECS containers publish to Redis regardless of whether anyone is subscribed. The build result still gets uploaded to S3.*
> *To handle this gracefully: the frontend should detect the WebSocket disconnection and try to reconnect with exponential backoff. If reconnection succeeds mid-build, the user resumes receiving logs. If the build already completed, the frontend can poll an API endpoint for the final status.*
> *In production, you'd run multiple Socket Server instances behind a load balancer with sticky sessions, so a single instance failure doesn't affect all users."*

---

### Q4: "How would you scale this to handle 10,000 simultaneous builds?"

> *"ECS scales horizontally by default — you can configure it to run up to N concurrent tasks, and AWS manages the underlying compute. The bottleneck would more likely be:*
> *1. Redis — a single Redis instance handles ~100,000 pub/sub messages per second, which is likely sufficient. For more, use Redis Cluster.*
> *2. S3 upload throughput — S3 supports thousands of requests per second per prefix. You can shard by prefix (e.g., first character of deployment ID) if needed.*
> *3. The API Server — a single Node.js server can handle thousands of concurrent requests since it's mostly I/O bound. For more, run multiple instances behind a load balancer.*
> *The beauty of this architecture is that the build containers are stateless and ephemeral — scaling them is just increasing the ECS task limit."*

---

### Q5: "What is the deployment ID and how should it be generated?"

> *"The deployment ID serves two purposes: it's a unique identifier for the build process, and it's the folder name in S3 where the built files live — making every deployment independently accessible.*
> *It should be: unique (to avoid collisions), human-readable (for debugging), and URL-safe (to be used in S3 paths and browser URLs).*
> *Readable random IDs like 'acceptable-late-energy' (adjective-adjective-noun) are popular — they're memorable, collision-resistant, and URL-safe. Alternatively, use UUID v4, nanoid, or a combination of timestamp + random string.*
> *What you should NOT use: auto-incrementing integers — they're guessable, meaning someone could enumerate other users' deployments by incrementing the ID."*

---

### Q6: "How would you add authentication to this system?"

> *"Currently, any user can deploy any repo. To add auth:*
> *1. Add a login flow (OAuth with GitHub is natural — users already have a GitHub account)*
> *2. API Server validates JWT on every `/deploy` request*
> *3. Associate deployments with user IDs — store deployment records in a database*
> *4. Socket Server validates the JWT before allowing subscription to a deployment's log channel — preventing users from watching other users' build logs*
> *5. S3 URLs stay public (by design — deployed sites are public), but the deployment dashboard is auth-protected*
> *This is exactly how Vercel works — your deployments are private in the dashboard but the deployed URLs are publicly accessible."*

---

### Q7: "What would you add to make this production-ready?"

> *"Several things:*
> *Observability: Structured logging in all services, distributed tracing (AWS X-Ray or OpenTelemetry), metrics dashboard (CloudWatch or Grafana).*
> *Reliability: Dead letter queues for failed builds, automatic retry logic, health checks on all services.*
> *Security: VPC isolation (containers run in private subnets, not accessible from the internet), IAM roles with least privilege, secrets in AWS Secrets Manager (not environment variables).*
> *Performance: CloudFront CDN in front of S3 for globally fast deployments, pre-warmed ECS tasks to reduce cold start time.*
> *Cost optimisation: Spot instances for ECS tasks (builds are fault-tolerant — if the spot instance is reclaimed, just retry), S3 lifecycle policies to archive old deployments.*
> *User experience: Build cancellation, deployment rollback, custom domains via Route 53."*

---

## 🧠 Key System Design Concepts This Architecture Demonstrates

---

### 1. Asynchronous Processing

> *"Long-running operations (builds can take minutes) should never block an HTTP response. The API Server returns immediately with a deploymentId and the user tracks progress via WebSocket. This is the correct pattern for any operation that takes more than a few seconds."*

---

### 2. Pub/Sub Pattern (Observer Pattern at Infrastructure Level)

> *"Publishers (containers) and subscribers (Socket Server) are completely decoupled. The container doesn't know who's listening. You can add new subscribers — analytics, notifications, monitoring — without modifying the container code at all."*

---

### 3. Ephemeral Compute

> *"Build containers exist for the duration of one build and are destroyed immediately after. They have no persistent state — all output goes to S3, all logs go to Redis. This makes the system cheaper (no idle compute), cleaner (no cleanup needed), and more secure (no lingering processes)."*

---

### 4. Infrastructure as Code Mindset

> *"Every build gets an identical environment — the same Docker image, the same Node.js version, the same dependencies. There's no 'works on my machine' problem. This is reproducible builds — the same source code will always produce the same output."*

---

### 5. Separation of Concerns

> *"Five distinct services, each with one responsibility:*
> *API Server — orchestration*
> *ECS Container — building*
> *Redis — message passing*
> *Socket Server — real-time delivery*
> *S3 — storage and serving*
> *Each can be scaled, replaced, or debugged independently."*

---

### 6. Idempotent Deployments

> *"Each deployment gets a unique ID and a unique S3 folder. Deploying the same code twice creates two independent deployments — they don't overwrite each other. This enables rollback: if deployment ABC breaks, you can immediately redirect traffic to the previous deployment XYZ. This is the foundation of blue-green and canary deployment strategies."*

---

## 📝 One-Line Summaries — For Quick Recall in Interviews

| Component | One-line summary |
|-----------|-----------------|
| **Next.js** | Frontend dashboard — submits repo URL, shows live logs, displays deployed URL |
| **API Server :9000** | Orchestrator — receives GitHub URL, generates deployment ID, triggers ECS task |
| **GitHub** | Source of truth — the repository whose code is cloned and built |
| **AWS ECR** | Private Docker registry — stores the Builder Image used by every ECS container |
| **AWS ECS** | Container runtime — spins up one isolated container per build, runs the build script |
| **Builder Image** | Docker image containing Node.js, Git, AWS CLI, and the build script |
| **Redis Pub/Sub** | Message bus — build logs flow from container to Socket Server in real time |
| **Socket Server** | WebSocket bridge — subscribes to Redis, forwards logs to browser via Socket.io |
| **AWS S3** | Object storage — built HTML/CSS/JS files stored and served from a public URL |
| **Users** | Developers — they submit repos, watch builds, and access deployed sites |

---

*Architecture Reference | Vercel-Like Deployment Platform*
*Prepared for System Design Interviews | 2026*