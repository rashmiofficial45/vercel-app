import express from "express"
import httpProxy from "http-proxy"

const PORT = 8000
const app = express()

const proxy = httpProxy.createProxy()

const BASE_PATH = "https://vercel-app-output.s3.eu-north-1.amazonaws.com/__outputs"

app.use((req, res) => {
  const hostname = req.hostname
  const subdomain = hostname.split(".")[0]

  // Strip /__outputs/<subdomain> prefix that S3-hosted HTML injects into asset paths
  req.url = req.url.replace(`/__outputs/${subdomain}`, "") || "/"

  const target = `${BASE_PATH}/${subdomain}`

  console.log("resolvesTo", `${target}${req.url}`)

  proxy.web(req, res, {
    target,
    changeOrigin: true
  })
})

proxy.on("proxyReq", (proxyReq) => {
  if (proxyReq.path.endsWith("/")) {
    proxyReq.path += "index.html"
  }
  console.log("proxyReq.path", proxyReq.path)
})

proxy.on("error", (err, req, res) => {
  console.error("Proxy error:", err)
  res.status(500).send("Proxy server error")
})

app.listen(PORT, () => {
  console.log(`Reverse proxy running on port ${PORT}`)
})