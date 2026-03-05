const express = require("express")
const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs")
const dotenv = require("dotenv")
dotenv.config()
const app = express()
const ecsClient = new ECSClient({
  region: "eu-north-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
})


app.get("/", (req, res) => {
  res.send("Hello World!")
})

app.listen(3000, () => {
  console.log("Server started on port 3000")
})